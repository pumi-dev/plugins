// Session tabs: an agent run by the plugin rather than in a terminal, drawn as the chat. Each tab of
// the `session` block runs its agent under a host process (`session/host.ts`) the worker starts
// detached, so the agent outlives the app; the worker is a client of each host's socket
// (`session/wire.ts`), as any other could be. The host speaks to the agent over ACP or the agent's
// own protocol (the tab's engine). The worker relays the conversation to the tab's view
// (`ui.post`), serves it to anyone (`conversation.read`/`send`, `conversation.changed`), and keeps
// the tab an agent like a terminal's: the plugin's trait (`names.ts`), `@status` (by `tab.call`'s
// `report`), and its permission prompts asked through `request.open`, so any UI can answer them.
// What it is told about the workspace (`tell.ts`) goes ahead of its first prompt and each one
// after. After the app or the server starts again it finds the hosts again, or starts new ones
// that load the session.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { ApiError, call, emit, on, option, paths, request, self, ui, workspace } from "pumi";

import { follow, type Update } from "./conversation/change.ts";
import { optionOf, type Ack, type Command, type Cursor, type Transcript } from "./conversation/model.ts";
import { currentName } from "./conversation/view.ts";
import { catalogAgent, type CatalogAgent } from "./catalog.ts";
import { agentPath, agentPathReady, installed, launchOf, resumeLine } from "./session/launch.ts";
import { lineReader } from "./session/rpc.ts";
import { fallbackDir, socketPath, type Engine, type FromHost, type HostSpec, type HostState, type ToHost } from "./session/wire.ts";
import { AGENT, AGENT_CONVERSATION as CONVERSATION, AGENT_MODEL as MODEL, AGENT_SESSION as SESSION, SESSION_CWD as CWD, SESSION_ENGINE as ENGINE, SESSION_START as START, STATUS } from "./names.ts";
import { tell } from "./tell.ts";


/** Opens a terminal for an agent (`main.ts` `openTerminal`): the plugin's own block, its hook on. */
export type OpenTerminal = (agent: string, opts: { cwd?: string; place?: unknown; run?: string }) => Promise<string>;
let openTerminal: OpenTerminal | undefined;
/** How `back` opens the agent's terminal: `main.ts` gives it. */
export function setOpenTerminal(open: OpenTerminal): void {
  openTerminal = open;
}

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
      if (!agent.acp) throw new ApiError("invalid_params", `agents: ${agent.title} has no ACP server`);
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
export function engineInstalled(agent: CatalogAgent, engine: Engine, path = agentPath()): boolean {
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
  /** Whether the agent has been told the workspace at its start. */
  #started = false;

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
      await call("tab.call", tabRef(id), "report", { body: `state=${status}:app=agents` }).catch(() => {});
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
      await call("tab.update", tabRef(id), { title }).catch(() => {});
    }
    if (t) await this.#requests(t);
    void this.#told().catch(() => {});
  }

  /** What the agent is told about the workspace before a prompt (`tell.ts`), handed to the host ahead of it. */
  async told(event: "prompt"): Promise<void> {
    const name = this.state?.agent || (await optionOn<string>(AGENT, this.tab));
    if (!name) return;
    await this.#tell(event, name, this.state?.session ?? this.transcript?.session?.id);
  }

  async #told(): Promise<void> {
    const t = this.transcript;
    if (!t || this.closed || this.state?.phase !== "ready" || this.#started) return;
    const name = this.state?.agent || (await optionOn<string>(AGENT, this.tab));
    if (!name) return;
    this.#started = true;
    const resumed = (await optionOn<string>(SESSION, this.tab)) !== undefined;
    await this.#tell("start", name, this.state?.session ?? t.session?.id, resumed);
  }

  /** What the agent should know now, as a `context` command: the host puts it ahead of the next prompt. */
  async #tell(event: "start" | "prompt", name: string, session: string | undefined, resumed = false): Promise<void> {
    const text = await tell({ tab: tabRef(this.tab), agent: name, session: session ?? null, event, resumed, full: false, peek: false }).catch((err) => {
      console.error(`agents: the context for tab ${this.tab}: ${message(err)}`);
      return null;
    });
    if (text) await this.command({ type: "context", id: crypto.randomUUID(), text });
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

/** The Bun the host runs on: the app's own (a compiled app acts as Bun with `BUN_BE_BUN`). */
const bun = (): string => process.execPath;

