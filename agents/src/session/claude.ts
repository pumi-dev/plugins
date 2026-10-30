// Claude Code through Anthropic's Agent SDK (`@anthropic-ai/claude-agent-sdk`), run in the host:
// the SDK drives the user's own `claude` (found on `PATH`, signed in as it is), with the user's
// settings, in streaming-input mode, so one query is the whole session and each prompt a turn. What
// it says (partial messages for the text as it is written, whole messages for calls and their
// results) becomes the conversation's changes, read as the session file's parser reads the same
// records; a tool that needs permission (`canUseTool`) is a permission in the chat. A tab with a
// session resumes it (`resume`) and shows its history from the session file.
//
// Each prompt carries a uuid of the host's, which Claude keeps as its record's: the session's chain
// of record uuids is what an edit goes back along (a new query on the same session, resumed at the
// record before the message: `resumeSessionAt`), what a fork cuts at (`forkSession`), and what a
// checkpoint names (`rewindFiles`, with `enableFileCheckpointing`). Thinking (`setMaxThinkingTokens`),
// its effort (`applyFlagSettings`) and the permission mode (`setPermissionMode`) are the session's
// options. No `import … from "pumi"` here.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { CommandLedger, endTurnChanges, noticeChange, Producer, promptChanges, textChange, type Change } from "../conversation/change.ts";
import { entryIndex, findEntry, randomId, type Ack, type Choice, type Command, type ConfigOption, type Image, type Permission, type StopReason } from "../conversation/model.ts";
import { locate } from "../locate.ts";
import { ClaudeParser } from "../parse/claude.ts";
import { num, obj, objs, records, str, type Rec } from "../parse/common.ts";
import type { Driver, SessionEvents } from "./engines.ts";
import { expandSkills, findSkills, skillFolders, withBytes, withSkills } from "./prompt.ts";
import { findProgram, searchPath } from "./launch.ts";
import type { HostSpec, HostState } from "./wire.ts";

/** The pickers' option ids. */
export const CLAUDE_MODEL = "claude.model";
export const CLAUDE_THINKING = "claude.thinking";
export const CLAUDE_MODE = "claude.mode";

/** The thought level's choice that turns thinking off, and the one for a model without effort levels. */
const OFF = "off";
const ON = "on";

/** The effort levels as Zed names them. */
const EFFORT_NAMES: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra High", max: "Max" };

/** Claude Code's permission modes, as its ACP adapter offers them. */
const MODES: Choice[] = [
  { id: "default", name: "Default", description: "Asks before edits and commands it isn't allowed." },
  { id: "acceptEdits", name: "Accept Edits", description: "Edits files without asking." },
  { id: "plan", name: "Plan Mode", description: "Reads and plans; changes nothing." },
  { id: "bypassPermissions", name: "Bypass Permissions", description: "Runs everything without asking." },
];

/** What the SDK's query is to this file: the generator of its messages, and its controls. */
interface Query extends AsyncGenerator<Rec, void> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  supportedModels(): Promise<Rec[]>;
  supportedCommands(): Promise<Rec[]>;
  setPermissionMode?(mode: string): Promise<void>;
  setMaxThinkingTokens?(tokens: number | null): Promise<void>;
  applyFlagSettings?(settings: Rec): Promise<void>;
  rewindFiles?(userMessageId: string, options?: { dryRun?: boolean }): Promise<Rec>;
  getContextUsage?(options?: { detail?: "summary" | "full" }): Promise<Rec>;
  close?(): void;
}

interface Sdk {
  query(params: { prompt: AsyncIterable<UserMessage>; options: Rec }): Query;
  forkSession?(session: string, options?: { dir?: string; upToMessageId?: string }): Promise<{ sessionId: string }>;
}

/** A user message, as the SDK takes one. */
interface UserMessage {
  type: "user";
  message: { role: "user"; content: Rec[] };
  parent_tool_use_id: null;
  session_id: string;
  uuid: string;
}

