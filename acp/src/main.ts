// acp: coding agents over ACP (Agent Client Protocol) in panes of their own, drawn as a chat.
//
//   pumi call amresyd.acp.new '{"agent": "gemini", "cwd": "~/src/app"}'
//
// Each pane of the `chat` block runs its agent under a host process (`host.ts`) the worker starts
// detached, so the agent outlives the app; the worker is a client of each host's socket
// (`wire.ts`), as any other could be. It relays the conversation to the pane's renderer
// (`ui.post`), serves it to anyone (`conversation.read`/`send`, `conversation.changed`), and keeps
// the pane an agent like a terminal's: `@agent`, `@agent.status` (by `pane.call`'s `report`),
// `@agent.session`, `@agent.model`, `@agent.conversation`, and its permission prompts asked through
// `request.open`, so any UI can answer them. After the app or the server starts again it finds the
// hosts again, or starts new ones that load the session.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { ApiError, agent, call, conversationNames, emit, fn, on, option, paths, request, self, ui, workspace } from "pumi";

import { follow, type Update } from "../../lib/conversation/src/change.ts";
import { optionOf, type Ack, type Command, type Cursor, type Transcript } from "../../lib/conversation/src/model.ts";
import { currentName } from "../../lib/conversation/src/view.ts";
import { agentTable, installed, launchOf, resumeLine, searchPath, type AgentDef } from "./agents.ts";
import { lineReader } from "./rpc.ts";
import { socketPath, type FromHost, type HostSpec, type HostState, type ToHost } from "./wire.ts";

/** The pane options an ACP pane keeps (beside the `@agent.*` ones every agent has). */
const CWD = "@acp.cwd";
/** How its first session begins, until it has one: `new` or `pick`. */
const MODE = "@acp.mode";
const AGENT = "@agent";
const SESSION = "@agent.session";
const MODEL = "@agent.model";
const CONVERSATION = "@agent.conversation";

const chatBlock = () => self.plugin.prefixed("chat");
const hostsDir = () => join(paths.state, "hosts");
const names = () => conversationNames(self.plugin.id);

/** A pane's id as the API has it (`%3`), from the number this package keeps of it. */
const paneRef = (pane: number): string => `%${pane}`;

/** The number a pane's id names (`%3` is `3`). */
const numberOf = (id: string): number => Number(id.slice(id.indexOf("/") + 1).replace(/^[%@$]/, ""));

/** The pane a function was called from, or why there is none. */
async function here(): Promise<number> {
  await workspace.ready;
  const pane = workspace.currentPane;
  if (!pane) throw new ApiError("not_found", "acp: no pane in front to work from");
  return numberOf(pane.id);
}

/** The agents table, with the user's additions. */
async function table(): Promise<Record<string, AgentDef>> {
  return agentTable(await option.get("agents").catch(() => ({})));
}

const optionOn = async <T>(name: string, id: number): Promise<T | undefined> => {
  const value = await option.get(name, { scope: "pane", id: paneRef(id) }).catch(() => null);
  return value === null || value === "" ? undefined : (value as T);
};

/** One of pane `id`'s own options, set. */
const setOn = (name: string, value: unknown, id: number): Promise<null> => option.set(name, value, { scope: "pane", id: paneRef(id) });

// ── One pane's link to its host ──────────────────────────────────────────────────────────────

/** A pane's host as the worker follows it. */
class Link {
  socket: Socket | undefined;
  state: HostState | undefined;
  transcript: Transcript | undefined;
  closed = false;
  #acks = new Map<string, (ack: Ack) => void>();
  /** The core's request for each permission the transcript asks (`request.open`), by permission id. */
  asked = new Map<string, string | null>();
  /** The option a view picked for a permission, so the core's request is answered the same. */
  picked = new Map<string, string>();
  #reported: { status?: string; session?: string; model?: string; title?: string } = {};
  #swept = false;
  /** Whether the agent has been told it started (`agent.turn` at `start`), and the take child. */
  #started = false;
  #taking: { stop: () => void } | undefined;

  constructor(readonly pane: number) {}

  send(message: ToHost): void {
    if (this.socket && !this.socket.destroyed) this.socket.write(`${JSON.stringify(message)}\n`);
  }

