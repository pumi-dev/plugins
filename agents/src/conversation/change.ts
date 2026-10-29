// One step from one transcript to the next, and the reducer every side runs: the producer applies a
// change to its own transcript and publishes it, a view applies the same change to its copy, and
// both arrive at the same value. Changes go out in batches (`Producer`: consecutive appends merged,
// at most one batch every ~60 ms), each moving the cursor's `seq` by one; a view that missed one
// asks for a snapshot. No `import … from "pumi"` here.
import {
  cursorOf,
  emptyTranscript,
  entryIndex,
  entryTextLength,
  findEntry,
  randomId,
  type ConfigOption,
  type Cursor,
  type Entry,
  type Image,
  type NoticeLevel,
  type Permission,
  type PlanItem,
  type Queued,
  type SessionInfo,
  type SlashCommand,
  type Status,
  type Tool,
  type ToolContent,
  type Transcript,
  type TurnSummary,
  type Usage,
} from "./model.ts";

/** A tool call's fields an update says again; each given one replaces the old. */
export type ToolPatch = Partial<Omit<Tool, "id">>;

export type Change =
  /** A new entry after every other. */
  | { type: "push"; entry: Entry }
  /** More text for a user, agent, thought or notice entry; `clipped` when the rest was cut. */
  | { type: "append"; id: string; text: string; clipped?: boolean }
  /** An entry's new value, by its id. */
  | { type: "replace"; entry: Entry }
  /** Some of a tool entry's call, by the entry's id. */
  | { type: "tool"; id: string; patch: ToolPatch }
  /** The entries before `before` were dropped to stay in bounds. */
  | { type: "truncate"; before: string }
  | { type: "status"; status: Status }
  /** A request to answer: the status becomes `blocked`. */
  | { type: "permissionAsked"; permission: Permission }
  /** It was answered or withdrawn: with none left, a `blocked` status goes back to `working`. */
  | { type: "permissionResolved"; id: string }
  | { type: "plan"; plan: PlanItem[] }
  | { type: "options"; options: ConfigOption[] }
  | { type: "commands"; commands: SlashCommand[] }
  | { type: "usage"; usage: Usage }
  | { type: "session"; session?: SessionInfo }
  | { type: "queue"; queue: Queued[] };

/** A change that does not fit the transcript it is applied to: the two are out of step. */
export class ChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeError";
  }
}

/** The transcript after `change`; the old one is left as it was. Throws `ChangeError` when it does not fit. */
export function apply(t: Transcript, change: Change): Transcript {
  switch (change.type) {
    case "push": {
      if (entryIndex(t.entries, change.entry.id) >= 0) throw new ChangeError(`entry ${change.entry.id} is already there`);
      return { ...t, entries: [...t.entries, change.entry] };
    }
    case "append": {
      const at = entryIndex(t.entries, change.id);
      if (at < 0) throw new ChangeError(`no entry ${change.id} to append to`);
      const entry = t.entries[at]!;
      if (!hasText(entry)) throw new ChangeError(`entry ${change.id} (${entry.kind}) takes no text`);
      const next: Entry = { ...entry, text: (entry.text ?? "") + change.text };
      if (change.clipped) next.clipped = true;
      return { ...t, entries: replaceAt(t.entries, at, next) };
    }
    case "replace": {
      const at = entryIndex(t.entries, change.entry.id);
      if (at < 0) throw new ChangeError(`no entry ${change.entry.id} to replace`);
      return { ...t, entries: replaceAt(t.entries, at, change.entry) };
    }
    case "tool": {
      const at = entryIndex(t.entries, change.id);
      if (at < 0) throw new ChangeError(`no entry ${change.id} to patch`);
      const entry = t.entries[at]!;
      if (!entry.tool) throw new ChangeError(`entry ${change.id} is not a tool call`);
      return { ...t, entries: replaceAt(t.entries, at, { ...entry, tool: { ...entry.tool, ...change.patch } }) };
    }
    case "truncate": {
      const at = entryIndex(t.entries, change.before);
      if (at < 0) throw new ChangeError(`no entry ${change.before} to truncate before`);
      return at === 0 ? t : { ...t, entries: t.entries.slice(at), truncated: true };
    }
    case "status":
      return { ...t, status: change.status };
    case "permissionAsked": {
      if (t.permissions.some((each) => each.id === change.permission.id)) throw new ChangeError(`request ${change.permission.id} is already asked`);
      return { ...t, permissions: [...t.permissions, change.permission], status: "blocked" };
    }
    case "permissionResolved": {
      if (!t.permissions.some((each) => each.id === change.id)) throw new ChangeError(`no request ${change.id} to resolve`);
      const permissions = t.permissions.filter((each) => each.id !== change.id);
      const status = permissions.length === 0 && t.status === "blocked" ? "working" : t.status;
      return { ...t, permissions, status };
    }
    case "plan":
      return { ...t, plan: change.plan };
    case "options":
      return { ...t, options: change.options };
    case "commands":
      return { ...t, commands: change.commands };
    case "usage":
      return { ...t, usage: change.usage };
    case "session":
      return { ...t, session: change.session };
    case "queue":
      return { ...t, queue: change.queue };
  }
}