/** The prompts one query takes, as they are sent, until it is closed. */
class Inbox {
  #queue: UserMessage[] = [];
  #wake: (() => void) | undefined;
  #closed = false;

  push(message: UserMessage): void {
    this.#queue.push(message);
    this.#wake?.();
  }

  close(): void {
    this.#closed = true;
    this.#wake?.();
  }

  async *messages(): AsyncGenerator<UserMessage> {
    while (!this.#closed) {
      const next = this.#queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => (this.#wake = resolve));
      this.#wake = undefined;
    }
  }
}

/** How a query starts: on a session (`resume`), at one of its records (`at`), with Bypass allowed. */
interface Opening {
  resume?: string;
  at?: string;
}

export class ClaudeSession implements Driver {
  readonly producer: Producer;
  #state: HostState;
  #ledger = new CommandLedger();
  #parser = new ClaudeParser();
  #sdk: Sdk | undefined;
  #claude: string | undefined;
  #query: Query | undefined;
  #inbox: Inbox | undefined;
  /** Which query is the session's now: a query ended after another took its place is not news. */
  #generation = 0;
  #exited = false;
  #turn: { startedAt: number } | undefined;
  #context: string | undefined;
  /** Whether text of the message being written came as partial messages (its whole message adds none). */
  #streamed = false;
  #asked = new Map<string, (optionId?: string) => void>();
  #asks = 0;
  /** Whether the running turn was stopped from the chat. */
  #interrupted = false;
  /** The session's records, oldest first: the uuids of its prompts, replies and results. */
  #chain: string[] = [];
  #inChain = new Set<string>();
  /** What Claude offers (`supportedModels`), the model picked, and how it thinks. */
  #models: Rec[] = [];
  #model: string | undefined;
  #thinking = true;
  #effort: string | undefined;
  #mode = "default";
  /** Whether the mode was picked here: then a query's `init`, which says the mode it began with, does not undo it. */
  #modePicked = false;
  /** Whether the running query was started allowing Bypass Permissions. */
  #bypassable = false;

  constructor(
    private readonly spec: HostSpec,
    private readonly events: SessionEvents,
  ) {
    this.producer = new Producer({ publish: (update) => events.update(update) });
    this.#state = { phase: "starting", agent: spec.agent, name: spec.name, cwd: spec.cwd, pid: process.pid, canLoad: true, canList: false, canResume: true, canEdit: true, canFork: true };
  }

  get state(): HostState {
    return this.#state;
  }

  /** The SDK runs `claude` itself: the host has no process of its to feed. */
  feed(): void {}

  exited(): void {}

  // ── Setting the session up ────────────────────────────────────────────────────────────────