  /** Sends `command` and answers the host's ack (rejected if the host does not answer in time). */
  command(command: Command): Promise<Ack> {
    if (!this.socket || this.socket.destroyed) return Promise.resolve({ id: command.id, rejected: "the agent's host is not running" });
    if (command.type === "answer") this.picked.set(command.permissionId, command.optionId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#acks.delete(command.id);
        resolve({ id: command.id, rejected: "the agent's host did not answer" });
      }, 30_000);
      this.#acks.set(command.id, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
      this.send({ t: "command", command });
    });
  }

  hear(message: FromHost): void {
    switch (message.t) {
      case "state":
        this.state = message.state;
        ui.post(`state.${this.pane}`, message.state);
        void this.#sync();
        return;
      case "ack":
        this.#acks.get(message.ack.id)?.(message.ack);
        this.#acks.delete(message.ack.id);
        return;
      case "update":
        this.#update(message.update);
        return;
    }
  }

  #update(update: Update): void {
    const next = follow(this.transcript, update);
    if (!next) {
      // Out of step (or nothing yet): ask for where it stands.
      this.send({ t: "hello" });
      return;
    }
    if (next === this.transcript) return;
    this.transcript = next;
    ui.post(`update.${this.pane}`, update);
    const cursor: Cursor = { epoch: next.epoch, seq: next.seq };
    const changes = update.type === "changes" ? update.changes : [];
    void emit("conversation.changed", { pane: paneRef(this.pane), changes, cursor }, { pane: paneRef(this.pane) }).catch(() => {});
    void this.#sync();
  }

  /** The pane's options and status as the host and the transcript say, and its requests to the user. */
  async #sync(): Promise<void> {
    const t = this.transcript;
    const id = this.pane;
    const was = this.#reported;
    const status = t?.status;
    if (status && status !== was.status) {
      was.status = status;
      await call("pane.call", paneRef(id), "report", { body: `state=${status}:app=acp` }).catch(() => {});
    }
    const session = this.state?.session ?? t?.session?.id;
    if (session && session !== was.session) {
      was.session = session;
      await setOn(SESSION, session, id).catch(() => {});
    }
    const modelOption = t ? optionOf(t, "model") : undefined;
    const model = modelOption ? currentName(modelOption) : t?.session?.model;
    if (model && model !== was.model) {
      was.model = model;
      await setOn(MODEL, model, id).catch(() => {});
    }
    const title = t?.session?.title || this.state?.name;
    if (title && title !== was.title) {
      was.title = title;
      await call("pane.call", paneRef(id), "report", { title }).catch(() => {});
    }
    if (t) await this.#requests(t);
    void this.#told().catch(() => {});
  }

  /**
   * What pumi has for the agent (`agent.turn`): at a start it is told what it is not to be surprised
   * by, and while it is ready the messages queued for it (`agent.take`) are its next prompts. The
   * context goes to the host as a `context` command, which puts it ahead of the next prompt.
   */
  async told(event: "prompt"): Promise<void> {
    const name = this.state?.agent || (await optionOn<string>(AGENT, this.pane));
    if (!name) return;
    await this.#tell(event, name, this.state?.session ?? this.transcript?.session?.id);
  }

  async #told(): Promise<void> {
    const t = this.transcript;
    if (!t || this.closed || this.state?.phase !== "ready") return;
    const name = this.state?.agent || (await optionOn<string>(AGENT, this.pane));
    const session = this.state?.session ?? t.session?.id;
    if (!name) return;
    const busy = t.status === "working" || t.status === "blocked" || this.#taking !== undefined;
    if (!this.#started) {
      this.#started = true;
      const resumed = (await optionOn<string>(SESSION, this.pane)) !== undefined;
      await this.#tell("start", name, session, resumed);
    }
    if (!busy) this.#take(name, session);
  }

  /** Asks the core what the agent should know now, and hands it to the host for its next prompt. */
  async #tell(event: "start" | "prompt", name: string, session: string | undefined, resumed = false): Promise<void> {
    const said = await agent.turn(paneRef(this.pane), { event, ...(resumed ? { resumed } : {}) }).catch((err) => {
      console.error(`acp: agent.turn for ${this.pane}: ${err?.message ?? err}`);
      return [] as string[];
    });
    // What pumi has for the agent: each contribution is a paragraph of it.
    const text = said.filter((one) => typeof one === "string" && one !== "").join("\n\n");
    if (text !== "") await this.command({ type: "context", id: crypto.randomUUID(), text });
  }

  /** Holds a `pumi agent take --wait` for this pane while it is idle: a queued message is a prompt. */
  #take(name: string, session: string | undefined): void {
    if (!session || this.#taking) return;
    const pane = this.pane;
    let child: ReturnType<typeof spawn>;
    const stop = () => {
      this.#taking = undefined;
      try {
        child?.kill();
      } catch {}
    };
    this.#taking = { stop };
    const args = ["agent", "take", "-t", `%${pane}`, "--session", session, "--wait", "--json"];
    try {
      child = spawn(process.env.PUMI_BIN || "pumi", args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      stop();
      return;
    }
    let out = "";
    child.stdout?.on("data", (data) => (out += String(data)));
    child.on("error", stop);
    child.on("close", () => {
      if (this.#taking?.stop !== stop) return;
      stop();
      let item: { text?: string } | null = null;
      try {
        item = JSON.parse(out);
      } catch {}
      const text = typeof item?.text === "string" ? item.text : "";
      if (!text || this.closed) return;
      // The agent's turn starts with the message: what it is told now goes first (`agent.turn`).
      void (async () => {
        await this.#tell("prompt", name, session);
        await this.command({ type: "prompt", id: crypto.randomUUID(), text });
      })().catch((err) => console.error(`acp: pane ${pane}: ${err?.message ?? err}`));
    });
  }

  /** Each permission waiting is a core request too; each one gone ends its request. */
  async #requests(t: Transcript): Promise<void> {
    if (!this.#swept) {
      // Requests left from before the app started again whose permission has gone wait for nothing.
      this.#swept = true;
      for (const r of await workspace.requests({ pane: paneRef(this.pane) }).catch(() => [])) {
        if (!t.permissions.some((p) => p.title === r.title)) await request.close(r.id).catch(() => null);
      }
    }
    for (const permission of t.permissions) {
      if (this.asked.has(permission.id)) continue;
      this.asked.set(permission.id, null);
      const tool = t.entries.find((e) => e.tool?.id === permission.toolId)?.tool;
      const ask = {
        kind: "permission" as const,
        title: permission.title,
        ...(permission.detail ? { detail: permission.detail } : {}),
        ...(tool ? { tool: tool.title } : {}),
        options: permission.options.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
      };
      // One left from before the app started again is the same request: keep it.
      const pending = await workspace.requests({ pane: paneRef(this.pane) }).catch(() => []);
      const same = pending.find((r) => r.title === ask.title && JSON.stringify((r.options ?? []).map((o: any) => o.id)) === JSON.stringify(ask.options.map((o) => o.id)));
      const opened = same ? same.id : await request.open(ask, { pane: paneRef(this.pane) }).catch(() => null);
      if (this.asked.has(permission.id)) this.asked.set(permission.id, opened);
      else if (opened !== null) {
        // It was answered or withdrawn while the request was being made.
        const option = this.picked.get(permission.id);
        this.picked.delete(permission.id);
        await request.close(opened, option ? { answer: { option } } : {}).catch(() => null);
      }
    }
    for (const [permission, asked] of [...this.asked]) {
      if (t.permissions.some((p) => p.id === permission)) continue;
      this.asked.delete(permission);
      const option = this.picked.get(permission);
      this.picked.delete(permission);
      if (asked !== null) await request.close(asked, option ? { answer: { option } } : {}).catch(() => null);
    }
  }

  /** The core's request `request` was answered elsewhere: answer the agent the same. */
  answered(request: string, answer: unknown): void {
    const option = answer && typeof answer === "object" ? (answer as { option?: unknown }).option : undefined;
    for (const [permission, asked] of this.asked) {
      if (asked !== request) continue;
      if (typeof option === "string" && !this.picked.has(permission)) void this.command({ type: "answer", id: crypto.randomUUID(), permissionId: permission, optionId: option });
    }
  }

  close(): void {
    this.closed = true;
    this.#taking?.stop();
    this.socket?.destroy();
  }
}

