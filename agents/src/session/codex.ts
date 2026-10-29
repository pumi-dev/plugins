// Codex over its own protocol (`codex app-server`): JSON-RPC on its stdin and stdout, a thread for
// the session and a turn for each prompt (`codex app-server generate-ts` writes the types). The
// host starts the app server in the tab's directory; a new tab starts a thread, a tab with a
// session resumes that thread and shows its turns again. What Codex says (its items: messages,
// reasoning, commands, file changes, MCP calls; the plan, the tokens) becomes the conversation's
// changes, streamed as it writes them; its approvals and questions are the chat's permissions,
// answered with Codex's own decisions. Each user message keeps its turn's id (`source`): an edit
// reverts the thread to before that turn (`thread/revert`), and a fork copies the thread through
// it (`thread/fork`). The reasoning effort and the approval preset go with each turn (`turn/start`).
// No `import … from "pumi"` here.
import { CommandLedger, endTurnChanges, noticeChange, Producer, promptChanges, textChange, type Change } from "../conversation/change.ts";
import { entryIndex, findEntry, findTool, randomId, type Ack, type Choice, type Command, type ConfigOption, type Image, type Permission, type PlanItem, type StopReason, type ToolContent, type Transcript } from "../conversation/model.ts";
import { num, obj, objs, str, toolPush, type Rec } from "../parse/common.ts";
import type { Driver, SessionEvents } from "./engines.ts";
import { METHOD_NOT_FOUND, Peer, RpcError } from "./rpc.ts";
import type { HostSpec, HostState } from "./wire.ts";

/** The pickers' option ids. */
export const CODEX_MODEL = "codex.model";
export const CODEX_EFFORT = "codex.effort";
export const CODEX_MODE = "codex.mode";

/** The reasoning efforts as the pickers name them. */
const EFFORT_NAMES: Record<string, string> = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra High", max: "Max", ultra: "Ultra" };

/** Codex's approval presets (its `/approvals`): who asks, and what the sandbox lets it touch. */
const PRESETS: (Choice & { approvalPolicy: string; sandboxPolicy: Rec })[] = [
  { id: "read-only", name: "Read Only", description: "Reads files; asks before editing or running anything else.", approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly", networkAccess: false } },
  { id: "auto", name: "Auto", description: "Edits and runs commands in the workspace; asks before going outside it.", approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } },
  { id: "full-access", name: "Full Access", description: "Edits and runs anything, with the network, without asking.", approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } },
];

/** A request Codex waits on, by the permission it is in the chat. */
interface Asked {
  answer(optionId?: string, text?: string): void;
}

