// Session tabs: an agent run by the plugin rather than in a terminal, drawn as the chat. Each tab of
// the `session` block runs its agent under a host process (`session/host.ts`) the worker starts
// detached, so the agent outlives the app; the worker is a client of each host's socket
// (`session/wire.ts`), as any other could be. The host speaks to the agent over ACP or the agent's
// own protocol (the tab's engine). The worker relays the conversation to the tab's view
// (`ui.post`), serves it to anyone (`conversation.read`/`send`, `conversation.changed`), and keeps
// the tab an agent like a terminal's: `@agent`, `@agent.status` (by `tab.call`'s `report`),
// `@agent.session`, `@agent.model`, `@agent.conversation`, and its permission prompts asked through
// `request.open`, so any UI can answer them. After the app or the server starts again it finds the
// hosts again, or starts new ones that load the session.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { ApiError, agent, call, emit, on, option, paths, request, self, ui, workspace } from "pumi";

import { follow, type Update } from "./conversation/change.ts";
import { optionOf, type Ack, type Command, type Cursor, type Transcript } from "./conversation/model.ts";
import { currentName } from "./conversation/view.ts";
import { catalogAgent, type CatalogAgent } from "./catalog.ts";
import { installed, launchOf, resumeLine, searchPath } from "./session/launch.ts";
import { lineReader } from "./session/rpc.ts";
import { fallbackDir, socketPath, type Engine, type FromHost, type HostSpec, type HostState, type ToHost } from "./session/wire.ts";

/** The tab options a session tab keeps (beside the `@agent.*` ones every agent has). */
const CWD = "@chat_ui.cwd";
/** How its first session begins, until it has one: `new` or `pick`. */
const START = "@chat_ui.start";
/** Its engine (`session/wire.ts` `Engine`). */
const ENGINE = "@chat_ui.engine";
const AGENT = "@agent";
const SESSION = "@agent.session";
const MODEL = "@agent.model";
const CONVERSATION = "@agent.conversation";

/** The topics a session tab's view hears its host on. */
export const stateTopic = (tab: number) => `session.state.${tab}`;
export const updateTopic = (tab: number) => `session.update.${tab}`;

export const sessionBlock = () => self.plugin.prefixed("session");
const hostsDir = () => join(paths.state, "hosts");

/** A tab's id as the API has it (`%3`), from the number this plugin keeps of it. */
const tabRef = (tab: number): string => `%${tab}`;

/** The number a tab's id names (`%3` is `3`). */
const numberOf = (id: string): number => Number(id.slice(id.indexOf("/") + 1).replace(/^[%@$]/, ""));

const optionOn = async <T>(name: string, id: number): Promise<T | undefined> => {
  const value = await option.get(name, { scope: "tab", id: tabRef(id) }).catch(() => null);
  return value === null || value === "" ? undefined : (value as T);
};

/** One of tab `id`'s own options, set. */
const setOn = (name: string, value: unknown, id: number): Promise<null> => option.set(name, value, { scope: "tab", id: tabRef(id) });

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── How a host starts ─────────────────────────────────────────────────────────────────────────

/** The command line the host runs `agent`'s server with, for `engine`; `claude` runs none (the SDK is in the host). */
export function serverCommand(agent: CatalogAgent, engine: Engine, path: string, session?: string): { command: string[]; env: Record<string, string> } {
  switch (engine) {
    case "acp":
      if (!agent.acp) throw new ApiError("invalid_params", `chat-ui: ${agent.title} has no ACP server`);
      return launchOf(agent.acp.run, agent.acp.env, path);
    case "pi":
      // On the tab's session when it has one: pi loads it as it starts.
      return launchOf([[agent.program, "--mode", "rpc", ...(session ? ["--session", session] : [])]], {}, path);
    case "codex":
      return launchOf([[agent.program, "app-server"]], {}, path);
    case "claude":
      return { command: [], env: {} };
  }
}