const links = new Map<number, Promise<Link | undefined>>();

/** Connects to `path`, or answers `undefined` when nothing serves it. */
function connect(path: string): Promise<Socket | undefined> {
  if (!existsSync(path)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", () => resolve(undefined));
  });
}

/** The Bun the host runs on: the `bun` option, else the app's own (a compiled app acts as Bun with `BUN_BE_BUN`). */
async function bun(): Promise<string> {
  const given = await option.get("bun").catch(() => "");
  return typeof given === "string" && given !== "" ? given : process.execPath;
}

/** Starts pane `id`'s host, detached, its output in `hosts/<pane>.log`. */
async function startHost(id: number, spec: HostSpec): Promise<void> {
  mkdirSync(hostsDir(), { recursive: true, mode: 0o700 });
  const log = openSync(join(hostsDir(), `${id}.log`), "a");
  const child = spawn(await bun(), [join(self.plugin.dir, "src", "host.ts"), JSON.stringify(spec)], {
    cwd: self.plugin.dir,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, BUN_BE_BUN: "1" },
  });
  child.unref();
}

/** Pane `id`'s link, connected to its host; one is started when none runs. `undefined` until the pane names an agent. */
function ensure(id: number): Promise<Link | undefined> {
  const had = links.get(id);
  if (had) return had;
  const made = link(id).catch((err) => {
    links.delete(id);
    throw err;
  });
  links.set(id, made);
  return made;
}