/** Starts tab `id`'s host, detached, its output in `hosts/<tab>.log`; it and the agent it starts run on `path`. */
async function startHost(id: number, spec: HostSpec, path: string): Promise<void> {
  mkdirSync(hostsDir(), { recursive: true, mode: 0o700 });
  const log = openSync(join(hostsDir(), `${id}.log`), "a");
  const child = spawn(bun(), [join(self.plugin.dir, "src", "session", "host.ts"), JSON.stringify(spec)], {
    cwd: self.plugin.dir,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PATH: path, BUN_BE_BUN: "1" },
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
    if (!def) throw new ApiError("not_found", `agents: no agent \`${name}\``);
    const engine = ((await optionOn<string>(ENGINE, id)) ?? "acp") as Engine;
    const cwd = (await optionOn<string>(CWD, id)) ?? homedir();
    const session = await optionOn<string>(SESSION, id);
    const mode = session ? "load" : (await optionOn<string>(START, id)) === "pick" ? "pick" : "new";
    const run = await agentPathReady();
    const launch = serverCommand(def, engine, run, session);
    await startHost(id, { socket: path, agent: name, name: def.title, engine, command: launch.command, env: launch.env, cwd, mode, ...(session ? { session } : {}) }, run);
    for (let i = 0; i < 100 && !socket; i++) {
      await Bun.sleep(100);
      socket = await connect(path);
    }
    if (!socket) throw new ApiError("internal", `agents: the host for tab ${id} did not start (see ${join(hostsDir(), `${id}.log`)})`);
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
        console.error(`agents: tab ${id}: the host said something that is not JSON`);
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
  for (const id of ours) void ensure(id).catch((err) => console.error(`agents: tab ${id}: ${message(err)}`));
  for (const dir of [hostsDir(), fallbackDir()].filter((dir) => existsSync(dir))) {
    for (const file of readdirSync(dir)) {
      const id = Number(file.replace(/\.sock$/, ""));
      if (file.endsWith(".sock") && Number.isInteger(id) && !ours.includes(id)) void stopHost(id);
    }
  }
}

on("tab.closed", { desc: "Agents stops a closed session tab's agent" }, (e) => {
  if (e.data?.block === sessionBlock() && typeof e.tab === "string") void stopHost(numberOf(e.tab));
});
on("tab.opened", { desc: "Agents starts a session tab's agent" }, async (e) => {
  if (typeof e.tab !== "string") return;
  const id = numberOf(e.tab);
  if (await isSessionTab(id)) void ensure(id).catch(() => {});
});
on("request.closed", { desc: "Agents answers a session's permission answered elsewhere" }, async (e) => {
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
  await named(id, given.agent);
  await ensure(id);
  return id;
}

/** A session tab's title until its session has one: its agent's name, not the block's id. */
async function named(id: number, agent: string): Promise<void> {
  const title = catalogAgent(agent)?.title ?? agent;
  await call("tab.update", tabRef(id), { title }).catch(() => {});
}

/** The busy states a handoff waits out. */
const BUSY = new Set(["working", "blocked"]);

/** A terminal agent's session, continued in a session tab in its place: once its turn is over, its TUI is closed. */
export async function handoff(from: number, engine: Engine): Promise<number> {
  const name = await optionOn<string>(AGENT, from);
  const session = await optionOn<string>(SESSION, from);
  if (await isSessionTab(from)) throw new ApiError("invalid_params", "agents: this is a session tab already");
  if (!name || !session) throw new ApiError("invalid_params", "agents: the tab has no agent session to continue");
  if (!catalogAgent(name)) throw new ApiError("not_found", `agents: no agent \`${name}\``);
  for (let waited = 0; BUSY.has((await optionOn<string>(STATUS, from)) ?? ""); waited += 500) {
    if (waited === 0) void request.open({ kind: "notification", title: `Agents: waiting for ${name} to finish its turn` });
    if (waited > 120_000) throw new ApiError("timeout", `agents: ${name} is still busy`);
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
  await named(id, name);
  await ensure(id);
  return id;
}

/** A session tab's session, continued in its agent's own TUI in a terminal in its place. */
export async function back(from: number): Promise<number> {
  if (!(await isSessionTab(from))) throw new ApiError("invalid_params", "agents: this is not a session tab");
  const name = (await optionOn<string>(AGENT, from)) ?? "";
  const session = await optionOn<string>(SESSION, from);
  const recipe = catalogAgent(name)?.resume;
  const line = recipe && session ? resumeLine(recipe, session) : undefined;
  if (!line) throw new ApiError("invalid_params", `agents: no way to resume ${name || "this agent"}'s session in a terminal`);
  const cwd = (await optionOn<string>(CWD, from)) ?? homedir();
  if (!openTerminal) throw new ApiError("internal", "agents: no way to open a terminal yet");
  await stopHost(from);
  // The agent's own terminal, its hook on, in the tab's place: an agent tab again, whose chat can show.
  const opened = await openTerminal(name, { cwd, place: { kind: "tiled", beside: tabRef(from) }, run: line });
  await call("tab.close", tabRef(from));
  return numberOf(opened);
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
  if (!t) throw new ApiError("not_found", `agents: tab ${id} has no conversation yet`);
  if (since && since.epoch === t.epoch && since.seq === t.seq) return { type: "changes", from: since, to: since, changes: [] };
  return { type: "snapshot", transcript: t };
}

export async function sessionSend(id: number, command: Command): Promise<Ack> {
  const each = await ensure(id);
  if (!each) return { id: command.id, rejected: "no agent runs in this tab" };
  // A prompt is a turn of its own: what the agent is told about the workspace goes with it.
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
  if (!words) throw new ApiError("not_found", `agents: no sign-in command for ${name}`);
  const cwd = (await optionOn<string>(CWD, id)) ?? homedir();
  await workspace.openTab("terminal", { command: words, cwd }, { kind: "tiled", beside: tabRef(id), split: "down" });
}