export class CodexSession implements Driver {
  readonly producer: Producer;
  readonly peer: Peer;
  #state: HostState;
  #ledger = new CommandLedger();
  #exited = false;
  #thread: string | undefined;
  /** The running turn: Codex's id for it once it said, and when it began. */
  #turn: { id?: string; startedAt: number } | undefined;
  #context: string | undefined;
  /** The model the next turn runs, when one was picked. */
  #model: string | undefined;
  /** What `model/list` says, the model running, its reasoning effort, and the approval preset (when picked). */
  #listed: Rec[] = [];
  #current: string | undefined;
  #effort: string | undefined;
  #preset: string | undefined;
  /** The user message of the running turn, which gets the turn's id once Codex says it. */
  #prompted: string | undefined;
  #asked = new Map<string, Asked>();
  #asks = 0;
  /** The items whose text came as deltas (their completion adds none), and each command's output so far. */
  #streamed = new Set<string>();
  #output = new Map<string, string>();

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
    this.#state = { phase: "starting", agent: spec.agent, name: spec.name, cwd: spec.cwd, pid: process.pid, canLoad: true, canList: false, canResume: true, canEdit: true, canFork: true };
  }

  get state(): HostState {
    return this.#state;
  }

  feed(line: string): void {
    this.peer.feed(line);
  }

  // ── Setting the session up ────────────────────────────────────────────────────────────────

  async begin(): Promise<void> {
    try {
      await this.peer.request("initialize", { clientInfo: { name: "pumi_agents", title: "pumi", version: "0.2.0" }, capabilities: null });
      this.peer.notify("initialized", {});
      if (this.spec.mode === "pick") this.producer.push(noticeChange("Codex's sessions aren't listed here: this is a new one.", "info", this.producer));
      const resumed = this.spec.mode === "load" && this.spec.session;
      const got: Rec = resumed
        ? await this.peer.request("thread/resume", { threadId: this.spec.session, cwd: this.spec.cwd })
        : await this.peer.request("thread/start", { cwd: this.spec.cwd });
      const thread = obj(got?.thread) ?? {};
      this.#thread = str(thread.id) ?? this.spec.session;
      if (resumed) this.#replay(objs(thread.turns));
      const model = str(got?.model);
      this.producer.push({ type: "session", session: { id: this.#thread ?? "", cwd: this.spec.cwd, agent: this.spec.name, ...(model ? { model } : {}), ...(str(thread.name) ? { title: str(thread.name) } : {}) } });
      this.#effort = str(got?.reasoningEffort);
      this.#preset = presetOf(got?.approvalPolicy, obj(got?.sandbox));
      await this.#models(model);
      this.producer.push({ type: "status", status: "idle" });
      this.producer.flush();
      this.#set({ phase: "ready", session: this.#thread, error: undefined });
    } catch (err) {
      if (!this.#exited) this.#set({ error: `Codex did not start: ${message(err)}` });
    }
  }

  async start(): Promise<void> {}

  async auth(): Promise<void> {}

  async retry(): Promise<void> {
    if (this.#exited || this.#state.phase === "ready") return;
    await this.begin();
  }

  /** The models Codex offers, as the picker. */
  async #models(current: string | undefined): Promise<void> {
    const got: Rec | null = await this.peer.request("model/list", {}).catch(() => null);
    this.#listed = objs(got?.data).filter((m) => m.hidden !== true);
    this.#current = current;
    this.#options();
  }

  /** The pickers: the model, its reasoning efforts, and the approval preset. */
  #options(): void {
    const options: ConfigOption[] = [];
    const choices = this.#listed
      .map((m) => ({ id: str(m.model) ?? str(m.id) ?? "", name: str(m.displayName) ?? str(m.model) ?? "", ...(str(m.description) ? { description: str(m.description) } : {}) }))
      .filter((c) => c.id !== "");
    if (choices.length > 0 && this.#current) options.push({ id: CODEX_MODEL, category: "model", name: "Model", current: this.#current, choices });
    const info = this.#listed.find((m) => m.model === this.#current || m.id === this.#current);
    const efforts: Choice[] = objs(info?.supportedReasoningEfforts).map((e) => {
      const id = str(e.reasoningEffort) ?? "";
      return { id, name: EFFORT_NAMES[id] ?? id, ...(str(e.description) ? { description: str(e.description) } : {}) };
    }).filter((e) => e.id !== "");
    const fallback = str(info?.defaultReasoningEffort) ?? efforts[0]?.id;
    if (this.#effort && !efforts.some((e) => e.id === this.#effort)) this.#effort = undefined;
    if (efforts.length > 0 && fallback) {
      options.push({ id: CODEX_EFFORT, category: "thought_level", name: "Reasoning", current: this.#effort ?? fallback, choices: efforts, ...(efforts.some((e) => e.id === "none") ? { off: "none" } : {}), default: fallback });
    }
    options.push({ id: CODEX_MODE, category: "mode", name: "Approvals", current: this.#preset ?? "auto", choices: PRESETS.map(({ id, name, description }) => ({ id, name, description })) });
    this.producer.push({ type: "options", options });
  }

  /** A resumed thread's turns, as they would have streamed. */
  #replay(turns: Rec[]): void {
    for (const turn of turns) {
      const source = str(turn.id);
      for (const item of objs(turn.items)) {
        if (item.type === "userMessage") {
          const text = objs(item.content)
            .map((c) => (c.type === "text" ? (str(c.text) ?? "") : ""))
            .join("");
          if (text) this.producer.push({ type: "push", entry: { id: this.producer.id(), kind: "user", at: this.producer.now(), text, ...(source ? { source } : {}) } });
          continue;
        }
        this.#started(item);
        this.#completed(item);
      }
      const stop = stopOf(str(turn.status));
      if (stop) this.producer.push({ type: "push", entry: { id: this.producer.id(), kind: "turn", at: this.producer.now(), turn: { stop } } });
    }
  }

  // ── What Codex says ───────────────────────────────────────────────────────────────────────

  #notify(method: string, params: any): void {
    const p: Rec = params ?? {};
    if (p.threadId !== undefined && this.#thread && p.threadId !== this.#thread) return;
    const t = this.producer.transcript;
    switch (method) {
      case "turn/started": {
        const id = str(obj(p.turn)?.id);
        if (!this.#turn) {
          // A turn Codex began itself (a goal's next one) is a turn here too.
          this.#turn = { startedAt: this.producer.now() };
          this.producer.push({ type: "status", status: "working" });
        }
        if (id) {
          this.#turn.id = id;
          this.#named(id);
        }
        return;
      }
      case "item/started":
        return this.#started(obj(p.item) ?? {});
      case "item/completed":
        return this.#completed(obj(p.item) ?? {});
      case "item/agentMessage/delta":
        return this.#text(p, "agent", t);
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        return this.#text(p, "thought", t);
      case "item/commandExecution/outputDelta": {
        const id = str(p.itemId);
        const entry = id ? findTool(t, id) : undefined;
        if (!id || !entry) return;
        const output = (this.#output.get(id) ?? "") + (str(p.delta) ?? "");
        this.#output.set(id, output);
        this.producer.push({ type: "tool", id: entry.id, patch: { status: "running", content: [{ type: "terminal", output }] } });
        return;
      }
      case "turn/plan/updated": {
        const plan: PlanItem[] = objs(p.plan).map((s) => ({ content: str(s.step) ?? "", status: s.status === "completed" ? "completed" : s.status === "inProgress" ? "in_progress" : "pending" }));
        this.producer.push({ type: "plan", plan });
        return;
      }
      case "thread/tokenUsage/updated": {
        const usage = obj(p.tokenUsage);
        const tokens = num(obj(usage?.last)?.inputTokens) ?? num(obj(usage?.total)?.totalTokens);
        const size = num(usage?.modelContextWindow);
        this.producer.push({ type: "usage", usage: { ...t.usage, ...(tokens ? { tokens } : {}), ...(size ? { contextSize: size } : {}), ...(tokens && size ? { contextPct: Math.min(100, Math.round((tokens / size) * 100)) } : {}) } });
        return;
      }
      case "thread/name/updated": {
        const title = str(p.threadName);
        if (t.session && title) this.producer.push({ type: "session", session: { ...t.session, title } });
        return;
      }
      case "error": {
        const error = obj(p.error);
        this.producer.push(noticeChange(str(error?.message) ?? "Codex failed", p.willRetry === true ? "warning" : "error", this.producer));
        return;
      }
      case "turn/completed":
        return this.#turnEnd(obj(p.turn) ?? {});
      default:
        return;
    }
  }

  #text(p: Rec, kind: "agent" | "thought", t: Transcript): void {
    const delta = str(p.delta);
    const id = str(p.itemId);
    if (!delta) return;
    if (id) this.#streamed.add(id);
    this.producer.push(textChange(t, kind, delta, this.producer));
  }

  /** An item began: a call is shown as it starts; a message waits for its text. */
  #started(item: Rec): void {
    const id = str(item.id);
    if (!id || findTool(this.producer.transcript, id)) return;
    const now = this.producer.now();
    switch (item.type) {
      case "commandExecution": {
        const push = toolPush(id, "exec_command", { command: str(item.command), cwd: str(item.cwd) }, [], now, this.producer);
        if (push.entry.tool) push.entry.tool.status = "running";
        this.producer.push(push);
        return;
      }
      case "fileChange": {
        const push = toolPush(id, "apply_patch", { changes: item.changes }, diffsOf(item), now, this.producer);
        if (push.entry.tool) push.entry.tool.status = "running";
        this.producer.push(push);
        return;
      }
      case "mcpToolCall": {
        const push = toolPush(id, `mcp__${str(item.server) ?? "mcp"}__${str(item.tool) ?? "tool"}`, item.arguments, [], now, this.producer);
        if (push.entry.tool) push.entry.tool.status = "running";
        this.producer.push(push);
        return;
      }
      case "webSearch": {
        const push = toolPush(id, "web_search", { query: str(item.query) }, [], now, this.producer);
        if (push.entry.tool) push.entry.tool.status = "running";
        this.producer.push(push);
        return;
      }
      default:
        return;
    }
  }

  /** An item is done: a call's result, or a message's text when it did not stream. */
  #completed(item: Rec): void {
    const id = str(item.id);
    if (!id) return;
    const t = this.producer.transcript;
    const entry = findTool(t, id);
    switch (item.type) {
      case "agentMessage": {
        const text = str(item.text);
        if (text && !this.#streamed.has(id)) this.producer.push({ type: "push", entry: { id: this.producer.id(), kind: "agent", at: this.producer.now(), text } });
        this.#streamed.delete(id);
        return;
      }
      case "reasoning": {
        const text = [...(Array.isArray(item.summary) ? item.summary : []), ...(Array.isArray(item.content) ? item.content : [])].filter((s) => typeof s === "string" && s !== "").join("\n\n");
        if (text && !this.#streamed.has(id)) this.producer.push({ type: "push", entry: { id: this.producer.id(), kind: "thought", at: this.producer.now(), text } });
        this.#streamed.delete(id);
        return;
      }
      case "commandExecution": {
        if (!entry) return;
        const exitCode = num(item.exitCode);
        const output = str(item.aggregatedOutput) ?? this.#output.get(id) ?? "";
        this.#output.delete(id);
        const failed = item.status === "failed" || item.status === "declined" || (exitCode !== undefined && exitCode !== 0);
        this.producer.push({ type: "tool", id: entry.id, patch: { status: failed ? "failed" : "completed", content: [{ type: "terminal", output, ...(exitCode !== undefined ? { exitCode } : {}) }] } });
        return;
      }
      case "fileChange": {
        if (!entry) return;
        const failed = item.status === "failed" || item.status === "declined";
        this.producer.push({ type: "tool", id: entry.id, patch: { status: failed ? "failed" : "completed", content: diffsOf(item) } });
        return;
      }
      case "mcpToolCall": {
        if (!entry) return;
        const error = str(obj(item.error)?.message);
        const content: ToolContent[] = error ? [{ type: "text", text: error }] : objs(obj(item.result)?.content).flatMap((c): ToolContent[] => (c.type === "text" && str(c.text) ? [{ type: "text", text: str(c.text)! }] : []));
        this.producer.push({ type: "tool", id: entry.id, patch: { status: error || item.status === "failed" ? "failed" : "completed", content } });
        return;
      }
      case "webSearch":
        if (entry) this.producer.push({ type: "tool", id: entry.id, patch: { status: "completed" } });
        return;
      case "contextCompaction":
        this.producer.push(noticeChange("The conversation was compacted.", "info", this.producer));
        return;
      default:
        return;
    }
  }

  /** The running turn's user message, given the turn's id. */
  #named(turnId: string): void {
    const entry = this.#prompted ? findEntry(this.producer.transcript, this.#prompted) : undefined;
    this.#prompted = undefined;
    if (entry && !entry.source) this.producer.push({ type: "replace", entry: { ...entry, source: turnId } });
  }

  #turnEnd(turn: Rec): void {
    const running = this.#turn;
    this.#turn = undefined;
    this.#prompted = undefined;
    this.#dropAsked();
    const error = str(obj(turn.error)?.message);
    if (error) this.producer.push(noticeChange(error, "error", this.producer));
    const stop = stopOf(str(turn.status)) ?? "end_turn";
    this.producer.push(...endTurnChanges(this.producer.transcript, { stop, ...(running ? { durationMs: this.producer.now() - running.startedAt } : {}) }, this.producer));
    this.#nextPrompt();
  }

  // ── What Codex asks ───────────────────────────────────────────────────────────────────────

  #request(method: string, params: any): Promise<unknown> {
    const p: Rec = params ?? {};
    switch (method) {
      case "item/commandExecution/requestApproval": {
        const command = str(p.command);
        return this.#ask(
          { toolId: str(p.itemId), title: command ? `Run \`${command}\`?` : "Run a command?", detail: [str(p.reason), str(p.cwd)].filter(Boolean).join(" · ") || undefined },
          [
            { id: "accept", label: "Yes", kind: "allow_once" },
            { id: "acceptForSession", label: "Yes, for this session", kind: "allow_always" },
            { id: "decline", label: "No", kind: "reject_once" },
          ],
          (optionId) => ({ decision: optionId ?? "cancel" }),
        );
      }
      case "item/fileChange/requestApproval":
        return this.#ask(
          { toolId: str(p.itemId), title: "Apply these changes?", detail: str(p.reason) },
          [
            { id: "accept", label: "Yes", kind: "allow_once" },
            { id: "acceptForSession", label: "Yes, for this session", kind: "allow_always" },
            { id: "decline", label: "No", kind: "reject_once" },
          ],
          (optionId) => ({ decision: optionId ?? "cancel" }),
        );
      case "item/tool/requestUserInput":
        return this.#questions(objs(p.questions));
      default:
        return Promise.reject(new RpcError(METHOD_NOT_FOUND, `${method} is not offered by this client`));
    }
  }

  /** A permission in the chat, answered with `reply(optionId)` (none: withdrawn). */
  #ask(about: Pick<Permission, "title"> & Partial<Pick<Permission, "toolId" | "detail" | "kind" | "text">>, options: Permission["options"], reply: (optionId?: string, text?: string) => unknown): Promise<unknown> {
    const id = `${this.producer.transcript.epoch.slice(0, 8)}.ask${++this.#asks}`;
    const permission: Permission = { id, options, ...Object.fromEntries(Object.entries(about).filter(([, v]) => v !== undefined)), title: about.title };
    this.producer.push({ type: "permissionAsked", permission });
    return new Promise((resolve) => {
      this.#asked.set(id, {
        answer: (optionId, text) => {
          this.#asked.delete(id);
          resolve(reply(optionId, text));
        },
      });
    });
  }

  /** Codex's questions, one card each, answered together. */
  async #questions(questions: Rec[]): Promise<unknown> {
    const answers: Record<string, { answers: string[] }> = {};
    for (const q of questions) {
      const qid = str(q.id) ?? String(Object.keys(answers).length);
      const choices = objs(q.options).map((o) => str(o.label) ?? "");
      const options: Permission["options"] = choices.length ? choices.map((label, at) => ({ id: String(at), label, kind: "other" })) : [{ id: "send", label: "Send", kind: "other" }];
      const answer = (await this.#ask({ kind: "question", title: str(q.question) ?? str(q.header) ?? "Codex asks", ...(choices.length === 0 || q.isOther === true ? { text: true } : {}) }, options, (optionId, text) => {
        if (optionId === undefined) return undefined;
        return text && text.trim() !== "" ? text : (choices[Number(optionId)] ?? text ?? "");
      })) as string | undefined;
      if (answer === undefined) return { answers };
      answers[qid] = { answers: [answer] };
    }
    return { answers };
  }

  #dropAsked(): void {
    for (const [id, asked] of [...this.#asked]) {
      asked.answer(undefined);
      if (this.producer.transcript.permissions.some((p) => p.id === id)) this.producer.push({ type: "permissionResolved", id });
    }
  }

  // ── What a view asks ──────────────────────────────────────────────────────────────────────

  async command(command: Command): Promise<Ack> {
    if (!this.#ledger.first(command.id)) return { id: command.id };
    try {
      const more = await this.#act(command);
      return { id: command.id, ...(more ?? {}) };
    } catch (err) {
      return { id: command.id, rejected: message(err) };
    }
  }

  async #act(command: Command): Promise<Partial<Ack> | void> {
    const t = this.producer.transcript;
    switch (command.type) {
      case "prompt": {
        if (this.#state.phase !== "ready") throw new Error("the session is not ready");
        if (command.text.trim() === "" && !command.images?.length) throw new Error("the prompt is empty");
        if (command.replaces) {
          await this.#rewindTo(command.replaces);
          await this.#run(command.text, command.images ?? []);
          return;
        }
        if (this.#turn || t.queue.length > 0) {
          this.producer.push({ type: "queue", queue: [...t.queue, { id: command.id, text: command.text, ...(command.images ? { images: command.images } : {}) }] });
        } else await this.#run(command.text, command.images ?? []);
        return;
      }
      case "cancel": {
        if (!this.#turn) throw new Error("no turn is running");
        if (t.queue.length > 0) this.producer.push({ type: "queue", queue: [] });
        this.#dropAsked();
        if (this.#turn.id) await this.peer.request("turn/interrupt", { threadId: this.#thread, turnId: this.#turn.id });
        return;
      }
      case "answer": {
        const asked = this.#asked.get(command.permissionId);
        if (!asked) throw new Error("that request is no longer waiting");
        asked.answer(command.optionId, command.text);
        this.producer.push({ type: "permissionResolved", id: command.permissionId });
        return;
      }
      case "unqueue": {
        if (!t.queue.some((q) => q.id === command.queued)) throw new Error("that prompt is not queued");
        this.producer.push({ type: "queue", queue: t.queue.filter((q) => q.id !== command.queued) });
        return;
      }
      case "context":
        this.#context = command.text.trim() === "" ? undefined : command.text;
        return;
      case "setOption": {
        if (typeof command.value !== "string") throw new Error(`Codex has no ${command.category} to turn on or off`);
        // The next turn runs it, and every one after.
        if (command.category === "model") {
          this.#model = command.value;
          this.#current = command.value;
          if (t.session) this.producer.push({ type: "session", session: { ...t.session, model: command.value } });
        } else if (command.category === "thought_level") this.#effort = command.value;
        else if (command.category === "mode" && PRESETS.some((p) => p.id === command.value)) this.#preset = command.value;
        else throw new Error(`Codex has no ${command.category} to set here`);
        this.#options();
        return;
      }
      case "rewind":
        await this.#rewindTo(command.entry);
        return;
      case "fork":
        return { session: await this.#fork(command.entry) };
      case "restore":
        throw new Error("Codex keeps no checkpoints of the files");
    }
  }

  /** The user message `entryId`, and the turn it began. */
  #turnOf(entryId: string): { at: number; turn: string } {
    const t = this.producer.transcript;
    const entry = findEntry(t, entryId);
    if (entry?.kind !== "user") throw new Error("that is not one of your messages");
    if (!entry.source) throw new Error("that message's turn is not in Codex's thread yet");
    return { at: entryIndex(t.entries, entry.id), turn: entry.source };
  }

  /** Back to before the user's message `entryId`: Codex's thread loses its turn and every one after (the files stay as they are). */
  async #rewindTo(entryId: string): Promise<void> {
    const t = this.producer.transcript;
    if (this.#turn || t.queue.length > 0) throw new Error("Codex is busy: go back once its turn is over");
    const { at, turn } = this.#turnOf(entryId);
    await this.peer.request("thread/revert", { threadId: this.#thread, beforeTurnId: turn });
    this.producer.reset({ ...t, epoch: randomId(), seq: 0, entries: t.entries.slice(0, at), status: "idle", permissions: [], queue: [] });
  }

  /** A new thread with this one's turns through the one `entryId` began: its id, for a tab of its own. */
  async #fork(entryId: string): Promise<string> {
    const { turn } = this.#turnOf(entryId);
    if (this.#turn?.id === turn) throw new Error("fork this turn once it is over");
    const got: Rec = await this.peer.request("thread/fork", { threadId: this.#thread, lastTurnId: turn, excludeTurns: true });
    const id = str(obj(got?.thread)?.id);
    if (!id) throw new Error("Codex did not fork the thread");
    return id;
  }

  /** One turn: the prompt, then Codex's work until `turn/completed`. */
  async #run(text: string, images: Image[]): Promise<void> {
    const changes = promptChanges(text, images, this.producer);
    this.producer.push(...changes);
    const prompt = changes.find((change) => change.type === "push" && change.entry.kind === "user");
    this.#prompted = prompt?.type === "push" ? prompt.entry.id : undefined;
    const turn: { id?: string; startedAt: number } = { startedAt: this.producer.now() };
    this.#turn = turn;
    const told = this.#context;
    this.#context = undefined;
    const input: Rec[] = [];
    if (told) input.push({ type: "text", text: told, text_elements: [] });
    input.push({ type: "text", text, text_elements: [] });
    for (const image of images) {
      if (image.uri && !/^https?:/.test(image.uri)) input.push({ type: "localImage", path: image.uri.replace(/^file:\/\//, "") });
      else if (image.uri) input.push({ type: "image", url: image.uri });
      else if (image.data) input.push({ type: "image", url: `data:${image.mimeType};base64,${image.data}` });
    }
    try {
      const preset = PRESETS.find((p) => p.id === this.#preset);
      const got: Rec = await this.peer.request("turn/start", {
        threadId: this.#thread,
        input,
        ...(this.#model ? { model: this.#model } : {}),
        ...(this.#effort ? { effort: this.#effort } : {}),
        ...(preset ? { approvalPolicy: preset.approvalPolicy, sandboxPolicy: preset.sandboxPolicy } : {}),
      });
      const id = str(obj(got?.turn)?.id);
      if (id && this.#turn === turn) {
        turn.id = id;
        this.#named(id);
      }
    } catch (err) {
      if (this.#turn === turn) this.#turn = undefined;
      this.producer.push(noticeChange(message(err), "error", this.producer));
      this.producer.push(...endTurnChanges(this.producer.transcript, { stop: "error", durationMs: this.producer.now() - turn.startedAt }, this.producer));
      this.#nextPrompt();
    }
  }

  #nextPrompt(): void {
    const [first, ...rest] = this.producer.transcript.queue;
    if (!first || this.#exited || this.#state.phase !== "ready") return;
    this.producer.push({ type: "queue", queue: rest });
    void this.#run(first.text, first.images ?? []);
  }

  exited(code: number | null, signal: string | null, stderr: string[]): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#dropAsked();
    this.peer.close(new Error("Codex exited"));
    const failed = code !== 0;
    const how = signal ? `was stopped (${signal})` : `exited with code ${code}`;
    const tail = stderr.length > 0 ? `\n\n\`\`\`\n${stderr.join("\n")}\n\`\`\`` : "";
    if (this.producer.transcript.queue.length > 0) this.producer.push({ type: "queue", queue: [] });
    const changes: Change[] = [noticeChange(`Codex ${how}.${failed ? tail : ""}`, failed ? "error" : "info", this.producer), { type: "status", status: failed ? "error" : "done" }];
    this.producer.push(...changes);
    this.producer.flush();
    this.#set({ phase: "exited", error: failed ? `Codex ${how}` : undefined });
  }

  #set(patch: Partial<HostState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const key of Object.keys(this.#state) as (keyof HostState)[]) if (this.#state[key] === undefined) delete this.#state[key];
    this.events.state(this.#state);
  }
}

/** The preset a thread's approval policy and sandbox are, if they are one. */
function presetOf(approval: unknown, sandbox: Rec | undefined): string | undefined {
  const type = str(sandbox?.type);
  if (approval === "never" && type === "dangerFullAccess") return "full-access";
  if (type === "readOnly") return "read-only";
  if (type === "workspaceWrite") return "auto";
  return undefined;
}

/** A turn's status as how it ended; a turn still running has none. */
function stopOf(status: string | undefined): StopReason | undefined {
  switch (status) {
    case "completed":
      return "end_turn";
    case "interrupted":
      return "cancelled";
    case "failed":
      return "error";
    default:
      return undefined;
  }
}

/** A file change's diffs, one per file. */
function diffsOf(item: Rec): ToolContent[] {
  return objs(item.changes).map((change) => ({ type: "diff", path: str(change.path) ?? "file", new: "", ...(str(change.diff) ? { unified: str(change.diff) } : {}) }));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