  async begin(): Promise<void> {
    try {
      // SAFETY: the SDK's module (or a test's stand-in) exports `query` and `forkSession`; their
      // records are read as untyped JSON here, as the session file's are.
      this.#sdk = (await (this.spec.claudeSdk ? import(this.spec.claudeSdk) : import("@anthropic-ai/claude-agent-sdk"))) as unknown as Sdk;
    } catch (err) {
      this.#set({ error: `the Claude Agent SDK is not installed with the plugin (bun install in its folder): ${message(err)}` });
      return;
    }
    this.#claude = findProgram("claude", searchPath(process.env.PATH));
    if (!this.#claude && !this.spec.claudeSdk) {
      this.#set({ error: "Claude Code (`claude`) is not on PATH" });
      return;
    }
    if (!this.#sdk.forkSession) this.#set({ canFork: false });
    const session = this.spec.mode === "load" ? this.spec.session : undefined;
    if (this.spec.mode === "pick") this.producer.push(noticeChange("Claude's sessions aren't listed here: this is a new one.", "info", this.producer));
    if (session) this.#history(session);
    this.producer.push({ type: "session", session: { id: session ?? "", cwd: this.spec.cwd, agent: this.spec.name } });
    this.#effort = userEffort();
    try {
      this.#open({ resume: session });
    } catch (err) {
      this.#set({ error: `Claude did not start: ${message(err)}` });
      return;
    }
    // Ready now: the prompt waits in the query's inbox while Claude starts. The models and commands
    // it offers come when it can say them (a second or so: it starts its MCP servers first).
    this.producer.push({ type: "status", status: "idle" });
    this.producer.flush();
    this.#set({ phase: "ready", ...(session ? { session } : {}), error: undefined });
    void this.#controls()
      .then(() => this.producer.flush())
      .catch((err) => process.stderr.write(`claude: its models and commands: ${message(err)}\n`));
  }

  async start(): Promise<void> {}

  async auth(): Promise<void> {}

  async retry(): Promise<void> {
    if (this.#exited || this.#state.phase === "ready" || this.#query) return;
    await this.begin();
  }

  /** A query on the session, in place of the one before (which is closed): one `claude` runs it. */
  #open({ resume, at }: Opening): void {
    const sdk = this.#sdk!;
    this.#close();
    const generation = ++this.#generation;
    const inbox = new Inbox();
    this.#inbox = inbox;
    this.#bypassable = this.#mode === "bypassPermissions";
    this.#query = sdk.query({
      prompt: inbox.messages(),
      options: {
        cwd: this.spec.cwd,
        pathToClaudeCodeExecutable: this.#claude,
        includePartialMessages: true,
        settingSources: ["user", "project", "local"],
        // What `rewindFiles` puts back: a copy of each file before Claude changes it.
        enableFileCheckpointing: true,
        ...(this.#model ? { model: this.#model } : {}),
        ...(this.#mode !== "default" ? { permissionMode: this.#mode } : {}),
        // Only when the user picked it: the SDK refuses Bypass Permissions without.
        ...(this.#bypassable ? { allowDangerouslySkipPermissions: true } : {}),
        ...(this.#thinking ? {} : { thinking: { type: "disabled" } }),
        ...(this.#thinking && this.#effort && this.#effort !== ON ? { effort: this.#effort } : {}),
        ...(resume ? { resume } : {}),
        ...(resume && at ? { resumeSessionAt: at } : {}),
        canUseTool: (name: string, input: Rec, options: Rec) => this.#permission(name, input, options),
        stderr: (data: string) => process.stderr.write(`claude: ${data}`),
      },
    });
    void this.#read(this.#query, generation);
  }

  /** The running query, let go of; what it says from now on is not the session's. */
  #close(): void {
    this.#generation++;
    this.#inbox?.close();
    this.#inbox = undefined;
    try {
      this.#query?.close?.();
    } catch {
      // It was closed already.
    }
    this.#query = undefined;
  }

  /**
   * A resumed session's history, from its file: the SDK does not say it again. A file Claude went
   * back in (an edit here, its own /rewind) holds the branches it left too: only the records on the
   * way to the newest one are the conversation's.
   */
  #history(session: string): void {
    const file = locate("claude", "claude", { session, cwd: this.spec.cwd });
    if (!file) return;
    let lines: string[];
    try {
      lines = readFileSync(file, "utf8").split("\n");
    } catch {
      return;
    }
    const all = [...records(lines)];
    const branch = activeBranch(all);
    const snapshots = new Set(all.filter((r) => r.type === "file-history-snapshot").map((r) => str(r.messageId) ?? ""));
    const parser = new ClaudeParser();
    for (const record of all) {
      const uuid = str(record.uuid);
      if (uuid && record.isSidechain !== true) {
        if (!branch.has(uuid)) continue;
        this.#link(uuid);
      }
      const changes = parser.record(record, this.producer.transcript, this.producer).map((change) => withCheckpoint(change, snapshots));
      this.producer.push(...changes);
    }
  }

  /** A record of the session's, in the order Claude wrote it. */
  #link(uuid: string): void {
    if (this.#inChain.has(uuid)) return;
    this.#inChain.add(uuid);
    this.#chain.push(uuid);
  }

  /** The session's records up to (not with) `uuid`: what is left when the session goes back to before it. */
  #cut(uuid: string): void {
    const at = this.#chain.indexOf(uuid);
    if (at < 0) return;
    for (const gone of this.#chain.splice(at)) this.#inChain.delete(gone);
  }

  /** The models, commands and settings Claude offers, once it can say. */
  async #controls(): Promise<void> {
    const q = this.#query;
    if (!q) return;
    const [models, commands] = await Promise.all([q.supportedModels().catch(() => []), q.supportedCommands().catch(() => [])]);
    this.#models = objs(models);
    if (!this.#model) this.#model = str(this.#models[0]?.value);
    this.#options();
    const listed = objs(commands).map((c) => ({ name: str(c.name) ?? "", ...(str(c.description) ? { description: str(c.description) } : {}), ...(str(c.argumentHint) ? { hint: str(c.argumentHint) } : {}) })).filter((c) => c.name !== "");
    // Claude's skills, found in its folders: a prompt that names one anywhere is sent with it (`prompt.ts`).
    const all = withSkills(listed, findSkills(skillFolders("claude", this.spec.cwd)));
    if (all.length > 0) this.producer.push({ type: "commands", commands: all });
  }

  /** The model Claude runs, as its list has it: by its alias, or the id the alias resolves to. */
  #modelInfo(): Rec | undefined {
    const now = this.#model ?? this.producer.transcript.session?.model;
    return this.#models.find((m) => m.value === now || m.resolvedModel === now) ?? this.#models[0];
  }

  /** The pickers: the model, how it thinks (its effort levels), and the permission mode. */
  #options(): void {
    const options: ConfigOption[] = [];
    const choices = this.#models.map((m) => ({ id: str(m.value) ?? "", name: str(m.displayName) ?? str(m.value) ?? "", ...(str(m.description) ? { description: str(m.description) } : {}) })).filter((c) => c.id !== "");
    if (choices.length > 0) options.push({ id: CLAUDE_MODEL, category: "model", name: "Model", current: str(this.#modelInfo()?.value) ?? choices[0]!.id, choices });
    const info = this.#modelInfo();
    const levels = info?.supportsEffort === true ? (Array.isArray(info.supportedEffortLevels) ? info.supportedEffortLevels.map(String) : []) : [];
    const kinds: Choice[] = levels.length > 0 ? levels.map((level) => ({ id: level, name: EFFORT_NAMES[level] ?? level })) : [{ id: ON, name: "On" }];
    const fallback = levels.includes("high") ? "high" : (kinds[kinds.length - 1]?.id ?? ON);
    // A level the new model has not: its own default.
    if (this.#effort && !kinds.some((k) => k.id === this.#effort)) this.#effort = undefined;
    options.push({
      id: CLAUDE_THINKING,
      category: "thought_level",
      name: "Thinking",
      current: this.#thinking ? (this.#effort ?? fallback) : OFF,
      choices: [{ id: OFF, name: "Off" }, ...kinds],
      off: OFF,
      default: fallback,
    });
    options.push({ id: CLAUDE_MODE, category: "mode", name: "Mode", current: this.#mode, choices: MODES });
    this.producer.push({ type: "options", options });
  }

  // ── What Claude says ──────────────────────────────────────────────────────────────────────

  async #read(q: Query, generation: number): Promise<void> {
    try {
      for await (const m of q) if (generation === this.#generation) this.#message(m);
      if (generation === this.#generation) this.#gone(undefined);
    } catch (err) {
      if (generation === this.#generation) this.#gone(message(err));
    }
  }

  #message(m: Rec): void {
    // A subagent's messages are its own conversation's.
    if (m.parent_tool_use_id) return;
    const t = this.producer.transcript;
    if ((m.type === "assistant" || m.type === "user") && str(m.uuid)) this.#link(str(m.uuid)!);
    switch (m.type) {
      case "stream_event": {
        const event = obj(m.event);
        if (event?.type === "message_start") this.#streamed = false;
        if (event?.type !== "content_block_delta") return;
        const delta = obj(event.delta);
        if (delta?.type === "text_delta" && str(delta.text)) {
          this.#streamed = true;
          this.producer.push(textChange(t, "agent", str(delta.text)!, this.producer));
        } else if (delta?.type === "thinking_delta" && str(delta.thinking)) {
          this.#streamed = true;
          this.producer.push(textChange(t, "thought", str(delta.thinking)!, this.producer));
        }
        return;
      }
      case "assistant": {
        const msg = obj(m.message) ?? {};
        // Its text came as it was written: what is left is its calls, model and usage.
        const content = this.#streamed ? objs(msg.content).filter((b) => b.type !== "text" && b.type !== "thinking") : msg.content;
        this.producer.push(...this.#parser.record({ type: "assistant", message: { ...msg, content }, ...(m.error ? { isApiErrorMessage: true } : {}) }, t, this.producer));
        return;
      }
      case "user": {
        const msg = obj(m.message) ?? {};
        // The prompt it echoes is shown already: only the results of calls are new.
        if (!objs(msg.content).some((b) => b.type === "tool_result")) return;
        this.producer.push(...this.#parser.record({ type: "user", message: msg, ...(m.tool_use_result !== undefined ? { toolUseResult: m.tool_use_result } : {}) }, t, this.producer));
        return;
      }
      case "system": {
        if (m.subtype === "init") {
          const id = str(m.session_id);
          const model = str(m.model);
          if (t.session) this.producer.push({ type: "session", session: { ...t.session, ...(id ? { id } : {}), ...(model ? { model } : {}) } });
          const mode = str(m.permissionMode);
          if (mode && !this.#modePicked && MODES.some((each) => each.id === mode)) this.#mode = mode;
          if (this.#models.length > 0) this.#options();
          if (id && id !== this.#state.session) this.#set({ session: id });
        } else if (m.subtype === "compact_boundary") this.producer.push(noticeChange("The conversation was compacted.", "info", this.producer));
        return;
      }
      case "result":
        return this.#result(m);
      default:
        return;
    }
  }

  /** A turn's end: how it stopped, what it cost. */
  #result(m: Rec): void {
    const turn = this.#turn;
    this.#turn = undefined;
    this.#dropAsked();
    const cost = num(m.total_cost_usd);
    if (cost) this.producer.push({ type: "usage", usage: { ...this.producer.transcript.usage, cost: { amount: cost, currency: "USD" } } });
    let stop: StopReason;
    if (this.#interrupted) stop = "cancelled";
    else if (m.subtype === "success") stop = m.stop_reason === "max_tokens" ? "max_tokens" : m.is_error === true ? "error" : "end_turn";
    else stop = m.subtype === "error_max_turns" ? "max_turn_requests" : "error";
    this.#interrupted = false;
    if (stop === "error") {
      const errors = Array.isArray(m.errors) ? m.errors.map(String).join("\n") : str(m.result);
      if (errors) this.producer.push(noticeChange(errors, "error", this.producer));
    }
    this.producer.push(...endTurnChanges(this.producer.transcript, { stop, ...(turn ? { durationMs: num(m.duration_ms) ?? this.producer.now() - turn.startedAt } : {}) }, this.producer));
    void this.#contextUsage();
    this.#nextPrompt();
  }

  /** How full the context window is now, as `/context` counts it. */
  async #contextUsage(): Promise<void> {
    const got = await this.#query?.getContextUsage?.({ detail: "summary" }).catch(() => undefined);
    const tokens = num(got?.totalTokens);
    const size = num(got?.maxTokens);
    if (tokens === undefined || !size) return;
    const pct = num(got?.percentage) ?? (tokens / size) * 100;
    this.producer.push({ type: "usage", usage: { ...this.producer.transcript.usage, tokens, contextSize: size, contextPct: Math.min(100, Math.round(pct)) } });
  }

  /** The query ended: Claude exited, or the SDK failed. */
  #gone(error: string | undefined): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#dropAsked();
    if (this.producer.transcript.queue.length > 0) this.producer.push({ type: "queue", queue: [] });
    this.producer.push(noticeChange(error ? `Claude stopped: ${error}` : "Claude stopped.", error ? "error" : "info", this.producer), { type: "status", status: error ? "error" : "done" });
    this.producer.flush();
    this.#set({ phase: "exited", error: error ? `Claude stopped: ${error}` : undefined });
  }

  // ── Permissions ───────────────────────────────────────────────────────────────────────────

  /** A tool Claude may not run without asking: a permission in the chat, answered as the SDK takes it. */
  #permission(name: string, input: Rec, options: Rec): Promise<Rec> {
    const id = `${this.producer.transcript.epoch.slice(0, 8)}.ask${++this.#asks}`;
    const suggestions = Array.isArray(options.suggestions) ? options.suggestions : [];
    const command = str(input.command);
    const path = str(input.file_path) ?? str(input.path);
    const permission: Permission = {
      id,
      ...(str(options.toolUseID) ? { toolId: str(options.toolUseID) } : {}),
      title: str(options.title) ?? (command ? `Run \`${command}\`?` : `Allow ${name}${path ? ` on ${path}` : ""}?`),
      ...(str(options.decisionReason) || str(options.description) ? { detail: str(options.decisionReason) ?? str(options.description) } : {}),
      options: [
        { id: "allow", label: "Allow", kind: "allow_once" },
        ...(suggestions.length > 0 && options.suppressAlwaysAllowRule !== true ? [{ id: "always", label: "Always Allow", kind: "allow_always" as const }] : []),
        { id: "deny", label: "Deny", kind: "reject_once" },
      ],
    };
    this.producer.push({ type: "permissionAsked", permission });
    return new Promise((resolve) => {
      const signal = options.signal as AbortSignal | undefined;
      const done = (optionId?: string) => {
        this.#asked.delete(id);
        if (this.producer.transcript.permissions.some((p) => p.id === id)) this.producer.push({ type: "permissionResolved", id });
        if (optionId === "allow") resolve({ behavior: "allow", updatedInput: input });
        else if (optionId === "always") resolve({ behavior: "allow", updatedInput: input, updatedPermissions: suggestions });
        else resolve({ behavior: "deny", message: optionId === "deny" ? "The user said no." : "The request was withdrawn." });
      };
      this.#asked.set(id, done);
      signal?.addEventListener("abort", () => this.#asked.get(id)?.(undefined), { once: true });
    });
  }

  #dropAsked(): void {
    for (const done of [...this.#asked.values()]) done(undefined);
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
          this.#rewindTo(command.replaces);
          this.#run(command.text, command.images ?? []);
          return;
        }
        if (this.#turn || t.queue.length > 0) {
          this.producer.push({ type: "queue", queue: [...t.queue, { id: command.id, text: command.text, ...(command.images ? { images: command.images } : {}) }] });
        } else this.#run(command.text, command.images ?? []);
        return;
      }
      case "cancel": {
        if (!this.#turn) throw new Error("no turn is running");
        if (t.queue.length > 0) this.producer.push({ type: "queue", queue: [] });
        this.#dropAsked();
        this.#interrupted = true;
        await this.#query?.interrupt();
        return;
      }
      case "answer": {
        const done = this.#asked.get(command.permissionId);
        if (!done) throw new Error("that request is no longer waiting");
        done(command.optionId);
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
      case "setOption":
        return this.#setOption(command.category, command.value);
      case "rewind":
        this.#rewindTo(command.entry);
        return;
      case "fork":
        return { session: await this.#fork(command.entry) };
      case "restore":
        return this.#restore(command.entry);
    }
  }

  async #setOption(category: string, value: string | boolean): Promise<void> {
    const q = this.#query;
    if (typeof value !== "string") throw new Error(`Claude has no ${category} to turn on or off`);
    if (this.#turn) throw new Error("change it once Claude's turn is over");
    switch (category) {
      case "model": {
        await q?.setModel(value);
        this.#model = value;
        const t = this.producer.transcript;
        if (t.session) this.producer.push({ type: "session", session: { ...t.session, model: value } });
        break;
      }
      case "thought_level": {
        if (value === OFF) {
          await q?.setMaxThinkingTokens?.(0);
          this.#thinking = false;
          break;
        }
        if (!this.#thinking) await q?.setMaxThinkingTokens?.(null);
        this.#thinking = true;
        if (value !== ON) {
          await q?.applyFlagSettings?.({ effortLevel: value });
          this.#effort = value;
        }
        break;
      }
      case "mode": {
        if (!MODES.some((each) => each.id === value)) throw new Error(`Claude has no mode ${value}`);
        this.#mode = value;
        this.#modePicked = true;
        // Bypass Permissions is allowed only by a query started allowing it: the session goes on in a new one.
        if (value === "bypassPermissions" && !this.#bypassable) this.#open({ resume: this.#state.session });
        else await q?.setPermissionMode?.(value);
        break;
      }
      default:
        throw new Error(`Claude has no ${category} to set here`);
    }
    this.#options();
  }

  /**
   * Back to before the user's message `entryId`: the conversation after it is let go, and Claude
   * goes on in a query resumed at the record before it (the message's own turn and what followed
   * stay in the file, as a branch left behind). The first message goes back to a new session.
   */
  #rewindTo(entryId: string): void {
    const t = this.producer.transcript;
    if (this.#turn || t.queue.length > 0) throw new Error("Claude is busy: go back once its turn is over");
    const entry = findEntry(t, entryId);
    if (entry?.kind !== "user") throw new Error("that is not one of your messages");
    const at = entry.source ? this.#chain.indexOf(entry.source) : -1;
    if (at < 0) throw new Error("that message is not in Claude's session yet");
    const before = at > 0 ? this.#chain[at - 1] : undefined;
    this.#cut(entry.source!);
    this.producer.reset({ ...t, epoch: randomId(), seq: 0, entries: t.entries.slice(0, entryIndex(t.entries, entry.id)), status: "idle", permissions: [], queue: [] });
    const session = this.#state.session;
    if (!before) this.#set({ session: undefined });
    this.#open(before && session ? { resume: session, at: before } : {});
  }

  /** A new session with the conversation through the turn `entryId` began: its id, for a tab of its own. */
  async #fork(entryId: string): Promise<string> {
    const sdk = this.#sdk;
    const session = this.#state.session;
    if (!sdk?.forkSession) throw new Error("this Agent SDK can't fork a session");
    if (!session) throw new Error("the session has nothing to fork yet");
    const t = this.producer.transcript;
    const at = entryIndex(t.entries, entryId);
    if (at < 0 || t.entries[at]!.kind !== "user") throw new Error("that is not one of your messages");
    // The turn ends where the next message begins; the last turn is the whole session.
    const next = t.entries.slice(at + 1).find((each) => each.kind === "user" && each.source && this.#inChain.has(each.source));
    const cut = next ? this.#chain.indexOf(next.source!) : -1;
    if (!next && this.#turn) throw new Error("fork this turn once it is over");
    const upTo = cut > 0 ? this.#chain[cut - 1] : undefined;
    const got = await sdk.forkSession(session, { dir: this.spec.cwd, ...(upTo ? { upToMessageId: upTo } : {}) });
    return got.sessionId;
  }

  /** The files as they were before the user's message `entryId` (Claude's file checkpoints). */
  async #restore(entryId: string): Promise<void> {
    const q = this.#query;
    if (!q?.rewindFiles) throw new Error("this Agent SDK can't restore files");
    if (this.#turn) throw new Error("restore the files once Claude's turn is over");
    const entry = findEntry(this.producer.transcript, entryId);
    if (entry?.kind !== "user" || !entry.source) throw new Error("that message has no checkpoint");
    const got = await q.rewindFiles(entry.source);
    if (got?.canRewind === false) throw new Error(str(got.error) ?? "Claude has no checkpoint for that message");
    const files = Array.isArray(got?.filesChanged) ? got.filesChanged.length : 0;
    const said = files === 0 ? "The files were already as they were before that message." : `Restored ${files} file${files === 1 ? "" : "s"} to before that message (+${num(got?.insertions) ?? 0} −${num(got?.deletions) ?? 0}).`;
    this.producer.push(noticeChange(said, "info", this.producer));
  }

  /** One turn: the prompt goes to the SDK, and the turn runs until its `result`. */
  #run(text: string, images: Image[]): void {
    const uuid = randomUUID();
    const changes = promptChanges(text, images, this.producer).map((change): Change => (change.type === "push" && change.entry.kind === "user" ? { ...change, entry: { ...change.entry, source: uuid, checkpoint: true } } : change));
    this.producer.push(...changes);
    this.#link(uuid);
    this.#turn = { startedAt: this.producer.now() };
    const told = this.#context;
    this.#context = undefined;
    const content: Rec[] = [];
    if (told) content.push({ type: "text", text: told });
    content.push({ type: "text", text: expandSkills(text, this.producer.transcript.commands) });
    for (const image of withBytes(images)) {
      if (image.data) content.push({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } });
      else if (image.uri) content.push({ type: "text", text: `(An image: ${image.uri.replace(/^file:\/\//, "")})` });
    }
    this.#inbox?.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: this.#state.session ?? "", uuid });
  }

  #nextPrompt(): void {
    const [first, ...rest] = this.producer.transcript.queue;
    if (!first || this.#exited || this.#state.phase !== "ready") return;
    this.producer.push({ type: "queue", queue: rest });
    this.#run(first.text, first.images ?? []);
  }

  /** The session stops: the SDK lets `claude` go. */
  async stop(): Promise<void> {
    this.#dropAsked();
    this.#close();
  }

  #set(patch: Partial<HostState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const key of Object.keys(this.#state) as (keyof HostState)[]) if (this.#state[key] === undefined) delete this.#state[key];
    this.events.state(this.#state);
  }
}

/**
 * The uuids of the records on the way to the newest one: the conversation as it is now, without
 * the branches an edit or a /rewind left. A compaction's boundary links back by `logicalParentUuid`.
 */
export function activeBranch(all: Rec[]): Set<string> {
  const byId = new Map<string, Rec>();
  let leaf: string | undefined;
  for (const record of all) {
    const uuid = str(record.uuid);
    if (!uuid || record.isSidechain === true) continue;
    byId.set(uuid, record);
    if (record.type === "user" || record.type === "assistant" || record.type === "system" || record.type === "attachment") leaf = uuid;
  }
  const branch = new Set<string>();
  for (let at = leaf; at && !branch.has(at); ) {
    branch.add(at);
    const record = byId.get(at);
    at = str(record?.parentUuid) ?? str(record?.logicalParentUuid);
  }
  // Records outside any chain (a file older than the uuids) are all kept.
  for (const [uuid, record] of byId) if (!record.parentUuid && !record.logicalParentUuid && !branch.has(uuid) && byId.size === 1) branch.add(uuid);
  return branch;
}

/** A user message pushed from the file: one Claude has a checkpoint of (`file-history-snapshot`) can be restored. */
function withCheckpoint(change: Change, snapshots: Set<string>): Change {
  if (change.type !== "push" || change.entry.kind !== "user" || !change.entry.source || !snapshots.has(change.entry.source)) return change;
  return { ...change, entry: { ...change.entry, checkpoint: true } };
}

/** The effort level the user's settings pick (`effortLevel` in ~/.claude/settings.json), if any. */
function userEffort(): string | undefined {
  try {
    const home = process.env.CLAUDE_CONFIG_DIR ?? `${process.env.HOME ?? ""}/.claude`;
    const settings = JSON.parse(readFileSync(`${home}/settings.json`, "utf8"));
    return typeof settings?.effortLevel === "string" ? settings.effortLevel : undefined;
  } catch {
    return undefined;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