/** Whether `agent` can start with `engine` without fetching anything. */
export function engineInstalled(agent: CatalogAgent, engine: Engine, path = searchPath(process.env.PATH)): boolean {
  if (engine === "acp") return !!agent.acp && installed(agent.acp.run, path);
  return installed([[agent.program]], path);
}

// ── One tab's link to its host ───────────────────────────────────────────────────────────────

/** A tab's host as the worker follows it. */
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

  constructor(readonly tab: number) {}

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
        ui.post(stateTopic(this.tab), message.state);
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
    const was = this.transcript;
    const next = follow(was, update);
    if (!next) {
      // Out of step (or nothing yet): ask for where it stands.
      this.send({ t: "hello" });
      return;
    }
    if (next === was) return;
    this.transcript = next;
    ui.post(updateTopic(this.tab), update);
    const cursor: Cursor = { epoch: next.epoch, seq: next.seq };
    const changes = update.type === "changes" ? update.changes : [];
    const from = update.type === "changes" ? update.from : null;
    void emit("conversation.changed", { tab: this.tab, changes, cursor, from }, { tab: tabRef(this.tab) }).catch(() => {});
    void this.#sync();
  }

  /** The tab's options and status as the host and the transcript say, and its requests to the user. */
  async #sync(): Promise<void> {
    const t = this.transcript;
    const id = this.tab;
    const was = this.#reported;
    const status = t?.status;
    if (status && status !== was.status) {
      was.status = status;
      await call("tab.call", tabRef(id), "report", { body: `state=${status}:app=chat-ui` }).catch(() => {});
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
      await call("tab.call", tabRef(id), "report", { title }).catch(() => {});
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
    const name = this.state?.agent || (await optionOn<string>(AGENT, this.tab));
    if (!name) return;
    await this.#tell(event, name, this.state?.session ?? this.transcript?.session?.id);
  }

  async #told(): Promise<void> {
    const t = this.transcript;
    if (!t || this.closed || this.state?.phase !== "ready") return;
    const name = this.state?.agent || (await optionOn<string>(AGENT, this.tab));
    const session = this.state?.session ?? t.session?.id;
    if (!name) return;
    const busy = t.status === "working" || t.status === "blocked" || this.#taking !== undefined;
    if (!this.#started) {
      this.#started = true;
      const resumed = (await optionOn<string>(SESSION, this.tab)) !== undefined;
      await this.#tell("start", name, session, resumed);
    }
    if (!busy) this.#take(session);
  }

  /** Asks the core what the agent should know now, and hands it to the host for its next prompt. */
  async #tell(event: "start" | "prompt", name: string, _session: string | undefined, resumed = false): Promise<void> {
    const said = await agent.turn(tabRef(this.tab), { agent: name, event, ...(resumed ? { resumed } : {}) }).catch((err) => {
      console.error(`chat-ui: agent.turn for ${this.tab}: ${message(err)}`);
      return null;
    });
    // What pumi has for the agent: the core frames each contribution as a paragraph of it.
    const text = said?.context ?? "";
    if (text !== "") await this.command({ type: "context", id: crypto.randomUUID(), text });
  }

  /** Holds a `pumi agent take %3 --wait` for this tab while it is idle: a queued message is a prompt. */
  #take(session: string | undefined): void {
    if (!session || this.#taking) return;
    const tab = this.tab;
    let child: ReturnType<typeof spawn>;
    const stop = () => {
      this.#taking = undefined;
      try {
        child?.kill();
      } catch {
        // It exited while the take was being stopped: nothing left to kill.
      }
    };
    this.#taking = { stop };
    const args = ["agent", "take", tabRef(tab), "--session", session, "--wait", "--json"];
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
      } catch {
        // What it printed is not the message: nothing was taken.
      }
      const text = typeof item?.text === "string" ? item.text : "";
      if (!text || this.closed) return;
      // The agent's turn starts with the message: what it is told now goes first (`agent.turn`).
      void (async () => {
        await this.told("prompt");
        await this.command({ type: "prompt", id: crypto.randomUUID(), text });
      })().catch((err) => console.error(`chat-ui: tab ${tab}: ${message(err)}`));
    });
  }

  /** Each permission waiting is a core request too; each one gone ends its request. */
  async #requests(t: Transcript): Promise<void> {
    if (!this.#swept) {
      // Requests left from before the app started again whose permission has gone wait for nothing.
      this.#swept = true;
      for (const r of await workspace.requests({ tab: tabRef(this.tab) }).catch(() => [])) {
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
      const pending = await workspace.requests({ tab: tabRef(this.tab) }).catch(() => []);
      const same = pending.find((r) => r.title === ask.title && JSON.stringify((r.options ?? []).map((o: any) => o.id)) === JSON.stringify(ask.options.map((o) => o.id)));
      const opened = same ? same.id : await request.open(ask, { tab: tabRef(this.tab) }).catch(() => null);
      if (this.asked.has(permission.id)) this.asked.set(permission.id, opened);
      else if (opened !== null) {
        // It was answered or withdrawn while the request was being made.
        const picked = this.picked.get(permission.id);
        this.picked.delete(permission.id);
        await request.close(opened, picked ? { answer: { option: picked } } : {}).catch(() => null);
      }
    }
    for (const [permission, asked] of [...this.asked]) {
      if (t.permissions.some((p) => p.id === permission)) continue;
      this.asked.delete(permission);
      const picked = this.picked.get(permission);
      this.picked.delete(permission);
      if (asked !== null) await request.close(asked, picked ? { answer: { option: picked } } : {}).catch(() => null);
    }
  }

  /** The core's request `request` was answered elsewhere: answer the agent the same. */
  answered(request: string, answer: unknown): void {
    const picked = answer && typeof answer === "object" ? (answer as { option?: unknown }).option : undefined;
    for (const [permission, asked] of this.asked) {
      if (asked !== request) continue;
      if (typeof picked === "string" && !this.picked.has(permission)) void this.command({ type: "answer", id: crypto.randomUUID(), permissionId: permission, optionId: picked });
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

/** Starts tab `id`'s host, detached, its output in `hosts/<tab>.log`. */
async function startHost(id: number, spec: HostSpec): Promise<void> {
  mkdirSync(hostsDir(), { recursive: true, mode: 0o700 });
  const log = openSync(join(hostsDir(), `${id}.log`), "a");
  const child = spawn(await bun(), [join(self.plugin.dir, "src", "session", "host.ts"), JSON.stringify(spec)], {
    cwd: self.plugin.dir,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, BUN_BE_BUN: "1" },
  });
  child.unref();
}

/** Tab `id`'s link, connected to its host; one is started when none runs. `undefined` until the tab names an agent. */
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
    const def = catalogAgent(name);
    if (!def) throw new ApiError("not_found", `chat-ui: no agent \`${name}\``);
    const engine = ((await optionOn<string>(ENGINE, id)) ?? "acp") as Engine;
    const cwd = (await optionOn<string>(CWD, id)) ?? homedir();
    const session = await optionOn<string>(SESSION, id);
    const mode = session ? "load" : (await optionOn<string>(START, id)) === "pick" ? "pick" : "new";
    const launch = serverCommand(def, engine, searchPath(process.env.PATH), session);
    await startHost(id, { socket: path, agent: name, name: def.title, engine, command: launch.command, env: launch.env, cwd, mode, ...(session ? { session } : {}) });
    for (let i = 0; i < 100 && !socket; i++) {
      await Bun.sleep(100);
      socket = await connect(path);
    }
    if (!socket) throw new ApiError("internal", `chat-ui: the host for tab ${id} did not start (see ${join(hostsDir(), `${id}.log`)})`);
  }
  const each = new Link(id);
  each.socket = socket;
  socket.on(
    "data",
    lineReader((line) => {
      let heard: FromHost;
      try {
        heard = JSON.parse(line);
      } catch {
        console.error(`chat-ui: tab ${id}: the host said something that is not JSON`);
        return;
      }
      each.hear(heard);
    }),
  );
  socket.on("error", () => {});
  socket.on("close", () => {
    links.delete(id);
    if (each.closed) return;
    // The host went: the view offers to start it again.
    const gone: HostState = { ...(each.state ?? { agent: name, name, cwd: "", pid: 0, canList: false, canLoad: false, canResume: false }), phase: "exited", error: "The agent's host stopped." };
    ui.post(stateTopic(id), gone);
  });
  each.send({ t: "hello" });
  return each;
}

