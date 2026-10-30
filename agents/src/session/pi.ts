// pi over its own protocol (`pi --mode rpc`): JSON records on its stdin and stdout, a command each
// way with an `id` its response repeats, and the session's events (`docs/rpc.md`, `json.md` in
// pi's package). The host starts pi in the tab's directory, on the tab's session when it has one
// (`--session`); what pi says becomes the conversation's changes, streamed as it writes them, and
// a loaded session's entries are read back with `get_entries` through the session-file parser
// (they are the same records), along the branch pi is on. An extension's dialog
// (`extension_ui_request`) is a question in the chat. Each user message keeps its entry's id
// (`source`): an edit forks pi's session at it (`fork`, which moves pi to a new session file with
// what came before), and a fork for a tab of its own does the same and moves pi back
// (`switch_session`). The thinking level is pi's own (`set_thinking_level`). No `import … from
// "pumi"` here.
import { CommandLedger, endTurnChanges, noticeChange, Producer, promptChanges, textChange, type Change } from "../conversation/change.ts";
import { entryIndex, findEntry, findTool, randomId, type Ack, type Command, type ConfigOption, type Image, type Permission, type StopReason, type Transcript } from "../conversation/model.ts";
import { num, obj, objs, resultContent, str, toolPush, toolResult, type Rec } from "../parse/common.ts";
import { callContent, PiParser, stopOf } from "../parse/pi.ts";
import type { Driver, SessionEvents } from "./engines.ts";
import { expandSkills, withBytes } from "./prompt.ts";
import type { HostSpec, HostState } from "./wire.ts";

/** The pickers' option ids. */
export const PI_MODEL = "pi.model";
export const PI_THINKING = "pi.thinking";

/** pi's thinking levels, as the pickers name them. */
const LEVEL_NAMES: Record<string, string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra High", max: "Max" };

interface Waiting {
  resolve(data: any): void;
  reject(err: Error): void;
}

/** An extension's dialog waiting on the user, by the permission it is in the chat. */
interface Dialog {
  request: string;
  method: "select" | "confirm" | "input" | "editor";
  choices: string[];
}

export class PiSession implements Driver {
  readonly producer: Producer;
  #state: HostState;
  #ledger = new CommandLedger();
  #waiting = new Map<string, Waiting>();
  #next = 1;
  #exited = false;
  /** The running turn, if one is: when it began, and how its last message ended. */
  #turn: { startedAt: number; stop?: StopReason } | undefined;
  /** What the agent is told unseen with its next prompt (the core's `agent.turn`). */
  #context: string | undefined;
  #dialogs = new Map<string, Dialog>();
  #usage: { tokens?: number; cost: number } = { cost: 0 };

  constructor(
    private readonly spec: HostSpec,
    private readonly write: (line: string) => void,
    private readonly events: SessionEvents,
  ) {
    this.producer = new Producer({ publish: (update) => events.update(update) });
    this.#state = { phase: "starting", agent: spec.agent, name: spec.name, cwd: spec.cwd, pid: process.pid, canLoad: true, canList: false, canResume: true, canEdit: true, canFork: true };
  }

  get state(): HostState {
    return this.#state;
  }

  // ── The protocol ─────────────────────────────────────────────────────────────────────────

  /** Sends a command; answers its response's `data`, or rejects with its `error`. */
  #call<T = any>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
    if (this.#exited) return Promise.reject(new Error("pi exited"));
    const id = `pumi-${this.#next++}`;
    return new Promise<T>((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      this.write(`${JSON.stringify({ id, type, ...fields })}\n`);
    });
  }

  #send(record: Record<string, unknown>): void {
    if (!this.#exited) this.write(`${JSON.stringify(record)}\n`);
  }

  feed(line: string): void {
    const text = line.replace(/\r$/, "").trim();
    if (text === "") return;
    let record: Rec;
    try {
      record = JSON.parse(text);
    } catch {
      return;
    }
    if (!record || typeof record !== "object") return;
    if (record.type === "response") {
      const id = str(record.id);
      const waiting = id ? this.#waiting.get(id) : undefined;
      if (!waiting || !id) return;
      this.#waiting.delete(id);
      if (record.success === false) waiting.reject(new Error(str(record.error) ?? `${str(record.command) ?? "the command"} failed`));
      else waiting.resolve(record.data ?? null);
      return;
    }
    if (record.type === "extension_ui_request") return this.#dialog(record);
    this.#event(record);
  }

