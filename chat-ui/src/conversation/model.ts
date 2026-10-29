// The conversation, as every side of it has it: what an agent and its user said, the tools it ran,
// what it asks, and what it can be told. Agent-agnostic and JSON all the way down, so a producer
// (a worker reading a transcript file, an ACP client) and every view hold the same value, kept in
// step by `change.ts`'s one reducer. No `import … from "pumi"` here.
import { randomUUID } from "node:crypto";

/** Where the agent is: waiting for a prompt, turning, waiting on an answer, finished, or broken. */
export type Status = "idle" | "working" | "blocked" | "done" | "error";

/** The session the conversation is of. */
export interface SessionInfo {
  /** The agent's own id for it (ACP's `sessionId`, Claude's session uuid). */
  id: string;
  cwd?: string;
  title?: string;
  /** Its display name: `Claude`, `Codex`, `pi`. */
  agent?: string;
  model?: string;
}

/** A picture: inline (`data`, base64) or by where it is (`uri`: a path, a `file:` or `http(s):` URL). */
export interface Image {
  mimeType: string;
  data?: string;
  uri?: string;
}

export type EntryKind = "user" | "agent" | "thought" | "tool" | "plan" | "notice" | "image" | "turn";

/** One row of the timeline. The fields beside `kind` are the ones that kind has. */
export interface Entry {
  /** The producer's id, unique in the transcript (`newEntryId`). */
  id: string;
  kind: EntryKind;
  /** When it began, in ms since the epoch (Unix time). */
  at: number;
  /** user, agent, thought, notice: the text, markdown for user and agent. */
  text?: string;
  /** tool: the call. */
  tool?: Tool;
  /** image: the picture, and who put it there. */
  image?: Image;
  from?: "user" | "agent";
  /** plan: the plan as it was when it was said. */
  plan?: PlanItem[];
  /** notice: how loud. */
  level?: NoticeLevel;
  /** turn: how a prompt turn ended. */
  turn?: TurnSummary;
  /** Its text was cut to stay in bounds (`Bounds.entryText`). */
  clipped?: boolean;
  /** The agent's own id for what it came from (pi's entry id, Claude's record uuid, Codex's turn id): what a rewind or a fork names. */
  source?: string;
  /** user: the files can be put back as they were before it (`restore`). */
  checkpoint?: boolean;
}

export type NoticeLevel = "info" | "warning" | "error";

export type ToolKind = "shell" | "read" | "edit" | "write" | "search" | "fetch" | "subagent" | "mcp" | "other";
export type ToolStatus = "pending" | "running" | "completed" | "failed" | "canceled";

/** A tool call, with everything its updates have said so far. */
export interface Tool {
  /** The agent's id for the call, unique in the session (ACP's `toolCallId`). */
  id: string;
  kind: ToolKind;
  title: string;
  status: ToolStatus;
  /** What it was called with, as the agent gave it (ACP's `rawInput`). */
  input?: unknown;
  content: ToolContent[];
  /** The files it touches. */
  locations?: Location[];
}

export interface Location {
  path: string;
  line?: number;
}

export type ToolContent =
  | { type: "text"; text: string }
  /** A file change. `old` is absent for a new file; `unified` is the patch when the producer has it. */
  | { type: "diff"; path: string; old?: string; new: string; unified?: string }
  /** A command's output. `id` names the terminal it ran in, when the producer streams it later. */
  | { type: "terminal"; output: string; exitCode?: number; id?: string }
  | { type: "image"; image: Image };

export type PlanStatus = "pending" | "in_progress" | "completed";

export interface PlanItem {
  content: string;
  status: PlanStatus;
  priority?: "high" | "medium" | "low";
}

/** The kinds of answer a request offers: the same as the core agent request API's. */
export type PermissionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always" | "other";

export interface PermissionOption {
  id: string;
  label: string;
  kind: PermissionKind;
}

/** A request the agent waits on: a permission (usually before running a tool), or a question. */
export interface Permission {
  id: string;
  /** A permission without one; a `question` is asked of the user, and may take words (`text`). */
  kind?: "permission" | "question";
  /** A question that takes an answer in words, beside its options or instead of them. */
  text?: boolean;
  /** The tool call it is about, when it is about one. */
  toolId?: string;
  title: string;
  /** More of what it is about: the command, the path. */
  detail?: string;
  options: PermissionOption[];
}

export type OptionCategory = "mode" | "model" | "thought_level" | "other";

export interface Choice {
  id: string;
  name: string;
  description?: string;
  /** The heading it is listed under. */
  group?: string;
}

/** A setting of the session a view may change: a choice of `choices`, or on/off when it has none. */
export interface ConfigOption {
  id: string;
  category: OptionCategory;
  name: string;
  description?: string;
  current: string | boolean;
  choices?: Choice[];
  /** thought_level: the choice that turns thinking off, which a view draws as the thinking toggle. */
  off?: string;
  /** The choice the agent uses when none was picked (its model's default level). */
  default?: string;
}

/** A slash command the agent offers. */
export interface SlashCommand {
  name: string;
  description?: string;
  /** What it takes after its name. */
  hint?: string;
  /** It opens a screen of the agent's own (a picker, a settings page) rather than answering in the chat. */
  terminal?: boolean;
}

/** How much of the context window is used, and what the session has cost. */
export interface Usage {
  /** 0 to 100. */
  contextPct?: number;
  /** The tokens in the context window now. */
  tokens?: number;
  /** The context window's size, in tokens. */
  contextSize?: number;
  cost?: { amount: number; currency: string };
}

export interface Tokens {
  input?: number;
  output?: number;
  thought?: number;
  cached?: number;
  total?: number;
}

export type StopReason = "end_turn" | "cancelled" | "max_tokens" | "max_turn_requests" | "refusal" | "error" | "other";

