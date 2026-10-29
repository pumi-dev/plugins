// One ACP session, as the host runs it: `initialize`, signing in, `session/new`, `session/load`
// (its replay ends when the agent has been quiet a while, since ACP says no end), `session/resume`,
// `session/list`, prompts (queued behind the running turn), cancel, options and permissions. What
// the agent says becomes lib/conversation's changes on the host's `Producer`; what a view asks
// (`Command`) becomes ACP calls. It knows nothing of the process or the socket (`host.ts`). No
// `import … from "pumi"` here.
import {
  CommandLedger,
  Producer,
  endTurnChanges,
  noticeChange,
  promptChanges,
  type Update,
} from "../conversation/change.ts";
import {
  fromPermissionRequest,
  fromPromptResponse,
  fromSessionSetup,
  fromSessionUpdate,
  permissionResponse,
  promptBlocks,
  setOptionChange,
  setOptionRequest,
  type AcpPermissionResponse,
  type AcpPromptResponse,
  type AcpRequestPermission,
  type AcpSessionNotification,
  type AcpSessionSetup,
} from "../conversation/acp.ts";
import { optionOf, type Ack, type Command, type Image } from "../conversation/model.ts";
import { AUTH_REQUIRED, METHOD_NOT_FOUND, Peer, RpcError } from "./rpc.ts";
import type { Driver, SessionEvents } from "./engines.ts";
import type { AuthMethod, HostSpec, HostState, ListedSession } from "./wire.ts";

/** The ACP version this speaks. */
export const PROTOCOL_VERSION = 1;
/** How long a `session/load` replay may be quiet before it counts as done. */
export const REPLAY_IDLE_MS = 2000;
/** How long a `session/load` may take in all, replay and answer. */
const LOAD_TIMEOUT_MS = 120_000;
/** The most of `session/list`'s pages read for the picker. */
const LIST_PAGES = 5;


interface Capabilities {
  loadSession?: boolean;
  sessionCapabilities?: { list?: unknown; resume?: unknown } | null;
}

export class AcpSession implements Driver {
  readonly producer: Producer;
  readonly peer: Peer;
  #state: HostState;
  #ledger = new CommandLedger();
  /** The requests waiting on an answer, by permission id: what answers the agent. */
  #asked = new Map<string, (optionId?: string) => void>();
  #asks = 0;
  /** The running turn, if one is. */
  #turn: { startedAt: number } | undefined;
  /** What the agent is told unseen with its next prompt (the core's `agent.turn`), and dropped with it. */
  #context: string | undefined;
  /** While a replay runs: when the agent last said anything. */
  #replay: { last?: number } | undefined;
  #exited = false;
  /** What `#setup` sets up, and what a retry sets up again. */
  #mode: HostSpec["mode"];
  #wanted: string | undefined;

  constructor(
    private readonly spec: HostSpec,
    write: (line: string) => void,
    private readonly events: SessionEvents,
  ) {
    this.producer = new Producer({ publish: (update) => events.update(update) });
    this.peer = new Peer(write, {
      request: (method, params) => this.#request(method, params),
      notify: (method, params) => this.#notify(method, params),
    });
    this.#mode = spec.mode;
    this.#wanted = spec.session;
    this.#state = { phase: "starting", agent: spec.agent, name: spec.name, cwd: spec.cwd, pid: process.pid, canLoad: false, canList: false, canResume: false };
  }

  get state(): HostState {
    return this.#state;
  }

  /** One line of the agent's stdout. */
  feed(line: string): void {
    this.peer.feed(line);
  }

