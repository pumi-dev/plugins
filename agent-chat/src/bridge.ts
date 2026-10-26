// One agent pane's conversation, as the chat has it: its session file followed into a `Producer`
// (lib/conversation), the hook's `@agent.status` merged in, prompts typed into its terminal (or
// queued behind the running turn), and the requests pumi holds for it (`request.open`) shown as
// the conversation's. The TUI stays the session's only owner: this reads its file and types into
// its terminal, nothing else.
import { readFileSync, statSync } from "node:fs";

import { call, emit, request, ui } from "pumi";

import { ChangeError, CommandLedger, noticeChange, Producer, type Change, type Update } from "../../lib/conversation/src/change.ts";
import { cursorOf, describeInput, emptyTranscript, randomId, type Ack, type Command, type Cursor, type Image, type Permission, type PermissionKind, type SessionInfo, type SlashCommand, type Status, type Transcript } from "../../lib/conversation/src/model.ts";
import { promptParts, promptWrites, statusOf, takesPrompt, type AgentSpec } from "./agents.ts";
import { bareCommand, commandsFor } from "./commands.ts";
import { matchesEcho } from "./echo.ts";
import { locate, type Where } from "./locate.ts";
import { ClaudeParser } from "./parse/claude.ts";
import { CodexParser } from "./parse/codex.ts";
import { records, type Parser } from "./parse/common.ts";
import { PiParser } from "./parse/pi.ts";
import { assistantTimestamp, EMPTY, Live, liveFileOf, parseLive } from "./live.ts";
import { Tail } from "./tail.ts";
import { UPDATE, type Changed, type PaneUpdate } from "./topics.ts";

/** A permission a pane's agent asked for, as `request.opened` carries it. */
export interface Asked {
  request: string;
  pane: string | null;
  kind: string;
  title: string;
  detail: string | null;
  options: unknown[];
}

/** The pane options a bridge follows: what the hooks set. */
export interface PaneOptions {
  session?: string;
  transcript?: string;
  model?: string;
  status?: string;
  cwd?: string;
}

/** Between the paste and the Enter that submits it, in ms. */
const SUBMIT_DELAY = 300;
/** How long a prompt just typed waits for the hook to say the agent is working, in ms. */
const AWAIT_WORKING = 15_000;
/** How often it looks again for a session file that is not there yet, in ms (the most). */
const RETRY_MAX = 5_000;
/** Between one pasted picture and the next write, in ms: the TUI reads the file it names. */
const IMAGE_DELAY = 250;
/** How long the commands read from disk are kept before a read looks again, in ms. */
const COMMANDS_FRESH = 15_000;
/** How often pi's live file is looked at while the agent works, in ms. */
const LIVE_EVERY = 120;

function parserFor(spec: AgentSpec): Parser {
  switch (spec.format) {
    case "claude":
      return new ClaudeParser();
    case "codex":
      return new CodexParser();
    case "pi":
      return new PiParser();
  }
}

export class Bridge {
  readonly producer: Producer;
  #parser: Parser;
  #options: PaneOptions;
  #file: string | undefined;
  #tail: Tail | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #retryWait = 500;
  #waiting: string | undefined;
  /** What `@agent.status` says. */
  #status: Status;
  /** Set while a prompt just typed waits for the agent to say it is working. */
  #awaiting: ReturnType<typeof setTimeout> | undefined;
  #delivering = false;
  /** Prompts shown before the session file says them: entry id and text. */
  #echoes: { entry: string; text: string }[] = [];
  /** The request behind each permission shown: `request.open`'s id. */
  #requests = new Map<string, string>();
  #ledger = new CommandLedger();
  #disposed = false;
  /** The slash commands the agent takes (`commands.ts`), and when they were read. */
  #commands: SlashCommand[] = [];
  #commandsAt = 0;
  /** pi's message and tool output as they come (`live.ts`); none for the other agents. */
  #live: Live | undefined;
  #liveTimer: ReturnType<typeof setInterval> | undefined;
  /** The live file's mtime and size when last read. */
  #liveSeen = "";