  // ── Setting the session up ────────────────────────────────────────────────────────────────

  async begin(): Promise<void> {
    try {
      if (this.spec.mode === "load" && this.spec.session) {
        // pi was started on the session (`--session`): its entries are the history.
        await this.#history();
      } else if (this.spec.mode === "pick") {
        this.producer.push(noticeChange("pi can't list its sessions here: this is a new one.", "info", this.producer));
      }
      await this.#ready();
    } catch (err) {
      if (!this.#exited) this.#set({ error: `pi did not start: ${message(err)}` });
    }
  }

  async start(): Promise<void> {}

  async auth(): Promise<void> {}

  async retry(): Promise<void> {
    if (this.#exited || this.#state.phase === "ready") return;
    await this.begin();
  }

  /** The session's state, its model and commands: then it is ready. */
  async #ready(): Promise<void> {
    const state = await this.#call<Rec>("get_state");
    const model = obj(state?.model);
    const current = model ? `${str(model.provider)}/${str(model.id)}` : undefined;
    const id = str(state?.sessionId) ?? this.spec.session ?? "";
    this.producer.push({ type: "session", session: { id, cwd: this.spec.cwd, agent: this.spec.name, ...(current ? { model: current } : {}), ...(str(state?.sessionName) ? { title: str(state?.sessionName) } : {}) } });
    const [models, commands] = await Promise.all([this.#call<Rec>("get_available_models").catch(() => null), this.#call<Rec>("get_commands").catch(() => null)]);
    const choices = objs(models?.models).map((m) => ({ id: `${str(m.provider)}/${str(m.id)}`, name: str(m.name) ?? str(m.id) ?? "", group: str(m.provider) }));
    if (choices.length > 0 && current) {
      const option: ConfigOption = { id: PI_MODEL, category: "model", name: "Model", current, choices };
      this.producer.push({ type: "options", options: [option] });
    }
    // A skill's command says its file: a prompt that names it mid-way is sent with it (`prompt.ts`).
    const listed = objs(commands?.commands)
      .map((c) => {
        const file = c.source === "skill" ? str(obj(c.sourceInfo)?.path) : undefined;
        return { name: str(c.name) ?? "", ...(str(c.description) ? { description: str(c.description) } : {}), ...(file ? { skill: file } : {}) };
      })
      .filter((c) => c.name !== "");
    if (listed.length > 0) this.producer.push({ type: "commands", commands: listed });
    await this.#thinking(str(state?.thinkingLevel));
    this.producer.push({ type: "status", status: state?.isStreaming === true ? "working" : "idle" });
    this.producer.flush();
    this.#set({ phase: "ready", session: id, error: undefined });
  }

  /**
   * The session's history: its entries along the branch pi is on (from its leaf back by
   * `parentId`), as the session file's parser reads the same records, so each message keeps its
   * entry's id. A pi without `get_entries` gives its messages, without ids.
   */
  async #history(): Promise<void> {
    const parser = new PiParser();
    const got = await this.#call<Rec>("get_entries").catch(() => null);
    if (!got) {
      const old = await this.#call<{ messages?: unknown[] }>("get_messages");
      for (const each of objs(old?.messages)) this.producer.push(...parser.record({ type: "message", message: each, timestamp: each.timestamp }, this.producer.transcript, this.producer));
      return;
    }
    for (const entry of branchOf(objs(got.entries), str(got.leafId))) this.producer.push(...parser.record(entry, this.producer.transcript, this.producer));
  }

  /** The ids of the user messages on pi's branch now, oldest first. */
  async #userEntries(): Promise<string[]> {
    const got = await this.#call<Rec>("get_entries").catch(() => null);
    if (!got) return [];
    return branchOf(objs(got.entries), str(got.leafId))
      .filter((entry) => entry.type === "message" && obj(entry.message)?.role === "user")
      .map((entry) => str(entry.id) ?? "");
  }

  /** The user messages sent here, given the ids pi wrote them with once it has (matched from the newest). */
  async #sources(): Promise<void> {
    const ids = await this.#userEntries();
    const t = this.producer.transcript;
    const users = t.entries.filter((entry) => entry.kind === "user");
    const offset = ids.length - users.length;
    const changes: Change[] = [];
    users.forEach((entry, at) => {
      const id = ids[at + offset];
      if (id && entry.source !== id) changes.push({ type: "replace", entry: { ...entry, source: id } });
    });
    if (changes.length > 0) this.producer.push(...changes);
  }