/** Every change applied in order. */
export function applyAll(t: Transcript, changes: Change[]): Transcript {
  return changes.reduce(apply, t);
}

function hasText(entry: Entry): boolean {
  return entry.kind === "user" || entry.kind === "agent" || entry.kind === "thought" || entry.kind === "notice";
}

function replaceAt<T>(list: T[], at: number, value: T): T[] {
  const next = list.slice();
  next[at] = value;
  return next;
}

// ── Merging ─────────────────────────────────────────────────────────────────────────────────

/** Changes whose later one says all the earlier one did: only the last of a run of them counts. */
const WHOLE = new Set<Change["type"]>(["status", "plan", "options", "commands", "usage", "session", "queue"]);

/**
 * The same changes, fewer: consecutive appends to one entry joined, an append or a tool patch
 * folded into the push or replace just before it, consecutive patches of one tool merged, and a run
 * of one whole-value change (status, plan, …) cut to its last. Applying the result gives the same
 * transcript as applying `changes`.
 */
export function coalesce(changes: Change[]): Change[] {
  const out: Change[] = [];
  for (const change of changes) {
    const last = out[out.length - 1];
    const merged = last ? merge(last, change) : undefined;
    if (merged) out[out.length - 1] = merged;
    else out.push(change);
  }
  return out;
}

function merge(a: Change, b: Change): Change | undefined {
  if (b.type === "append") {
    if (a.type === "append" && a.id === b.id) return { type: "append", id: a.id, text: a.text + b.text, ...(a.clipped || b.clipped ? { clipped: true } : {}) };
    if ((a.type === "push" || a.type === "replace") && a.entry.id === b.id && hasText(a.entry)) {
      const entry: Entry = { ...a.entry, text: (a.entry.text ?? "") + b.text };
      if (b.clipped) entry.clipped = true;
      return { type: a.type, entry };
    }
  }
  if (b.type === "tool") {
    if (a.type === "tool" && a.id === b.id) return { type: "tool", id: a.id, patch: { ...a.patch, ...b.patch } };
    if ((a.type === "push" || a.type === "replace") && a.entry.id === b.id && a.entry.tool) return { type: a.type, entry: { ...a.entry, tool: { ...a.entry.tool, ...b.patch } } };
  }
  if (b.type === "replace" && (a.type === "push" || a.type === "replace") && a.entry.id === b.entry.id) return { type: a.type, entry: b.entry };
  if (WHOLE.has(b.type) && a.type === b.type) return b;
  return undefined;
}

// ── Bounds ──────────────────────────────────────────────────────────────────────────────────

/** How big a transcript may grow. Text is measured as string length (UTF-16 units). */
export interface Bounds {
  /** Entries kept; older ones are dropped. */
  entries: number;
  /** The text of every entry together. */
  text: number;
  /** The text of one entry, its tool's output included; the rest is cut (`clipped`). */
  entryText: number;
}

export const BOUNDS: Bounds = { entries: 2000, text: 4_000_000, entryText: 256_000 };

/** A truncation drops down to this share of the bounds, so the next one is a while off. */
const SLACK = 0.8;

/**
 * The change as the producer applies it, cut to `bounds.entryText`: an append past the limit is
 * shortened and marks the entry `clipped` (and is dropped once it is), a pushed or replaced entry
 * has its text cut (a terminal's output keeps its tail), and a tool patch that would overflow
 * becomes a replace of the cut entry. `undefined` when nothing of it is left.
 */