/** Stops tab `id`'s host (it closed, or goes back to a terminal), whether or not this worker followed it. */
async function stopHost(id: number): Promise<void> {
  const known = await links.get(id)?.catch(() => undefined);
  links.delete(id);
  const socket = known?.socket ?? (await connect(socketPath(hostsDir(), id)));
  if (!socket) return;
  if (known) known.closed = true;
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.write(`${JSON.stringify({ t: "stop" } satisfies ToHost)}\n`);
    setTimeout(resolve, 3000);
  });
}

// ── The tabs ─────────────────────────────────────────────────────────────────────────────────

/** Whether tab `id` is a session tab of this plugin's. */
export async function isSessionTab(id: number): Promise<boolean> {
  return (await optionOn<string>(ENGINE, id)) !== undefined;
}

/** Every session tab gets its host; a host whose tab is gone is stopped. */
export async function reconcile(): Promise<void> {
  const ours = (await workspace.tabs({ block: sessionBlock() })).map((each) => numberOf(each.id));
  for (const id of ours) void ensure(id).catch((err) => console.error(`chat-ui: tab ${id}: ${message(err)}`));
  for (const dir of [hostsDir(), fallbackDir()].filter((dir) => existsSync(dir))) {
    for (const file of readdirSync(dir)) {
      const id = Number(file.replace(/\.sock$/, ""));
      if (file.endsWith(".sock") && Number.isInteger(id) && !ours.includes(id)) void stopHost(id);
    }
  }
}