export interface TurnSummary {
  stop: StopReason;
  durationMs?: number;
  tokens?: Tokens;
}

/** A prompt waiting for the running turn to end. Its id is the prompt command's. */
export interface Queued {
  id: CommandId;
  text: string;
  images?: Image[];
}

/** Everything a view needs to draw the conversation. */
export interface Transcript {
  /** Changes when the producer starts again or reloads: a cursor of another epoch means a snapshot. */
  epoch: string;
  /** The batches of changes published since the epoch began (see `change.ts` `Producer`). */
  seq: number;
  session?: SessionInfo;
  status: Status;
  entries: Entry[];
  /** Requests still waiting for an answer, oldest first. */
  permissions: Permission[];
  /** The plan as it is now. */
  plan: PlanItem[];
  options: ConfigOption[];
  commands: SlashCommand[];
  usage: Usage;
  queue: Queued[];
  /** Older entries were dropped to stay in bounds. */
  truncated: boolean;
}

/** A position in a producer's stream of changes: a view that has applied up to it has this. */
export interface Cursor {
  epoch: string;
  seq: number;
}

/** A view's id for one command, kept across a resend so the producer acts on it once. */
export type CommandId = string;

/** What a view asks of the producer. */
export type Command =
  /**
   * Sends a prompt now, or queues it behind the running turn. With `replaces` (a user entry's id)
   * it is an edit of that message: the conversation goes back to before it first.
   */
  | { type: "prompt"; id: CommandId; text: string; images?: Image[]; replaces?: string }
  /** Ends the running turn. */
  | { type: "cancel"; id: CommandId }
  /** Answers a request: one of its options, or (a question that takes words) `text` with `optionId` "". */
  | { type: "answer"; id: CommandId; permissionId: string; optionId: string; text?: string }
  /** Sets the option of `category` (or the one named `option`, when a category has several). */
  | { type: "setOption"; id: CommandId; category: OptionCategory; value: string | boolean; option?: string }
  /** Withdraws a queued prompt before it goes. */
  | { type: "unqueue"; id: CommandId; queued: CommandId }
  /** Text the agent is given unseen with its next prompt (what pumi knows: `agent.turn`). */
  | { type: "context"; id: CommandId; text: string }
  /** Goes back to before the user's message `entry` (an entry id): it and what followed are left behind. */
  | { type: "rewind"; id: CommandId; entry: string }
  /**
   * A new session with the conversation up to the end of the turn the user's message `entry` began;
   * this one goes on as it was. The ack names the new session.
   */
  | { type: "fork"; id: CommandId; entry: string }
  /** Puts the files back as they were before the user's message `entry` (one with `checkpoint`). The conversation stays. */
  | { type: "restore"; id: CommandId; entry: string };

/** The producer's answer to a command: done, or why not. */
export interface Ack {
  id: CommandId;
  rejected?: string;
  /** fork: the new session's id, as the agent resumes it. */
  session?: string;
}

/** A random id, for an epoch or a command. */
export function randomId(): string {
  return randomUUID();
}

/** A command id. */
export function newCommandId(): CommandId {
  return randomId();
}

/** An empty conversation, in a new epoch unless one is given. */
export function emptyTranscript(epoch: string = randomId(), session?: SessionInfo): Transcript {
  return { epoch, seq: 0, session, status: "idle", entries: [], permissions: [], plan: [], options: [], commands: [], usage: {}, queue: [], truncated: false };
}

/** Where the transcript is in its producer's stream. */
export function cursorOf(transcript: Transcript): Cursor {
  return { epoch: transcript.epoch, seq: transcript.seq };
}

/** The entry `id`, looked for from the newest (where changes land). */
export function findEntry(transcript: Transcript, id: string): Entry | undefined {
  const at = entryIndex(transcript.entries, id);
  return at < 0 ? undefined : transcript.entries[at];
}

/** The index of entry `id`, or -1. */
export function entryIndex(entries: Entry[], id: string): number {
  for (let at = entries.length - 1; at >= 0; at--) if (entries[at]!.id === id) return at;
  return -1;
}

/** The entry of tool call `toolId`, the newest one when the id was used twice. */
export function findTool(transcript: Transcript, toolId: string): Entry | undefined {
  const { entries } = transcript;
  for (let at = entries.length - 1; at >= 0; at--) if (entries[at]!.tool?.id === toolId) return entries[at];
  return undefined;
}

/** The option of `category` (or the one named `option`). */
export function optionOf(transcript: Transcript, category: OptionCategory, option?: string): ConfigOption | undefined {
  return transcript.options.find((each) => (option ? each.id === option : each.category === category));
}

/** Whether an answer of this kind lets the tool run. */
export function allows(kind: PermissionKind): boolean {
  return kind === "allow_once" || kind === "allow_always";
}

/** The length of the text an entry holds: its own and its tool's. What `Bounds` measure. */
export function entryTextLength(entry: Entry): number {
  let n = entry.text?.length ?? 0;
  for (const part of entry.tool?.content ?? []) n += contentLength(part);
  return n;
}

function contentLength(part: ToolContent): number {
  switch (part.type) {
    case "text":
      return part.text.length;
    case "diff":
      return (part.old?.length ?? 0) + part.new.length + (part.unified?.length ?? 0);
    case "terminal":
      return part.output.length;
    case "image":
      return 0;
  }
}

/** The one line that says what a tool was called with: its command, path, URL or query. */
export function describeInput(input: unknown): string | undefined {
  for (const key of ["command", "cmd", "file_path", "path", "url", "pattern", "query", "description"]) {
    const value = input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
    if (typeof value === "string" && value !== "") return value;
    if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join(" ");
  }
  return undefined;
}