export function clip(t: Transcript, change: Change, bounds: Bounds = BOUNDS): Change | undefined {
  switch (change.type) {
    case "append": {
      const entry = findEntry(t, change.id);
      if (!entry) return change;
      if (entry.clipped) return undefined;
      const room = Math.max(0, bounds.entryText - entryTextLength(entry));
      if (change.text.length <= room) return change;
      return { type: "append", id: change.id, text: change.text.slice(0, room), clipped: true };
    }
    case "push":
    case "replace":
      return entryTextLength(change.entry) <= bounds.entryText ? change : { type: change.type, entry: clipEntry(change.entry, bounds.entryText) };
    case "tool": {
      const entry = findEntry(t, change.id);
      if (!entry?.tool || !change.patch.content) return change;
      const next: Entry = { ...entry, tool: { ...entry.tool, ...change.patch } };
      return entryTextLength(next) <= bounds.entryText ? change : { type: "replace", entry: clipEntry(next, bounds.entryText) };
    }
    default:
      return change;
  }
}

/** `entry` with no more than `limit` of text: the text first, then its tool's parts in order. */
export function clipEntry(entry: Entry, limit: number): Entry {
  let room = limit;
  const take = (text: string, tail = false): string => {
    const kept = text.length <= room ? text : tail ? text.slice(text.length - room) : text.slice(0, room);
    room -= kept.length;
    return kept;
  };
  const next: Entry = { ...entry, clipped: true };
  if (entry.text !== undefined) next.text = take(entry.text);
  if (entry.tool) {
    const content = entry.tool.content.map((part): ToolContent => {
      switch (part.type) {
        case "text":
          return { type: "text", text: take(part.text) };
        case "terminal":
          return { ...part, output: take(part.output, true) };
        case "diff": {
          const size = (part.old?.length ?? 0) + part.new.length + (part.unified?.length ?? 0);
          if (size <= room) {
            room -= size;
            return part;
          }
          return { type: "text", text: take(`The change to ${part.path} is too large to show.`) };
        }
        case "image":
          return part;
      }
    });
    next.tool = { ...entry.tool, content };
  }
  return next;
}

/** A truncate that brings the transcript under `bounds` (down to 80% of them), when it is over. */
export function bound(t: Transcript, bounds: Bounds = BOUNDS): Change | undefined {
  const sizes = t.entries.map(entryTextLength);
  let total = sizes.reduce((sum, n) => sum + n, 0);
  if (t.entries.length <= bounds.entries && total <= bounds.text) return undefined;
  let drop = 0;
  // The newest entry always stays.
  while (drop < t.entries.length - 1 && (t.entries.length - drop > bounds.entries * SLACK || total > bounds.text * SLACK)) {
    total -= sizes[drop]!;
    drop++;
  }
  return drop === 0 ? undefined : { type: "truncate", before: t.entries[drop]!.id };
}

// ── The stream ──────────────────────────────────────────────────────────────────────────────

/** The whole transcript; its cursor is its own `epoch` and `seq`. Replaces what a view had. */
export interface Snapshot {
  type: "snapshot";
  transcript: Transcript;
}

/** The changes that take a view at `from` to `to`. */
export interface Batch {
  type: "changes";
  from: Cursor;
  to: Cursor;
  changes: Change[];
}

/** What a producer sends: a batch, or a snapshot when a view cannot be brought up by one. */
export type Update = Snapshot | Batch;

/**
 * A view's transcript after `update`, or `undefined` when it must ask for a snapshot (`read`
 * without a cursor): it has none, the epoch moved, it missed a batch, or a change did not fit. A
 * batch it already has, and a snapshot older than what it has, leave it as it was.
 */
export function follow(local: Transcript | undefined, update: Update): Transcript | undefined {
  if (update.type === "snapshot") {
    if (!local || local.epoch !== update.transcript.epoch || update.transcript.seq >= local.seq) return update.transcript;
    return local;
  }
  if (!local || local.epoch !== update.to.epoch) return undefined;
  if (update.to.seq <= local.seq) return local;
  if (update.from.epoch !== local.epoch || update.from.seq !== local.seq) return undefined;
  try {
    return { ...applyAll(local, update.changes), seq: update.to.seq };
  } catch (err) {
    if (err instanceof ChangeError) return undefined;
    throw err;
  }
}