on("tab.closed", { desc: "Chat UI stops a closed session tab's agent" }, (e) => {
  if (e.data?.block === sessionBlock() && typeof e.tab === "string") void stopHost(numberOf(e.tab));
});
on("tab.opened", { desc: "Chat UI starts a session tab's agent" }, async (e) => {
  if (typeof e.tab !== "string") return;
  const id = numberOf(e.tab);
  if (await isSessionTab(id)) void ensure(id).catch(() => {});
});
on("request.closed", { desc: "Chat UI answers a session's permission answered elsewhere" }, async (e) => {
  const tab = typeof e.data?.tab === "string" ? numberOf(e.data.tab) : undefined;
  if (tab === undefined) return;
  const each = await links.get(tab)?.catch(() => undefined);
  each?.answered(String(e.data?.request), e.data?.answer);
});

/** Where a new tab starts: the given directory, else the tab's beside it. */
export async function cwdFrom(given: unknown, beside: number | undefined): Promise<string> {
  if (typeof given === "string" && given !== "") return resolve(given.replace(/^~(?=\/|$)/, homedir()));
  if (beside !== undefined) {
    const there = (await optionOn<string>("tab_current_path", beside)) ?? (await optionOn<string>(CWD, beside));
    if (there) return there;
  }
  return homedir();
}

export interface OpenSession {
  agent: string;
  engine: Engine;
  /** The directory; the tab's beside it without. */
  cwd?: string;
  /** The tab it opens beside. */
  beside?: number;
  /** Where it opens, as `tab.open` takes it; beside `beside` without. */
  place?: unknown;
  /** A session to continue. */
  session?: string;
  /** Without a session: a new one, or the agent's list to pick from. */
  start?: "new" | "pick";
}