  constructor(
    readonly pane: number,
    readonly spec: AgentSpec,
    options: PaneOptions,
    /** The most of a session file's end read at first, in bytes. */
    readonly history: () => number,
  ) {
    this.#options = options;
    this.#status = statusOf(options.status);
    this.#parser = parserFor(spec);
    this.#readCommands();
    this.producer = new Producer({ transcript: this.#empty(), publish: (update) => this.#publish(update) });
    this.#open();
  }

  get transcript(): Transcript {
    return this.producer.transcript;
  }

  /** What brings a view at `since` up to now. */
  read(since?: Cursor): Update {
    if (Date.now() - this.#commandsAt > COMMANDS_FRESH) this.refreshCommands();
    return this.producer.read(since);
  }

  /** The agent's directory, which its mentions are written from. */
  get cwd(): string | undefined {
    return this.#options.cwd;
  }

  /** The command `text` is, when it is one with nothing after its name. */
  commandOf(text: string): SlashCommand | undefined {
    return bareCommand(text, this.#commands);
  }

  /** Reads the commands from disk again: a new command file shows in the `/` list. */
  refreshCommands(): void {
    const before = JSON.stringify(this.#commands);
    this.#readCommands();
    if (JSON.stringify(this.#commands) !== before) this.#push({ type: "commands", commands: this.#commands });
  }

  #readCommands(): void {
    this.#commandsAt = Date.now();
    try {
      this.#commands = commandsFor(this.spec, this.#options.cwd);
    } catch (err) {
      console.warn(`agent-chat: the commands: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#tail?.stop();
    this.#stopLive();
    clearTimeout(this.#retry);
    clearTimeout(this.#awaiting);
    this.producer.dispose();
  }

  // ── The pane's options ──────────────────────────────────────────────────────────────────────

  /** A hook changed one of the pane's options. */
  optionChanged(name: string, value: unknown): void {
    const text = typeof value === "string" && value !== "" ? value : undefined;
    switch (name) {
      case "@agent.status":
        this.#status = statusOf(value);
        if (this.#status === "working") this.#settled();
        this.#syncStatus();
        this.#drain();
        return;
      case "@agent.model": {
        this.#options.model = text;
        const session = this.transcript.session;
        if (session && text && session.model !== text) this.#push({ type: "session", session: { ...session, model: text } });
        return;
      }
      case "pane_current_path": {
        // The agent moved: its mentions and its project's commands are the new directory's.
        if (!text || text === this.#options.cwd) return;
        this.#options.cwd = text;
        this.refreshCommands();
        const session = this.transcript.session;
        if (session) this.#push({ type: "session", session: { ...session, cwd: text } });
        return;
      }
      case "@agent.session":
      case "@agent.transcript": {
        const before = { ...this.#options };
        if (name === "@agent.session") this.#options.session = text;
        else this.#options.transcript = text;
        if (before.session === this.#options.session && before.transcript === this.#options.transcript) return;
        // A new session (`/clear`, a resume): another file. A path given for the session it was in already is the same one.
        const next = locate(this.spec.format, this.spec.id, this.#where());
        if (next !== undefined && next === this.#file) return;
        this.#restart();
        return;
      }
    }
  }

  // ── Reading the session file ────────────────────────────────────────────────────────────────

  #where(): Where {
    return { transcript: this.#options.transcript, session: this.#options.session, cwd: this.#options.cwd };
  }

  #session(): SessionInfo {
    return { id: this.#options.session ?? "", cwd: this.#options.cwd, agent: this.spec.label, model: this.#options.model };
  }

  #empty(): Transcript {
    return { ...emptyTranscript(randomId(), this.#session()), status: this.#status, commands: this.#commands };
  }

  /** Another session: the file is found again and read from its end. */
  #restart(): void {
    this.#tail?.stop();
    this.#tail = undefined;
    this.#stopLive();
    this.#file = undefined;
    this.#echoes = [];
    clearTimeout(this.#retry);
    this.#retry = undefined;
    this.#waiting = undefined;
    const keep = this.transcript;
    this.producer.reset({ ...this.#empty(), queue: keep.queue, permissions: keep.permissions });
    this.#syncStatus();
    this.#open();
  }

  /** Finds the session file and reads it; while it is not there, says so and looks again. */
  #open(): void {
    if (this.#disposed) return;
    const file = locate(this.spec.format, this.spec.id, this.#where());
    if (!file) {
      if (this.#waiting === undefined) {
        const said = this.#options.session ? `Waiting for ${this.spec.label} to write its session file…` : `Waiting for ${this.spec.label} to say which session it is in (its hook: \`pumi skill add ${this.spec.id}\`)…`;
        const notice = noticeChange(said, "info", this.producer);
        this.#waiting = notice.type === "push" ? notice.entry.id : undefined;
        this.#push(notice);
      }
      this.#retry = setTimeout(() => this.#open(), this.#retryWait);
      this.#retryWait = Math.min(RETRY_MAX, this.#retryWait * 2);
      return;
    }
    this.#retryWait = 500;
    this.#file = file;
    this.#parser = parserFor(this.spec);
    const tail = new Tail(file, {
      max: this.history(),
      onLines: (lines, first, skipped) => (first ? this.#first(lines, skipped) : this.#more(lines)),
      onReset: () => this.#reread(),
    });
    // Before the first read, which marks the messages the file has as done.
    if (this.spec.format === "pi") this.#live = new Live();
    try {
      tail.start();
      this.#tail = tail;
      if (this.#live) this.#followLive(file);
    } catch (err) {
      console.error(`agent-chat: ${file}: ${err instanceof Error ? err.message : String(err)}`);
      this.#file = undefined;
      this.#retry = setTimeout(() => this.#open(), RETRY_MAX);
    }
  }

  /** The file was cut, replaced, or went to another branch: read it again. */
  #reread(): void {
    this.#tail?.stop();
    this.#tail = undefined;
    this.#stopLive();
    this.#open();
  }

  /**
   * The end of the file, read at first: parsed into a transcript of its own (with nothing sent,
   * flushed now and then so it stays in bounds), which then replaces the producer's in a new epoch.
   * What the chat holds of its own (the queue, the requests, prompts not yet in the file) stays.
   */
  #first(lines: string[], skipped: boolean): void {
    const keep = this.transcript;
    const loading = new Producer({ transcript: { ...emptyTranscript(randomId(), keep.session ?? this.#session()) }, publish: () => {} });
    if (skipped) loading.push(noticeChange("Older turns are left out: the session file is longer than the chat reads (Agent chat → History read).", "info", loading));
    let all = records(lines);
    if (this.#parser.select) all = this.#parser.select(all);
    let n = 0;
    for (const record of all) {
      this.#live?.done(assistantTimestamp(record));
      for (const change of this.#parser.record(record, loading.transcript, loading)) {
        try {
          loading.push(change);
        } catch (err) {
          if (!(err instanceof ChangeError)) throw err;
        }
      }
      if (++n % 500 === 0) loading.flush();
    }
    const echoes = keep.entries.filter((entry) => this.#echoes.some((echo) => echo.entry === entry.id));
    loading.flush();
    loading.dispose();
    const loaded = loading.transcript;
    this.#echoes = this.#echoes.filter((echo) => !loaded.entries.some((entry) => entry.kind === "user" && matchesEcho(entry.text ?? "", echo.text)));
    const still = echoes.filter((entry) => this.#echoes.some((echo) => echo.entry === entry.id));
    this.#waiting = undefined;
    this.producer.reset({ ...loaded, entries: [...loaded.entries, ...still], queue: keep.queue, permissions: keep.permissions, status: keep.status, commands: this.#commands });
    this.#syncStatus();
  }

  /** Lines appended to the file: their changes, a prompt already shown as an echo left out. */
  #more(lines: string[]): void {
    for (const record of records(lines)) {
      if (this.#parser.continues && !this.#parser.continues(record)) {
        this.#reread();
        return;
      }
      let changes = this.#parser.record(record, this.transcript, this.producer);
      if (this.#live && assistantTimestamp(record) !== undefined) changes = this.#live.settle(assistantTimestamp(record), changes, this.transcript);
      for (const change of changes) {
        if (change.type === "push" && change.entry.kind === "user" && this.#unecho(change.entry.text ?? "")) continue;
        this.#push(change);
      }
    }
  }

  // ── pi's live file ──────────────────────────────────────────────────────────────────────────

  #followLive(file: string): void {
    if (this.#liveTimer) clearInterval(this.#liveTimer);
    const path = liveFileOf(file);
    this.#liveTimer = setInterval(() => this.#readLive(path), LIVE_EVERY);
  }

  #stopLive(): void {
    if (this.#liveTimer) clearInterval(this.#liveTimer);
    this.#liveTimer = undefined;
    this.#live = undefined;
    this.#liveSeen = "";
  }

  /** What the live file says now, shown; only while the agent works, so a file a crash left is not. */
  #readLive(path: string): void {
    const live = this.#live;
    const status = this.#shown();
    if (!live || (status !== "working" && status !== "blocked")) return;
    let seen = "";
    let text = "";
    try {
      const stat = statSync(path);
      seen = `${stat.mtimeMs}:${stat.size}`;
      if (seen === this.#liveSeen) return;
      text = readFileSync(path, "utf8");
    } catch {
      // Not there: nothing streams now, and what streamed is in the session file.
      this.#liveSeen = "";
      return;
    }
    this.#liveSeen = seen;
    const snapshot = parseLive(text) ?? EMPTY;
    for (const change of live.show(snapshot, this.transcript, this.producer)) this.#push(change);
  }

  /** Whether `text` is a prompt already shown (and no longer waited for). */
  #unecho(text: string): boolean {
    const at = this.#echoes.findIndex((echo) => matchesEcho(text, echo.text));
    if (at < 0) return false;
    this.#echoes.splice(at, 1);
    return true;
  }

  /** Applies a change; one that does not fit (the file and the chat disagree) is left out. */
  #push(change: Change): void {
    try {
      this.producer.push(change);
    } catch (err) {
      if (!(err instanceof ChangeError)) throw err;
      console.warn(`agent-chat: pane ${this.pane}: ${err.message}`);
    }
  }

  #publish(update: Update): void {
    ui.post(UPDATE, { pane: this.pane, update } satisfies PaneUpdate);
    // The conversation convention (`@agent.conversation`): `{pane, changes, cursor}`, and `from`
    // for a reader that follows batch by batch. A snapshot (a new epoch) moves the cursor's epoch:
    // a reader reads again.
    const changed: Changed =
      update.type === "changes"
        ? { pane: this.pane, changes: update.changes, cursor: update.to, from: update.from }
        : { pane: this.pane, changes: [], cursor: cursorOf(update.transcript), from: null };
    emit("conversation.changed", changed, { pane: `%${this.pane}` }).catch((err) => console.warn(`agent-chat: conversation.changed: ${err?.message ?? err}`));
  }

  // ── Status ──────────────────────────────────────────────────────────────────────────────────

  /** The status the chat shows: blocked on a request, working on a prompt just typed, else the hook's. */
  #shown(): Status {
    if (this.transcript.permissions.length > 0) return "blocked";
    if (this.#awaiting !== undefined && takesPrompt(this.#status)) return "working";
    return this.#status;
  }

  #syncStatus(): void {
    const status = this.#shown();
    if (this.transcript.status !== status) this.#push({ type: "status", status });
  }

  /** The agent took the prompt (or never said it did): stop waiting for it to. */
  #settled(): void {
    clearTimeout(this.#awaiting);
    this.#awaiting = undefined;
  }

  // ── Commands ────────────────────────────────────────────────────────────────────────────────

  /** A view's command: acted on once per id. */
  async send(command: Command): Promise<Ack> {
    if (!this.#ledger.first(command.id)) return { id: command.id };
    switch (command.type) {
      case "prompt": {
        const text = command.text.trim();
        const images = command.images ?? [];
        if (text === "" && images.length === 0) return { id: command.id, rejected: "The prompt is empty." };
        if (images.some((image) => !image.uri || /^[a-z]+:/i.test(image.uri))) return { id: command.id, rejected: "Only pictures from files can go into the terminal." };
        if (this.#ready() && this.transcript.queue.length === 0) return this.#deliver(command.id, text, images);
        this.#push({ type: "queue", queue: [...this.transcript.queue, { id: command.id, text, ...(images.length > 0 ? { images } : {}) }] });
        return { id: command.id };
      }
      case "cancel":
        await call("pane.call", `%${this.pane}`, "input", { text: this.spec.cancel });
        return { id: command.id };
      case "unqueue":
        this.#push({ type: "queue", queue: this.transcript.queue.filter((each) => each.id !== command.queued) });
        return { id: command.id };
      case "answer": {
        const asked = this.#requests.get(command.permissionId);
        if (asked === undefined) return { id: command.id, rejected: "That request is no longer waiting." };
        try {
          await request.close(asked, { answer: { option: command.optionId } });
        } catch {
          this.resolved(asked);
          return { id: command.id, rejected: "It was answered already, or it ended." };
        }
        return { id: command.id };
      }
      case "setOption":
        return { id: command.id, rejected: `${this.spec.label}'s settings are changed in its terminal.` };
      case "context":
        return { id: command.id, rejected: "A terminal agent's context goes through its own hook." };
    }
  }

  /** Whether a prompt typed now goes in at once. */
  #ready(): boolean {
    return !this.#delivering && this.#awaiting === undefined && takesPrompt(this.#status) && this.transcript.permissions.length === 0;
  }

  /**
   * Types `text` into the terminal (the pictures' paths before it) and submits it; it shows at
   * once, before the file says it. The pictures show when the file does: an echo of them could
   * not be matched with the file's copy.
   */
  async #deliver(id: string, prompt: string, images: Image[] = []): Promise<Ack> {
    this.#delivering = true;
    const { pastes, text } = promptParts(this.spec, prompt, images.map((image) => image.uri!));
    const shown = text.trim();
    if (shown !== "") {
      const entry = this.producer.id();
      this.#push({ type: "push", entry: { id: entry, kind: "user", at: this.producer.now(), text: shown } });
      this.#echoes.push({ entry, text: shown });
    }
    this.#awaiting = setTimeout(() => {
      this.#awaiting = undefined;
      this.#syncStatus();
      this.#drain();
    }, AWAIT_WORKING);
    this.#syncStatus();
    try {
      for (const paste of pastes) {
        await call("pane.call", `%${this.pane}`, "input", { paste });
        await Bun.sleep(IMAGE_DELAY);
      }
      const writes = promptWrites(text);
      if (text !== "") await call("pane.call", `%${this.pane}`, "input", writes.body);
      await Bun.sleep(SUBMIT_DELAY);
      await call("pane.call", `%${this.pane}`, "input", writes.submit);
      return { id };
    } catch (err) {
      this.#settled();
      const said = err instanceof Error ? err.message : String(err);
      this.#push(noticeChange(`The prompt did not reach the terminal: ${said}`, "error", this.producer));
      this.#syncStatus();
      return { id, rejected: said };
    } finally {
      this.#delivering = false;
    }
  }

  /** The next queued prompt, once the agent takes one. */
  #drain(): void {
    if (!this.#ready()) return;
    const [next, ...rest] = this.transcript.queue;
    if (!next) return;
    this.#push({ type: "queue", queue: rest });
    void this.#deliver(next.id, next.text, next.images ?? []).then(() => this.#drain());
  }

  // ── Requests (`request.open`) ───────────────────────────────────────────────────────────────

  /** A request pumi holds for this pane: shown as the conversation's permission. */
  requested(asked: Asked): void {
    const id = `request:${asked.request}`;
    if (this.#requests.has(id) || this.transcript.permissions.some((each) => each.id === id)) return;
    const options = (asked.options ?? [])
      .map((each) => each as { id?: unknown; label?: unknown; kind?: unknown })
      .filter((each): each is { id: string; label: string; kind?: unknown } => typeof each.id === "string" && typeof each.label === "string")
      .map((each) => ({ id: each.id, label: each.label, kind: each.kind as PermissionKind }));
    if (options.length === 0) return;
    const detail = asked.detail ?? undefined;
    const permission: Permission = { id, title: asked.title, options, ...(detail ? { detail } : {}) };
    this.#requests.set(id, asked.request);
    this.#push({ type: "permissionAsked", permission });
    this.#syncStatus();
  }

  /** A request ended (answered here or elsewhere, timed out, withdrawn). */
  resolved(request: string): void {
    const id = `request:${request}`;
    this.#requests.delete(id);
    if (this.transcript.permissions.some((each) => each.id === id)) this.#push({ type: "permissionResolved", id });
    this.#syncStatus();
    this.#drain();
  }
}