  /** `initialize`, then the session the spec asks for. */
  async begin(): Promise<void> {
    try {
      const init = await this.peer.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "pumi-agents", title: "pumi", version: "0.2.0" },
      });
      const caps: Capabilities = init?.agentCapabilities ?? {};
      const authMethods: AuthMethod[] = (init?.authMethods ?? []).map((m: any) => ({ id: String(m.id), name: String(m.name ?? m.id), ...(m.description ? { description: String(m.description) } : {}) }));
      this.#set({ canLoad: caps.loadSession === true, canList: !!caps.sessionCapabilities?.list, canResume: !!caps.sessionCapabilities?.resume, authMethods });
    } catch (err) {
      if (!this.#exited) this.#set({ error: `the agent did not start: ${message(err)}` });
      return;
    }
    await this.#setup();
  }

  /** In `picking`: continue `session`, or begin a new one. */
  async start(session?: string | null): Promise<void> {
    if (this.#state.phase !== "picking") return;
    await this.#setup(session ? "load" : "new", session ?? undefined);
  }

  /** In `auth`: `authenticate` with `method`, then the session again. */
  async auth(method: string): Promise<void> {
    try {
      await this.peer.request("authenticate", { methodId: method });
    } catch (err) {
      this.#set({ error: `signing in failed: ${message(err)}` });
      return;
    }
    await this.#setup();
  }

  /** Tries the session again: after signing in elsewhere, or a failure. */
  async retry(): Promise<void> {
    if (this.#exited || this.#state.phase === "ready" || this.#state.phase === "loading") return;
    await this.#setup();
  }

  /** What a view asked; answered once per command id. */
  async command(command: Command): Promise<Ack> {
    if (!this.#ledger.first(command.id)) return { id: command.id };
    try {
      this.#act(command);
      if (command.type === "setOption") await this.#setOption(command);
      return { id: command.id };
    } catch (err) {
      return { id: command.id, rejected: message(err) };
    }
  }

  /** The agent's process ended: say so, and let go of what waits on it. */
  exited(code: number | null, signal: string | null, stderr: string[]): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#dropAsked();
    this.peer.close(new Error("the agent exited"));
    const failed = code !== 0;
    const how = signal ? `was stopped (${signal})` : `exited with code ${code}`;
    const tail = stderr.length > 0 ? `\n\n\`\`\`\n${stderr.join("\n")}\n\`\`\`` : "";
    const t = this.producer.transcript;
    if (t.queue.length > 0) this.producer.push({ type: "queue", queue: [] });
    this.producer.push(noticeChange(`The agent ${how}.${failed ? tail : ""}`, failed ? "error" : "info", this.producer), { type: "status", status: failed ? "error" : "done" });
    this.producer.flush();
    this.#set({ phase: "exited", error: failed ? `the agent ${how}` : undefined });
  }

  // ── Setting the session up ────────────────────────────────────────────────────────────────

  /** The mode the spec asked for (or `mode`): a new session, a loaded one, or the picker. */
  async #setup(mode: HostSpec["mode"] = this.#mode, session: string | undefined = this.#wanted): Promise<void> {
    this.#mode = mode;
    this.#wanted = session;
    this.#set({ error: undefined });
    try {
      if (mode === "pick") return await this.#pick();
      if (mode === "load" && session) return await this.#load(session);
      await this.#new();
    } catch (err) {
      if (this.#exited) return;
      if (err instanceof RpcError && err.code === AUTH_REQUIRED) this.#set({ phase: "auth", error: undefined });
      else this.#set({ phase: this.#state.phase === "loading" ? "starting" : this.#state.phase, error: message(err) });
    }
  }

  async #new(): Promise<void> {
    const setup: AcpSessionSetup = await this.peer.request("session/new", { cwd: this.spec.cwd, mcpServers: [] });
    this.#ready(setup, setup.sessionId ?? "");
  }

  async #pick(): Promise<void> {
    const sessions: ListedSession[] = [];
    if (this.#state.canList) {
      let cursor: string | undefined;
      for (let page = 0; page < LIST_PAGES; page++) {
        const answer = await this.peer.request("session/list", { cwd: this.spec.cwd, ...(cursor ? { cursor } : {}) });
        for (const s of answer?.sessions ?? []) {
          sessions.push({ id: String(s.sessionId), ...(s.cwd ? { cwd: String(s.cwd) } : {}), ...(s.title ? { title: String(s.title) } : {}), ...(s.updatedAt ? { updatedAt: String(s.updatedAt) } : {}) });
        }
        cursor = answer?.nextCursor ?? undefined;
        if (!cursor) break;
      }
    }
    this.#set({ phase: "picking", sessions });
  }

  /**
   * `session/load`, whose replay comes as `session/update`s before its answer. Some agents answer
   * late or never, so the replay also ends when the agent has been quiet `replayIdleMs` after
   * saying something. Without `loadSession`, `session/resume` continues it without the replay.
   */
  async #load(id: string): Promise<void> {
    const params = { sessionId: id, cwd: this.spec.cwd, mcpServers: [] };
    if (!this.#state.canLoad) {
      if (!this.#state.canResume) {
        this.producer.push(noticeChange("This agent can't continue a session over ACP: this is a new one.", "warning", this.producer));
        return await this.#new();
      }
      const setup: AcpSessionSetup = await this.peer.request("session/resume", params);
      this.producer.push(noticeChange("The session continues; the agent does not show its earlier messages again.", "info", this.producer));
      return this.#ready(setup, id);
    }
    this.#set({ phase: "loading", session: id });
    this.#replay = {};
    const idle = this.spec.replayIdleMs ?? REPLAY_IDLE_MS;
    const answer = this.peer.request<AcpSessionSetup>("session/load", params);
    let timer: ReturnType<typeof setInterval> | undefined;
    const quiet = new Promise<undefined>((resolve, reject) => {
      const began = Date.now();
      timer = setInterval(() => {
        const last = this.#replay?.last;
        if (last !== undefined && Date.now() - last >= idle) resolve(undefined);
        else if (Date.now() - began > LOAD_TIMEOUT_MS) reject(new Error("session/load took too long"));
      }, 50);
    });
    try {
      const setup = await Promise.race([answer, quiet]);
      this.#replay = undefined;
      this.#ready(setup ?? { sessionId: id }, id);
      // An answer after the replay was taken as done still brings the session's options.
      if (!setup) answer.then((late) => this.producer.push(...fromSessionSetup(this.producer.transcript, late ?? {}, { id })), () => {});
    } finally {
      this.#replay = undefined;
      clearInterval(timer);
    }
  }

  #ready(setup: AcpSessionSetup, id: string): void {
    const sessionId = setup.sessionId ?? id;
    this.producer.push(...fromSessionSetup(this.producer.transcript, { ...setup, sessionId }, { id: sessionId, cwd: this.spec.cwd, agent: this.spec.name }), { type: "status", status: "idle" });
    this.producer.flush();
    this.#set({ phase: "ready", session: sessionId, sessions: undefined, error: undefined });
  }

  // ── What the agent asks and says ──────────────────────────────────────────────────────────

  #request(method: string, params: any): Promise<AcpPermissionResponse> {
    if (method === "session/request_permission") return this.#permission(params as AcpRequestPermission);
    throw new RpcError(METHOD_NOT_FOUND, `${method} is not offered by this client`);
  }

  #notify(method: string, params: any): void {
    if (method !== "session/update") return;
    const note = params as AcpSessionNotification;
    const session = this.#state.session;
    if (session && note.sessionId !== session) return;
    if (this.#replay) this.#replay.last = Date.now();
    this.producer.push(...fromSessionUpdate(this.producer.transcript, note.update, this.producer));
  }

  /** A permission request: shown until it is answered, the turn ends, or the agent goes. */
  #permission(request: AcpRequestPermission): Promise<AcpPermissionResponse> {
    const id = `${this.producer.transcript.epoch.slice(0, 8)}.ask${++this.#asks}`;
    this.producer.push(...fromPermissionRequest(this.producer.transcript, id, request, this.producer));
    return new Promise((resolve) => {
      this.#asked.set(id, (optionId) => {
        this.#asked.delete(id);
        resolve(permissionResponse(optionId));
      });
    });
  }

  /** Answers every request still waiting as cancelled, and takes it off the transcript. */
  #dropAsked(): void {
    for (const [id, answer] of [...this.#asked]) {
      answer(undefined);
      if (this.producer.transcript.permissions.some((p) => p.id === id)) this.producer.push({ type: "permissionResolved", id });
    }
  }

  // ── What a view asks ──────────────────────────────────────────────────────────────────────

  #act(command: Command): void {
    const t = this.producer.transcript;
    switch (command.type) {
      case "prompt": {
        if (this.#state.phase !== "ready") throw new Error("the session is not ready");
        if (command.text.trim() === "" && !command.images?.length) throw new Error("the prompt is empty");
        if (this.#turn || t.queue.length > 0) {
          this.producer.push({ type: "queue", queue: [...t.queue, { id: command.id, text: command.text, ...(command.images ? { images: command.images } : {}) }] });
        } else this.#run(command.text, command.images ?? []);
        return;
      }
      case "cancel": {
        if (!this.#turn) throw new Error("no turn is running");
        if (t.queue.length > 0) this.producer.push({ type: "queue", queue: [] });
        this.#dropAsked();
        this.peer.notify("session/cancel", { sessionId: this.#state.session });
        return;
      }
      case "answer": {
        const answer = this.#asked.get(command.permissionId);
        const asked = t.permissions.find((p) => p.id === command.permissionId);
        if (!answer || !asked) throw new Error("that request is no longer waiting");
        if (!asked.options.some((o) => o.id === command.optionId)) throw new Error(`the request has no option ${command.optionId}`);
        answer(command.optionId);
        this.producer.push({ type: "permissionResolved", id: command.permissionId });
        return;
      }
      case "unqueue": {
        if (!t.queue.some((q) => q.id === command.queued)) throw new Error("that prompt is not queued");
        this.producer.push({ type: "queue", queue: t.queue.filter((q) => q.id !== command.queued) });
        return;
      }
      case "context": {
        this.#context = command.text.trim() === "" ? undefined : command.text;
        return;
      }
      case "setOption":
        if (this.#state.phase !== "ready") throw new Error("the session is not ready");
        return;
      case "rewind":
        throw new Error("an ACP session cannot go back to an earlier message");
    }
  }

  async #setOption(command: Extract<Command, { type: "setOption" }>): Promise<void> {
    const t = this.producer.transcript;
    const request = setOptionRequest(t, command, this.#state.session ?? "");
    const option = optionOf(t, command.category, command.option);
    if (!request || !option) throw new Error(`the agent offers no such ${command.category}`);
    await this.peer.request(request.method, request.params);
    const change = setOptionChange(this.producer.transcript, option.id, command.value);
    if (change) this.producer.push(change);
  }

  /** One turn: the prompt, the agent's work, its end; then the next prompt queued. */
  #run(text: string, images: Image[]): void {
    this.producer.push(...promptChanges(text, images, this.producer));
    const turn = { startedAt: this.producer.now() };
    this.#turn = turn;
    // What pumi told the agent goes ahead of the prompt, as one block of the agent's own: it stays
    // out of what the user wrote, and the transcript keeps the prompt as it was given.
    const told = this.#context;
    this.#context = undefined;
    const blocks = promptBlocks(text, images);
    if (told) blocks.unshift({ type: "text", text: told });
    this.peer
      .request<AcpPromptResponse>("session/prompt", { sessionId: this.#state.session, prompt: blocks })
      .then(
        (response) => {
          this.#dropAsked();
          this.producer.push(...fromPromptResponse(this.producer.transcript, response, turn.startedAt, this.producer));
        },
        (err) => {
          this.#dropAsked();
          const t = this.producer.transcript;
          if (!this.#exited) this.producer.push(noticeChange(message(err), "error", this.producer));
          this.producer.push(...endTurnChanges(t, { stop: "error", durationMs: this.producer.now() - turn.startedAt }, this.producer));
        },
      )
      .finally(() => {
        this.#turn = undefined;
        this.#next();
      });
  }

  #next(): void {
    const [first, ...rest] = this.producer.transcript.queue;
    if (!first || this.#exited || this.#state.phase !== "ready") return;
    this.producer.push({ type: "queue", queue: rest });
    this.#run(first.text, first.images ?? []);
  }

  #set(patch: Partial<HostState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const key of Object.keys(this.#state) as (keyof HostState)[]) if (this.#state[key] === undefined) delete this.#state[key];
    this.events.state(this.#state);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