/** A session tab, its agent started at once. */
export async function openSession(given: OpenSession): Promise<number> {
  const cwd = await cwdFrom(given.cwd, given.beside);
  const place = given.place ?? (given.beside !== undefined ? { kind: "tiled", beside: tabRef(given.beside) } : { kind: "tiled" });
  const opened = await workspace.openTab(sessionBlock(), {}, place);
  const id = numberOf(opened.id);
  await setOn(CONVERSATION, self.plugin.id, id);
  await setOn(ENGINE, given.engine, id);
  await setOn(CWD, cwd, id);
  await setOn(START, given.start ?? "new", id);
  if (given.session) await setOn(SESSION, given.session, id);
  await setOn(AGENT, given.agent, id);
  await ensure(id);
  return id;
}

/** The busy states a handoff waits out. */
const BUSY = new Set(["working", "blocked"]);

/** A terminal agent's session, continued in a session tab in its place: once its turn is over, its TUI is closed. */
export async function handoff(from: number, engine: Engine): Promise<number> {
  const name = await optionOn<string>(AGENT, from);
  const session = await optionOn<string>(SESSION, from);
  if (await isSessionTab(from)) throw new ApiError("invalid_params", "chat-ui: this is a session tab already");
  if (!name || !session) throw new ApiError("invalid_params", "chat-ui: the tab has no agent session to continue (`@agent` and `@agent.session`)");
  if (!catalogAgent(name)) throw new ApiError("not_found", `chat-ui: no agent \`${name}\``);
  for (let waited = 0; BUSY.has((await optionOn<string>("@agent.status", from)) ?? ""); waited += 500) {
    if (waited === 0) void request.open({ kind: "notification", title: `Chat UI: waiting for ${name} to finish its turn` });
    if (waited > 120_000) throw new ApiError("timeout", `chat-ui: ${name} is still busy`);
    await Bun.sleep(500);
  }
  const cwd = await cwdFrom(undefined, from);
  // One process owns a session: the TUI goes (closing its tab hangs it up) before the host loads it.
  const opened = await workspace.openTab(sessionBlock(), {}, { kind: "tiled", beside: tabRef(from) });
  const id = numberOf(opened.id);
  await setOn(CONVERSATION, self.plugin.id, id);
  await setOn(ENGINE, engine, id);
  await setOn(CWD, cwd, id);
  await setOn(START, "new", id);
  await setOn(SESSION, session, id);
  await call("tab.close", tabRef(from));
  await Bun.sleep(1000);
  await setOn(AGENT, name, id);
  await ensure(id);
  return id;
}

/** A session tab's session, continued in its agent's own TUI in a terminal in its place. */
export async function back(from: number): Promise<number> {
  if (!(await isSessionTab(from))) throw new ApiError("invalid_params", "chat-ui: this is not a session tab");
  const name = (await optionOn<string>(AGENT, from)) ?? "";
  const session = await optionOn<string>(SESSION, from);
  const recipe = catalogAgent(name)?.resume;
  const line = recipe && session ? resumeLine(recipe, session) : undefined;
  if (!line) throw new ApiError("invalid_params", `chat-ui: no way to resume ${name || "this agent"}'s session in a terminal`);
  const cwd = (await optionOn<string>(CWD, from)) ?? homedir();
  await stopHost(from);
  const opened = await workspace.openTab("terminal", { cwd }, { kind: "tiled", beside: tabRef(from) });
  await call("tab.call", opened.id, "input", { text: `${line}\r` });
  await call("tab.close", tabRef(from));
  return numberOf(opened.id);
}

// ── The conversation ─────────────────────────────────────────────────────────────────────────

/** Where tab `id`'s conversation stands, once its host has said. */
async function transcriptOf(id: number): Promise<Transcript | undefined> {
  const each = await ensure(id);
  for (let i = 0; i < 50 && each && !each.transcript; i++) await Bun.sleep(100);
  return each?.transcript;
}