  /** The thinking levels the model has, as a picker; `current` is pi's level now. */
  async #thinking(current?: string): Promise<void> {
    const got = await this.#call<Rec>("get_available_thinking_levels").catch(() => null);
    const levels = Array.isArray(got?.levels) ? got.levels.map(String) : [];
    const others = this.producer.transcript.options.filter((o) => o.id !== PI_THINKING);
    if (levels.length <= 1) {
      if (others.length !== this.producer.transcript.options.length) this.producer.push({ type: "options", options: others });
      return;
    }
    const level = current ?? str((await this.#call<Rec>("get_state").catch(() => null))?.thinkingLevel) ?? levels[levels.length - 1]!;
    const option: ConfigOption = {
      id: PI_THINKING,
      category: "thought_level",
      name: "Thinking",
      current: level,
      choices: levels.map((id) => ({ id, name: LEVEL_NAMES[id] ?? id })),
      ...(levels.includes("off") ? { off: "off" } : {}),
    };
    this.producer.push({ type: "options", options: [...others, option] });
  }

  // ── What pi says ──────────────────────────────────────────────────────────────────────────

  #event(record: Rec): void {
    const t = this.producer.transcript;
    switch (record.type) {
      case "agent_start":
        // A run pi began itself (an extension's message, a retry) is a turn too.
        if (!this.#turn) {
          this.#turn = { startedAt: this.producer.now() };
          this.producer.push({ type: "status", status: "working" });
        }
        return;
      case "message_update":
        return this.#delta(obj(record.assistantMessageEvent) ?? {}, t);
      case "message_end": {
        const msg = obj(record.message) ?? {};
        if (msg.role === "assistant") this.#assistantEnd(msg, t);
        return;
      }
      case "tool_execution_start": {
        const id = str(record.toolCallId);
        if (!id) return;
        const entry = findTool(t, id);
        if (!entry) {
          const push = toolPush(id, str(record.toolName) ?? "tool", record.args, callContent(str(record.toolName) ?? "", obj(record.args)), this.producer.now(), this.producer);
          if (push.entry.tool) push.entry.tool.status = "running";
          this.producer.push(push);
        } else this.producer.push({ type: "tool", id: entry.id, patch: { status: "running" } });
        return;
      }
      case "tool_execution_update": {
        const entry = findTool(t, str(record.toolCallId) ?? "");
        const partial = obj(record.partialResult);
        if (!entry || !partial) return;
        const output = resultContent(partial.content);
        const terminal = entry.tool?.kind === "shell";
        const content = terminal ? [{ type: "terminal" as const, output: output.map((c) => (c.type === "text" ? c.text : "")).join("") }] : output;
        if (content.length > 0) this.producer.push({ type: "tool", id: entry.id, patch: { status: "running", content } });
        return;
      }
      case "tool_execution_end": {
        const id = str(record.toolCallId);
        const result = obj(record.result) ?? {};
        if (id) this.producer.push(...toolResult(t, id, record.isError === true, resultContent(result.content)));
        return;
      }
      case "agent_settled":
        return this.#settled(record.aborted === true);
      case "thinking_level_changed": {
        const level = str(record.level);
        if (level) this.producer.push({ type: "options", options: t.options.map((o) => (o.id === PI_THINKING ? { ...o, current: level } : o)) });
        return;
      }
      case "session_info_changed": {
        const title = str(record.name);
        if (t.session) this.producer.push({ type: "session", session: { ...t.session, ...(title ? { title } : { title: undefined }) } });
        return;
      }
      case "auto_retry_start":
        this.producer.push(noticeChange(`Retrying (${num(record.attempt) ?? 1} of ${num(record.maxAttempts) ?? "?"}): ${str(record.errorMessage) ?? "the provider failed"}`, "warning", this.producer));
        return;
      case "compaction_end":
        if (record.result) this.producer.push(noticeChange("The conversation was compacted.", "info", this.producer));
        else if (str(record.errorMessage)) this.producer.push(noticeChange(`Compaction failed: ${str(record.errorMessage)}`, "error", this.producer));
        return;
      case "extension_error":
        this.producer.push(noticeChange(`An extension failed (${str(record.event) ?? "?"}): ${str(record.error) ?? ""}`, "warning", this.producer));
        return;
      default:
        return;
    }
  }