async function link(id: number): Promise<Link | undefined> {
  const name = await optionOn<string>(AGENT, id);
  if (!name) {
    links.delete(id);
    return undefined;
  }
  const path = socketPath(hostsDir(), id);
  let socket = await connect(path);
  if (!socket) {
    const def = (await table())[name];
    if (!def) throw new ApiError("not_found", `acp: no agent \`${name}\` in the table (the \`agents\` option adds one)`);
    const cwd = (await optionOn<string>(CWD, id)) ?? homedir();
    const session = await optionOn<string>(SESSION, id);
    const mode = session ? "load" : (await optionOn<string>(MODE, id)) === "pick" ? "pick" : "new";
    const launch = launchOf(def, searchPath(process.env.PATH));
    await startHost(id, { socket: path, agent: name, name: def.name, command: launch.command, env: launch.env, cwd, mode, ...(session ? { session } : {}) });
    for (let i = 0; i < 100 && !socket; i++) {
      await Bun.sleep(100);
      socket = await connect(path);
    }
    if (!socket) throw new ApiError("internal", `acp: the host for pane ${id} did not start (see ${join(hostsDir(), `${id}.log`)})`);
  }
  const each = new Link(id);
  each.socket = socket;
  socket.on("data", lineReader((line) => each.hear(JSON.parse(line))));
  socket.on("error", () => {});
  socket.on("close", () => {
    links.delete(id);
    if (each.closed) return;
    // The host went: the view offers to start it again.
    const gone: HostState = { ...(each.state ?? { agent: name, name, cwd: "", pid: 0, canList: false, canLoad: false, canResume: false }), phase: "exited", error: "The agent's host stopped." };
    ui.post(`state.${id}`, gone);
  });
  each.send({ t: "hello" });
  return each;
}

/** Stops pane `id`'s host (it closed, or goes back to a terminal), whether or not this worker followed it. */
async function stopHost(id: number): Promise<void> {
  const known = await links.get(id)?.catch(() => undefined);
  links.delete(id);
  const socket = known?.socket ?? (await connect(socketPath(hostsDir(), id)));
  if (!socket) return;
  known && (known.closed = true);
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.write(`${JSON.stringify({ t: "stop" } satisfies ToHost)}\n`);
    setTimeout(resolve, 3000);
  });
}

// ── The panes ────────────────────────────────────────────────────────────────────────────────

/** Every ACP pane gets its host; a host whose pane is gone is stopped. */
async function reconcile(): Promise<void> {
  const ours = (await workspace.panes({ block: chatBlock() })).map((each) => numberOf(each.id));
  for (const id of ours) void ensure(id).catch((err) => console.error(`acp: pane ${id}: ${err?.message ?? err}`));
  const dirs = [hostsDir(), join("/tmp", `pumi-acp-${process.getuid?.() ?? 0}`)].filter((dir) => existsSync(dir));
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      const id = Number(file.replace(/\.sock$/, ""));
      if (file.endsWith(".sock") && Number.isInteger(id) && !ours.includes(id)) void stopHost(id);
    }
  }
}

on("pane.closed", (e) => {
  if (e.data?.block === chatBlock()) void stopHost(numberOf(String(e.pane)));
});
on("pane.opened", async (e) => {
  const id = numberOf(String(e.pane));
  if ((await optionOn<string>(CONVERSATION, id)) === self.plugin.id) void ensure(id).catch(() => {});
});
on("request.closed", async (e) => {
  const pane = typeof e.data?.pane === "string" ? numberOf(e.data.pane) : undefined;
  if (pane === undefined) return;
  const each = await links.get(pane)?.catch(() => undefined);
  each?.answered(String(e.data?.request), e.data?.answer);
});