/** What brings a reader of tab `id`'s conversation at `since` up to now: nothing new, or a snapshot. */
export async function sessionRead(id: number, since?: Cursor): Promise<Update> {
  const t = await transcriptOf(id);
  if (!t) throw new ApiError("not_found", `chat-ui: tab ${id} has no conversation yet`);
  if (since && since.epoch === t.epoch && since.seq === t.seq) return { type: "changes", from: since, to: since, changes: [] };
  return { type: "snapshot", transcript: t };
}

export async function sessionSend(id: number, command: Command): Promise<Ack> {
  const each = await ensure(id);
  if (!each) return { id: command.id, rejected: "no agent runs in this tab" };
  // A prompt is a turn of its own: what pumi has for the agent goes with it (`agent.turn`).
  if (command.type === "prompt") await each.told("prompt");
  const ack = await each.command(command);
  // A fork is a new session: it opens in a tab of its own beside this one.
  if (command.type === "fork" && ack.session && !ack.rejected) {
    const name = await optionOn<string>(AGENT, id);
    const engine = await optionOn<Engine>(ENGINE, id);
    if (name && engine) await openSession({ agent: name, engine, cwd: await optionOn<string>(CWD, id), beside: id, session: ack.session });
  }
  return ack;
}

// ── What the view calls ──────────────────────────────────────────────────────────────────────

/** The host's state and the conversation, for a view that mounts. */
export async function attach(id: number): Promise<{ state?: HostState; transcript?: Transcript }> {
  const each = await ensure(id);
  for (let i = 0; i < 30 && each && !each.state; i++) await Bun.sleep(100);
  return { state: each?.state, transcript: each?.transcript };
}

/** In the picker: continue `session`, or a new one. */
export async function startSession(id: number, session: string | null): Promise<void> {
  (await ensure(id))?.send({ t: "start", session });
}

export async function authenticate(id: number, method: string): Promise<void> {
  (await ensure(id))?.send({ t: "auth", method });
}

export async function retry(id: number): Promise<void> {
  (await ensure(id))?.send({ t: "retry" });
}

/** The tab each chat follows its agent in (the crosshair): one file tab beside it, its file changed as the agent moves. */
const following = new Map<number, string>();

/** Shows `path` (at `line`) in the file tab tab `id` follows its agent in, opened beside it the first time; the chat keeps the keyboard. */
export async function followFile(id: number, path: string, line?: number): Promise<void> {
  const cwd = (await optionOn<string>(CWD, id)) ?? homedir();
  const args = { path: resolve(cwd, path.replace(/^~(?=\/|$)/, homedir())), ...(line ? { line } : {}) };
  const had = following.get(id);
  const open = had && (await workspace.tabs().catch(() => [])).some((each) => each.id === had || each.id.endsWith(`/${had}`));
  const place = open ? { kind: "tiled", replace: had, focus: false } : { kind: "tiled", beside: tabRef(id), split: "right", focus: false };
  const opened = await workspace.openTab("file", args, place);
  following.set(id, opened.id);
}

/** A host that stopped, or an agent that exited, started again: on its session when it has one. */
export async function restart(id: number): Promise<void> {
  await stopHost(id);
  await ensure(id);
}

/** The agent's own sign-in, in a terminal beside the tab. */
export async function login(id: number): Promise<void> {
  const name = (await optionOn<string>(AGENT, id)) ?? "";
  const def = catalogAgent(name);
  const words = def?.acp?.login ?? (def ? [def.program] : undefined);
  if (!words) throw new ApiError("not_found", `chat-ui: no sign-in command for ${name}`);
  const cwd = (await optionOn<string>(CWD, id)) ?? homedir();
  await workspace.openTab("terminal", { command: words, cwd }, { kind: "tiled", beside: tabRef(id), split: "down" });
}