  /** A piece of the assistant's message as it is written: its text, its thinking, a call once whole. */
  #delta(event: Rec, t: Transcript): void {
    switch (event.type) {
      case "text_delta": {
        const delta = str(event.delta);
        if (delta) this.producer.push(textChange(t, "agent", delta, this.producer));
        return;
      }
      case "thinking_delta": {
        const delta = str(event.delta);
        if (delta) this.producer.push(textChange(t, "thought", delta, this.producer));
        return;
      }
      case "toolcall_end": {
        const call = obj(event.toolCall);
        const id = str(call?.id);
        if (!call || !id || findTool(t, id)) return;
        const name = str(call.name) ?? "tool";
        this.producer.push(toolPush(id, name, call.arguments, callContent(name, obj(call.arguments)), this.producer.now(), this.producer));
        return;
      }
      default:
        return;
    }
  }

  /** The assistant's message is whole: its model, usage, and how it ended (an error said). */
  #assistantEnd(msg: Rec, t: Transcript): void {
    const changes: Change[] = [];
    const model = [str(msg.provider), str(msg.model)].filter(Boolean).join("/");
    if (model && t.session && t.session.model !== model) changes.push({ type: "session", session: { ...t.session, model } });
    const usage = obj(msg.usage);
    if (usage) {
      this.#usage.cost += num(obj(usage.cost)?.total) ?? 0;
      this.#usage.tokens = num(usage.totalTokens) ?? this.#usage.tokens;
      changes.push({ type: "usage", usage: { ...(this.#usage.tokens ? { tokens: this.#usage.tokens } : {}), ...(this.#usage.cost > 0 ? { cost: { amount: this.#usage.cost, currency: "USD" } } : {}) } });
    }
    const stop = stopOf(msg.stopReason);
    if (stop && this.#turn) this.#turn.stop = stop;
    if (stop === "error" && str(msg.errorMessage)) changes.push(noticeChange(str(msg.errorMessage)!, "error", this.producer));
    this.producer.push(...changes);
  }

  /** pi will not go on by itself: the turn is over, and the next prompt queued goes. */
  #settled(aborted: boolean): void {
    const turn = this.#turn;
    this.#turn = undefined;
    this.#dropDialogs();
    const stop: StopReason = aborted ? "cancelled" : (turn?.stop ?? "end_turn");
    this.producer.push(...endTurnChanges(this.producer.transcript, { stop, ...(turn ? { durationMs: this.producer.now() - turn.startedAt } : {}) }, this.producer));
    void this.#sources().catch(() => {});
    this.#nextPrompt();
  }

  // ── Extensions' dialogs ───────────────────────────────────────────────────────────────────

  #dialog(record: Rec): void {
    const request = str(record.id);
    const method = str(record.method);
    if (!request || !method) return;
    if (method === "notify") {
      const level = record.notifyType === "error" ? "error" : record.notifyType === "warning" ? "warning" : "info";
      this.producer.push(noticeChange(str(record.message) ?? "", level, this.producer));
      return;
    }
    if (method !== "select" && method !== "confirm" && method !== "input" && method !== "editor") return;
    const id = `${this.producer.transcript.epoch.slice(0, 8)}.ui${request}`;
    const choices = method === "select" ? (Array.isArray(record.options) ? record.options.map(String) : []) : [];
    const options: Permission["options"] =
      method === "select"
        ? choices.map((label, at) => ({ id: String(at), label, kind: "other" }))
        : method === "confirm"
          ? [
              { id: "yes", label: "Yes", kind: "allow_once" },
              { id: "no", label: "No", kind: "reject_once" },
            ]
          : [{ id: "send", label: "Send", kind: "other" }];
    const permission: Permission = {
      id,
      kind: "question",
      title: str(record.title) ?? "pi asks",
      ...(str(record.message) || str(record.prefill) ? { detail: str(record.message) ?? str(record.prefill) } : {}),
      ...(method === "input" || method === "editor" ? { text: true } : {}),
      options,
    };
    this.#dialogs.set(id, { request, method, choices });
    this.producer.push({ type: "permissionAsked", permission });
  }

  /** Every dialog still open is cancelled, and taken off the transcript. */
  #dropDialogs(): void {
    for (const [id, dialog] of [...this.#dialogs]) {
      this.#dialogs.delete(id);
      this.#send({ type: "extension_ui_response", id: dialog.request, cancelled: true });
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
        this.#dropDialogs();
        await this.#call("abort");
        return;
      }
      case "answer": {
        const dialog = this.#dialogs.get(command.permissionId);
        if (!dialog) throw new Error("that question is no longer waiting");
        this.#dialogs.delete(command.permissionId);
        // A select answered in words (the chat's card has a field for one's own) sends the words:
        // the ask-user tool takes a reply that is no option as the user's own answer.
        const reply =
          dialog.method === "select"
            ? { value: command.text !== undefined && command.text.trim() !== "" ? command.text : dialog.choices[Number(command.optionId)] }
            : dialog.method === "confirm"
              ? { confirmed: command.optionId === "yes" }
              : { value: command.text ?? "" };
        this.#send({ type: "extension_ui_response", id: dialog.request, ...reply });
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
        if (command.category === "thought_level" && typeof command.value === "string") {
          await this.#call("set_thinking_level", { level: command.value });
          // pi takes the nearest level the model has: what it says it took is the level.
          const state = await this.#call<Rec>("get_state").catch(() => null);
          const level = str(state?.thinkingLevel) ?? command.value;
          this.producer.push({ type: "options", options: t.options.map((o) => (o.id === PI_THINKING ? { ...o, current: level } : o)) });
          return;
        }
        if (command.category !== "model" || typeof command.value !== "string") throw new Error(`pi has no ${command.category} to set here`);
        const at = command.value.indexOf("/");
        if (at <= 0) throw new Error(`not a model: ${command.value}`);
        await this.#call("set_model", { provider: command.value.slice(0, at), modelId: command.value.slice(at + 1) });
        const options = t.options.map((o) => (o.id === PI_MODEL ? { ...o, current: command.value } : o));
        this.producer.push({ type: "options", options });
        if (t.session) this.producer.push({ type: "session", session: { ...t.session, model: String(command.value) } });
        // The levels are the new model's, and pi picks its level for it.
        await this.#thinking();
        return;
      }
      case "rewind":
        await this.#rewindTo(command.entry);
        return;
      case "fork":
        return { session: await this.#fork(command.entry) };
      case "restore":
        throw new Error("pi keeps no checkpoints of the files");
    }
  }

  /**
   * Back to before the user's message `entryId`: pi forks its session there (a new session file
   * with what came before, which pi is on from now), and the conversation is that.
   */
  async #rewindTo(entryId: string): Promise<void> {
    const t = this.producer.transcript;
    if (this.#turn || t.queue.length > 0) throw new Error("pi is busy: go back once its turn is over");
    const entry = findEntry(t, entryId);
    if (entry?.kind !== "user") throw new Error("that is not one of your messages");
    if (!entry.source) throw new Error("that message is not in pi's session yet");
    const got = await this.#call<Rec>("fork", { entryId: entry.source });
    if (got?.cancelled === true) throw new Error("an extension of pi's kept the session from going back");
    const state = await this.#call<Rec>("get_state");
    const id = str(state?.sessionId) ?? "";
    this.producer.reset({ ...t, epoch: randomId(), seq: 0, session: t.session ? { ...t.session, id } : t.session, entries: t.entries.slice(0, entryIndex(t.entries, entry.id)), status: "idle", permissions: [], queue: [] });
    // The new file's entries have ids of their own.
    await this.#sources();
    this.#set({ session: id });
  }

  /**
   * A new session with the conversation through the turn `entryId` began, for a tab of its own:
   * pi forks at the next message (or copies the whole session, for the last turn), and goes back
   * to this session. Answers the new session's id.
   */
  async #fork(entryId: string): Promise<string> {
    const t = this.producer.transcript;
    if (this.#turn || t.queue.length > 0) throw new Error("pi is busy: fork once its turn is over");
    const at = entryIndex(t.entries, entryId);
    if (at < 0 || t.entries[at]!.kind !== "user") throw new Error("that is not one of your messages");
    const before = await this.#call<Rec>("get_state");
    const file = str(before?.sessionFile);
    if (!file) throw new Error("pi's session has no file to fork");
    const next = t.entries.slice(at + 1).find((each) => each.kind === "user");
    if (next && !next.source) throw new Error("the next message is not in pi's session yet");
    const got = next ? await this.#call<Rec>("fork", { entryId: next.source }) : await this.#call<Rec>("clone");
    if (got?.cancelled === true) throw new Error("an extension of pi's kept the session from forking");
    const forked = await this.#call<Rec>("get_state");
    const id = str(forked?.sessionId);
    const back = await this.#call<Rec>("switch_session", { sessionPath: file });
    if (back?.cancelled === true) throw new Error("pi forked the session, but an extension kept it from coming back to this one");
    if (!id || str(forked?.sessionFile) === file) throw new Error("pi did not fork the session");
    return id;
  }

  /** One turn: the prompt, then pi's work until it settles. */
  async #run(text: string, images: Image[]): Promise<void> {
    this.producer.push(...promptChanges(text, images, this.producer));
    this.#turn = { startedAt: this.producer.now() };
    const told = this.#context;
    this.#context = undefined;
    const expanded = expandSkills(text, this.producer.transcript.commands);
    const message = told ? `${told}\n\n${expanded}` : expanded;
    const inline = withBytes(images).filter((image) => image.data).map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
    try {
      const got = await this.#call<{ disposition?: string }>("prompt", { message, ...(inline.length ? { images: inline } : {}) });
      // A command an extension handled starts no run: nothing will settle it.
      if (got?.disposition === "handled") this.#settled(false);
    } catch (err) {
      const turn = this.#turn;
      this.#turn = undefined;
      this.producer.push(noticeChange(errorText(err), "error", this.producer));
      this.producer.push(...endTurnChanges(this.producer.transcript, { stop: "error", ...(turn ? { durationMs: this.producer.now() - turn.startedAt } : {}) }, this.producer));
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
    for (const waiting of this.#waiting.values()) waiting.reject(new Error("pi exited"));
    this.#waiting.clear();
    for (const id of this.#dialogs.keys()) if (this.producer.transcript.permissions.some((p) => p.id === id)) this.producer.push({ type: "permissionResolved", id });
    this.#dialogs.clear();
    const failed = code !== 0;
    const how = signal ? `was stopped (${signal})` : `exited with code ${code}`;
    const tail = stderr.length > 0 ? `\n\n\`\`\`\n${stderr.join("\n")}\n\`\`\`` : "";
    if (this.producer.transcript.queue.length > 0) this.producer.push({ type: "queue", queue: [] });
    this.producer.push(noticeChange(`pi ${how}.${failed ? tail : ""}`, failed ? "error" : "info", this.producer), { type: "status", status: failed ? "error" : "done" });
    this.producer.flush();
    this.#set({ phase: "exited", error: failed ? `pi ${how}` : undefined });
  }

  #set(patch: Partial<HostState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const key of Object.keys(this.#state) as (keyof HostState)[]) if (this.#state[key] === undefined) delete this.#state[key];
    this.events.state(this.#state);
  }
}

/** The entries on the branch that ends at `leaf`, oldest first (all of them, when pi names no leaf). */
export function branchOf(entries: Rec[], leaf: string | undefined): Rec[] {
  if (!leaf) return entries;
  const byId = new Map(entries.map((entry) => [str(entry.id) ?? "", entry]));
  const on = new Set<string>();
  for (let at: string | undefined = leaf; at && !on.has(at); at = str(byId.get(at)?.parentId)) on.add(at);
  return entries.filter((entry) => on.has(str(entry.id) ?? ""));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const errorText = message;