/** Where a new pane starts: the given directory, else the focused pane's. */
async function cwdFrom(given: unknown, beside: number | undefined): Promise<string> {
  if (typeof given === "string" && given !== "") return resolve(given.replace(/^~(?=\/|$)/, homedir()));
  if (beside !== undefined) {
    const there = (await optionOn<string>("pane_current_path", beside)) ?? (await optionOn<string>(CWD, beside));
    if (there) return there;
  }
  return homedir();
}

interface OpenArgs {
  agent?: string;
  cwd?: string;
  pane?: number;
}

/** An ACP pane beside `beside`: with `agent` it starts at once, else it asks which. */
async function openPane(args: OpenArgs | undefined, mode: "new" | "pick" | "load", session?: string): Promise<number> {
  const beside = args?.pane ?? (await workspace.ready.then(() => (workspace.currentPane ? numberOf(workspace.currentPane.id) : undefined)));
  const near = typeof beside === "number" && Number.isInteger(beside) ? beside : undefined;
  const cwd = await cwdFrom(args?.cwd, near);
  const opened = await workspace.openPane(chatBlock(), {}, near !== undefined ? { kind: "tiled", beside: paneRef(near) } : { kind: "tiled" });
  const id = numberOf(opened.id);
  await setOn(CONVERSATION, self.plugin.id, id);
  await setOn(CWD, cwd, id);
  await setOn(MODE, mode === "load" ? "new" : mode, id);
  if (session) await setOn(SESSION, session, id);
  if (args?.agent) await begin(id, args.agent, cwd, mode === "pick" ? "pick" : "new");
  return id;
}

fn.set("new", { desc: "An ACP pane beside the current one, its agent started at once.", parameters: [["table", "args"]] }, (args?: OpenArgs) => openPane(args, "new"));
fn.set("open", { desc: "An ACP pane beside the current one, to pick an agent and a session in.", parameters: [["table", "args"]] }, (args?: OpenArgs) => openPane(args, "pick"));

/** The busy states a handoff waits out. */
const BUSY = new Set(["working", "blocked"]);

/** A terminal agent's session, continued in an ACP pane in its place: once its turn is over, its TUI is closed. */
fn.set("handoff", { desc: "A terminal agent's session, continued in an ACP pane in its place.", parameters: [["table", "args"]] }, async (args?: { pane?: number }) => {
  const from = args?.pane ?? (await here());
  const name = await optionOn<string>(AGENT, from);
  const session = await optionOn<string>(SESSION, from);
  if ((await optionOn<string>(CONVERSATION, from)) === self.plugin.id) throw new ApiError("invalid_params", "acp: this is an ACP pane already");
  if (!name || !session) throw new ApiError("invalid_params", "acp: the pane has no agent session to continue (`@agent` and `@agent.session`)");
  if (!(await table())[name]) throw new ApiError("not_found", `acp: no ACP command for \`${name}\``);
  for (let waited = 0; BUSY.has((await optionOn<string>("@agent.status", from)) ?? ""); waited += 500) {
    if (waited === 0) void request.open({ kind: "notification", title: `acp: waiting for ${name} to finish its turn` });
    if (waited > 120_000) throw new ApiError("timeout", `acp: ${name} is still busy`);
    await Bun.sleep(500);
  }
  const cwd = await cwdFrom(undefined, from);
  const id = await openPane({ pane: from, cwd }, "load", session);
  // One process owns a session: the TUI goes (closing its pane hangs it up) before the host loads it.
  await call("pane.close", paneRef(from));
  await Bun.sleep(1000);
  await begin(id, name, cwd, "new");
  return id;
});

/** An ACP pane's session, continued in its agent's own TUI in a terminal in its place. */
fn.set("back", { desc: "An ACP pane's session, continued in its agent's own TUI in a terminal in its place.", parameters: [["table", "args"]] }, async (args?: { pane?: number }) => {
  const from = args?.pane ?? (await here());
  if ((await optionOn<string>(CONVERSATION, from)) !== self.plugin.id) throw new ApiError("invalid_params", "acp: this is not an ACP pane");
  const name = (await optionOn<string>(AGENT, from)) ?? "";
  const session = await optionOn<string>(SESSION, from);
  const recipe = (await table())[name]?.resume;
  const line = recipe && session ? resumeLine(recipe, session) : undefined;
  if (!line) throw new ApiError("invalid_params", `acp: no way to resume ${name || "this agent"}'s session in a terminal`);
  const cwd = (await optionOn<string>(CWD, from)) ?? homedir();
  await stopHost(from);
  const opened = await workspace.openPane("terminal", { cwd }, { kind: "tiled", beside: paneRef(from), split: "right" });
  await call("pane.call", opened.id, "input", { text: `${line}\r` });
  await call("pane.close", paneRef(from));
  return numberOf(opened.id);
});