/** What a mapping needs of its producer: ids for new entries, and the time. `Producer` is one. */
export interface Stamp {
  /** A new entry id, unique in the transcript. */
  id(): string;
  /** Now, in ms since the epoch. */
  now(): number;
}

/** How a producer is driven: where its batches go, and how its clock ticks. */
export interface ProducerOptions {
  /** The transcript to go on from (its epoch and seq kept); a new empty one when left out. */
  transcript?: Transcript;
  /** Each batch, as it is made: send it to every view. */
  publish(update: Update): void;
  bounds?: Partial<Bounds>;
  /** The least time between two batches, in ms. 60 by default. */
  interval?: number;
  /** How many batches are kept for `read(since)`. 512 by default. */
  keep?: number;
  now?(): number;
  timers?: Timers;
}

/** A clock's timer: what `setTimeout` answers, or a test's own. */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface Timers {
  set(fn: () => void, ms: number): TimerHandle;
  clear(handle: TimerHandle): void;
}

/**
 * The side that owns the conversation. `push` applies changes to its transcript at once (so a
 * mapping reading `transcript` sees them), cut to its bounds, and gathers them; at most every
 * `interval` ms they go out as one coalesced batch, moving `seq` by one. `read(since)` answers a
 * view that (re)connects: the batches it missed, or a snapshot. A snapshot always includes what
 * was pending, so it is published first.
 */
export class Producer implements Stamp {
  #transcript: Transcript;
  #pending: Change[] = [];
  #log: Batch[] = [];
  #timer: TimerHandle | undefined = undefined;
  #last = -Infinity;
  #next = 0;
  #prefix: string;
  readonly #bounds: Bounds;
  readonly #options: ProducerOptions;

  constructor(options: ProducerOptions) {
    this.#options = options;
    this.#bounds = { ...BOUNDS, ...options.bounds };
    this.#transcript = options.transcript ?? emptyTranscript();
    this.#prefix = this.#transcript.epoch.slice(0, 8);
    this.#next = nextIdAfter(this.#transcript, this.#prefix);
  }

  get transcript(): Transcript {
    return this.#transcript;
  }

  id(): string {
    return `${this.#prefix}.${this.#next++}`;
  }