// ── The conversation, for anyone ─────────────────────────────────────────────────────────────

/** Where pane `id`'s conversation stands, once its host has said. */
async function transcriptOf(id: number): Promise<Transcript | undefined> {
  const each = await ensure(id);
  for (let i = 0; i < 50 && each && !each.transcript; i++) await Bun.sleep(100);
  return each?.transcript;
}

fn.set(
  names().read,
  {
    desc: "An ACP pane's conversation: the whole of it (`{snapshot, cursor}`), or nothing new when `since` is where it stands (`{changes: [], cursor}`).",
    effect: "read",
    parameters: [
      ["number", "pane"],
      ["object", "since"],
    ],
  },
  async (id: number, since?: Cursor) => {
    const t = await transcriptOf(Number(id));
    if (!t) throw new ApiError("not_found", `acp: pane ${id} has no conversation yet`);
    const cursor = { epoch: t.epoch, seq: t.seq };
    if (since && since.epoch === t.epoch && since.seq === t.seq) return { changes: [], cursor };
    return { snapshot: t, cursor };
  },
);

fn.set(
  names().send,
  {
    desc: "Send an ACP pane's agent a command (lib/conversation's `Command`: a prompt, a cancel, an answer, an option); answers the host's `Ack`.",
    effect: "write",
    parameters: [
      ["number", "pane"],
      ["object", "command"],
    ],
  },
  (id: number, command: Command) => send(Number(id), command),
);

// ── What the view calls ──────────────────────────────────────────────────────────────────────

/** The agents to pick from, and whether each is installed (else `npx` fetches it, or it is missing). */
export async function agents(): Promise<{ id: string; name: string; installed: boolean }[]> {
  const path = searchPath(process.env.PATH);
  return Object.entries(await table()).map(([id, def]) => ({ id, name: def.name, installed: installed(def, path) }));
}

/** Starts pane `id`'s agent in `cwd`: a new session, or the agent's list to pick from. */
export async function begin(id: number, name: string, cwd: string, mode: "new" | "pick"): Promise<void> {
  if (!(await table())[name]) throw new ApiError("not_found", `acp: no agent \`${name}\``);
  await setOn(CONVERSATION, self.plugin.id, id);
  await setOn(CWD, await cwdFrom(cwd, undefined), id);
  if (!(await optionOn<string>(SESSION, id))) await setOn(MODE, mode, id);
  await setOn(AGENT, name, id);
  await ensure(id);
}

/** The host's state and the conversation, for a view that mounts. */
export async function attach(id: number): Promise<{ state?: HostState; transcript?: Transcript }> {
  const each = await ensure(id);
  for (let i = 0; i < 30 && each && !each.state; i++) await Bun.sleep(100);
  return { state: each?.state, transcript: each?.transcript };
}

export async function send(id: number, command: Command): Promise<Ack> {
  const each = await ensure(id);
  if (!each) return { id: command.id, rejected: "no agent runs in this pane" };
  // A prompt is a turn of its own: what pumi has for the agent goes with it (`agent.turn`).
  if (command.type === "prompt") await each.told("prompt");
  return each.command(command);
}

/** In the picker: continue `session`, or a new one. */
export async function start(id: number, session: string | null): Promise<void> {
  (await ensure(id))?.send({ t: "start", session });
}

export async function authenticate(id: number, method: string): Promise<void> {
  (await ensure(id))?.send({ t: "auth", method });
}

export async function retry(id: number): Promise<void> {
  (await ensure(id))?.send({ t: "retry" });
}

/** A host that stopped, or an agent that exited, started again: on its session when it has one. */
export async function restart(id: number): Promise<void> {
  await stopHost(id);
  await ensure(id);
}

/** The agent's own sign-in, in a terminal beside the pane. */
export async function login(id: number): Promise<void> {
  const name = (await optionOn<string>(AGENT, id)) ?? "";
  const words = (await table())[name]?.login;
  if (!words) throw new ApiError("not_found", `acp: no sign-in command for ${name}`);
  const cwd = (await optionOn<string>(CWD, id)) ?? homedir();
  await workspace.openPane("terminal", { command: words, cwd }, { kind: "tiled", beside: paneRef(id), split: "down" });
}

void reconcile().catch((err) => console.error(`acp: ${err?.message ?? err}`));