  now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  /** Applies `changes` now and sends them with the next batch. Throws `ChangeError` on one that does not fit. */
  push(...changes: Change[]): void {
    for (const change of changes) {
      const kept = clip(this.#transcript, change, this.#bounds);
      if (!kept) continue;
      this.#transcript = apply(this.#transcript, kept);
      this.#pending.push(kept);
    }
    if (this.#pending.length > 0) this.#schedule();
  }

  /** Sends what is pending now. */
  flush(): void {
    this.#cancel();
    if (this.#pending.length === 0) return;
    const cut = bound(this.#transcript, this.#bounds);
    if (cut) {
      this.#transcript = apply(this.#transcript, cut);
      this.#pending.push(cut);
    }
    const from = cursorOf(this.#transcript);
    this.#transcript = { ...this.#transcript, seq: from.seq + 1 };
    const batch: Batch = { type: "changes", from, to: cursorOf(this.#transcript), changes: coalesce(this.#pending) };
    this.#pending = [];
    this.#last = this.now();
    this.#log.push(batch);
    const keep = this.#options.keep ?? 512;
    if (this.#log.length > keep) this.#log.splice(0, this.#log.length - keep);
    this.#options.publish(batch);
  }

  snapshot(): Snapshot {
    this.flush();
    return { type: "snapshot", transcript: this.#transcript };
  }

  /** What brings a view at `since` up to now: the batches after it, merged, or a snapshot. */
  read(since?: Cursor): Update {
    this.flush();
    const now = cursorOf(this.#transcript);
    if (!since || since.epoch !== now.epoch || since.seq > now.seq) return this.snapshot();
    if (since.seq === now.seq) return { type: "changes", from: now, to: now, changes: [] };
    const first = this.#log.findIndex((batch) => batch.from.seq === since.seq);
    if (first < 0) return this.snapshot();
    return { type: "changes", from: since, to: now, changes: coalesce(this.#log.slice(first).flatMap((batch) => batch.changes)) };
  }

  /** Starts a new epoch from `transcript` (the session reloaded, say), and publishes its snapshot. */
  reset(transcript: Transcript = emptyTranscript(randomId(), this.#transcript.session)): Snapshot {
    this.#cancel();
    this.#pending = [];
    this.#log = [];
    this.#transcript = transcript;
    this.#prefix = transcript.epoch.slice(0, 8);
    this.#next = nextIdAfter(transcript, this.#prefix);
    const snapshot: Snapshot = { type: "snapshot", transcript };
    this.#options.publish(snapshot);
    return snapshot;
  }

  /** Stops the timer; what is pending stays until the next `flush`. */
  dispose(): void {
    this.#cancel();
  }

  #schedule(): void {
    if (this.#timer !== undefined) return;
    const interval = this.#options.interval ?? 60;
    const wait = Math.max(0, interval - (this.now() - this.#last));
    const set = this.#options.timers?.set ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.#timer = set(() => {
      this.#timer = undefined;
      this.flush();
    }, wait);
  }

  #cancel(): void {
    if (this.#timer === undefined) return;
    const clear = this.#options.timers?.clear ?? ((handle: TimerHandle) => clearTimeout(handle));
    clear(this.#timer);
    this.#timer = undefined;
  }
}

/** The counter after every id of the form `<prefix>.<n>` the transcript already has. */
function nextIdAfter(t: Transcript, prefix: string): number {
  let next = 0;
  for (const entry of t.entries) {
    if (!entry.id.startsWith(`${prefix}.`)) continue;
    const n = Number(entry.id.slice(prefix.length + 1));
    if (Number.isInteger(n) && n >= next) next = n + 1;
  }
  return next;
}

// ── What every producer says ────────────────────────────────────────────────────────────────

/** A prompt the user sent: its entry (and one per image), and the turn starting. */
export function promptChanges(text: string, images: Image[] = [], stamp: Stamp): Change[] {
  const at = stamp.now();
  const changes: Change[] = [];
  if (text !== "") changes.push({ type: "push", entry: { id: stamp.id(), kind: "user", at, text } });
  for (const image of images) changes.push({ type: "push", entry: { id: stamp.id(), kind: "image", at, image, from: "user" } });
  changes.push({ type: "status", status: "working" });
  return changes;
}

/**
 * A turn's end: its summary entry, the requests still asked withdrawn, the calls still open marked
 * `canceled` when it was cancelled or failed, and the status `done` (`error` when it failed).
 */
export function endTurnChanges(t: Transcript, summary: TurnSummary, stamp: Stamp): Change[] {
  const changes: Change[] = [];
  if (summary.stop === "cancelled" || summary.stop === "error") {
    for (const entry of t.entries) {
      if (entry.tool && (entry.tool.status === "pending" || entry.tool.status === "running")) changes.push({ type: "tool", id: entry.id, patch: { status: "canceled" } });
    }
  }
  for (const permission of t.permissions) changes.push({ type: "permissionResolved", id: permission.id });
  changes.push({ type: "push", entry: { id: stamp.id(), kind: "turn", at: stamp.now(), turn: summary } });
  changes.push({ type: "status", status: summary.stop === "error" ? "error" : "done" });
  return changes;
}

/** Something the producer says about the session, not part of its history. */
export function noticeChange(text: string, level: NoticeLevel, stamp: Stamp): Change {
  return { type: "push", entry: { id: stamp.id(), kind: "notice", at: stamp.now(), text, level } };
}

/**
 * The text of a streamed `kind` ("agent", "thought", "user"): an append to the newest entry when
 * it is of that kind, else a new entry.
 */
export function textChange(t: Transcript, kind: "user" | "agent" | "thought", text: string, stamp: Stamp): Change {
  const last = t.entries[t.entries.length - 1];
  if (last && last.kind === kind) return { type: "append", id: last.id, text };
  return { type: "push", entry: { id: stamp.id(), kind, at: stamp.now(), text } };
}

/** Remembers the commands acted on, so a resent one is acted on once. */
export class CommandLedger {
  #seen = new Set<string>();
  readonly #keep: number;

  constructor(keep = 512) {
    this.#keep = keep;
  }

  /** Whether `id` is new: true the first time, false after. */
  first(id: string): boolean {
    if (this.#seen.has(id)) return false;
    this.#seen.add(id);
    if (this.#seen.size > this.#keep) this.#seen.delete(this.#seen.values().next().value!);
    return true;
  }
}
