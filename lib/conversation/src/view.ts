// What the chat says in words, worked out apart from drawing it: which entries show, which slash
// commands a draft hints at, how a status, a turn, a tool or a count reads. `ui.tsx` draws these.
// No `import … from "pumi"` here.
import { describeInput, type ConfigOption, type Entry, type Image, type OptionCategory, type SlashCommand, type Status, type Tool, type ToolKind, type ToolStatus, type Transcript, type TurnSummary, type Usage } from "./model.ts";
import { unifiedDiff } from "./diff.ts";

/** The newest `count` entries, and how many are left out before them. */
export function visibleEntries(entries: Entry[], count: number): { shown: Entry[]; hidden: number } {
  const hidden = Math.max(0, entries.length - Math.max(0, count));
  return { shown: entries.slice(hidden), hidden };
}

/**
 * The commands a draft is asking for: while it is `/` and a name with no space after it, those
 * whose name starts with what is typed (the name without its own `/`), best first.
 */
export function slashHints(draft: string, commands: SlashCommand[], limit = 8): SlashCommand[] {
  const match = /^\/(\S*)$/.exec(draft);
  if (!match) return [];
  const typed = match[1]!.toLowerCase();
  const name = (command: SlashCommand) => command.name.replace(/^\//, "").toLowerCase();
  const starts = commands.filter((command) => name(command).startsWith(typed));
  const contains = typed === "" ? [] : commands.filter((command) => !name(command).startsWith(typed) && name(command).includes(typed));
  return [...starts, ...contains].slice(0, limit);
}

/** The draft once hint `command` is picked: its name and a space, ready for what it takes. */
export function applyHint(command: SlashCommand): string {
  return `/${command.name.replace(/^\//, "")} `;
}

// ── The composer's draft ──────────────────────────────────────────────────────────────────────

/**
 * Where the caret is after the draft went from `before` to `after`: the end of what was typed or
 * pasted (or where what was deleted was). The textarea does not say where its caret is, but an
 * edit is made at the caret, so the edit shows it.
 */
export function caretAfterEdit(before: string, after: string): number {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start++;
  let end = 0;
  while (end < shortest - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return after.length - end;
}

/** A file the user may mention: its path as the draft writes it, and whether it is a directory. */
export interface MentionHit {
  path: string;
  dir?: boolean;
}

/** An `@` the user is typing: what follows it up to the caret, and where it starts. */
export interface MentionQuery {
  /** Where the `@` is. */
  start: number;
  /** Where it ends: the caret. */
  end: number;
  /** What is typed after the `@` (without a quote it opens). */
  query: string;
}

/** The `@mention` the caret is at the end of, if it is at one: `@` at the start or after a space. */
export function mentionAt(draft: string, caret: number): MentionQuery | undefined {
  const before = draft.slice(0, caret);
  const match = /(^|\s)@("[^"\n]*|[^\s@"]*)$/.exec(before);
  if (!match) return undefined;
  const start = caret - match[2]!.length - 1;
  return { start, end: caret, query: match[2]!.replace(/^"/, "") };
}

/** A path as a mention: `@path`, quoted when it has a space. */
export function mentionText(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/**
 * The draft with `at` replaced by a mention of `hit`, and where the caret goes: after a space, or
 * right after a directory's `/` so the next part can be typed.
 */
export function applyMention(draft: string, at: MentionQuery, hit: MentionHit): { draft: string; caret: number } {
  const path = hit.dir && !hit.path.endsWith("/") ? `${hit.path}/` : hit.path;
  const text = mentionText(path) + (hit.dir ? "" : " ");
  const rest = draft.slice(at.end).replace(/^[^\s]*/, "");
  const tail = !hit.dir && rest.startsWith(" ") ? rest.slice(1) : rest;
  return { draft: draft.slice(0, at.start) + text + tail, caret: at.start + text.length };
}

/** Mentions of `paths` put into the draft at `caret`, spaced from what is around them. */
export function insertMentions(draft: string, caret: number, paths: string[]): { draft: string; caret: number } {
  if (paths.length === 0) return { draft, caret };
  const before = draft.slice(0, caret);
  const after = draft.slice(caret);
  const lead = before === "" || /\s$/.test(before) ? "" : " ";
  const text = lead + paths.map(mentionText).join(" ") + (after === "" || !/^\s/.test(after) ? " " : "");
  return { draft: before + text + after, caret: before.length + text.length };
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The image type of a path, by its extension, when it is a picture an agent takes. */
export function imageTypeOf(path: string): string | undefined {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext ? IMAGE_TYPES[ext] : undefined;
}

/** The last part of a path. */
export function baseName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

/** `path` as the agent in `cwd` names it: from `cwd` when it is under it, else whole. */
export function relativeTo(cwd: string, path: string): string {
  const root = cwd.replace(/\/+$/, "");
  return root !== "" && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

export function statusLabel(status: Status): string {
  switch (status) {
    case "idle":
      return "Ready";
    case "working":
      return "Working";
    case "blocked":
      return "Waiting for you";
    case "done":
      return "Done";
    case "error":
      return "Failed";
  }
}

/** The app's icon for a tool call's state. */
export function toolStatusIcon(status: ToolStatus): string {
  switch (status) {
    case "pending":
      return "status_dot";
    case "running":
      return "status_spinner";
    case "completed":
      return "status_check";
    case "failed":
      return "status_x";
    case "canceled":
      return "dash";
  }
}

/** The app's icon for a kind of tool. */
export function toolKindIcon(kind: ToolKind): string {
  switch (kind) {
    case "shell":
      return "terminal";
    case "read":
      return "folder_open";
    case "edit":
      return "code";
    case "write":
      return "plus";
    case "search":
      return "magnifying_glass";
    case "fetch":
      return "tool_web";
    case "subagent":
      return "sparkle";
    case "mcp":
      return "puzzle";
    case "other":
      return "blocks";
  }
}

/** The one line a tool card shows when folded: its title, and what it was called with if that adds. */
export function toolLine(tool: Tool): { title: string; detail?: string } {
  const detail = describeInput(tool.input) ?? tool.locations?.[0]?.path;
  if (!detail || tool.title.includes(detail)) return { title: tool.title };
  return { title: tool.title, detail };
}

/** Whether a tool card starts open: a change to show, or a failure to read. */
export function toolOpensByDefault(tool: Tool): boolean {
  if (tool.status === "running" && tool.content.some((part) => part.type === "terminal" && part.output !== "")) return true;
  return tool.status === "failed" || tool.content.some((part) => part.type === "diff");
}

/** The most lines of a running command's output shown: its end, as it comes. */
export const LIVE_LINES = 16;

/** What a command's output shows: all of it once it ended, its last `LIVE_LINES` lines while it runs. */
export function outputShown(output: string, running: boolean): string {
  if (!running) return output;
  const lines = output.replace(/\n+$/, "").split("\n");
  return lines.length <= LIVE_LINES ? lines.join("\n") : lines.slice(-LIVE_LINES).join("\n");
}

/** The patch a diff part draws: its own, or one made from its texts. */
export function patchOf(part: { path: string; old?: string; new: string; unified?: string }): string {
  return part.unified ?? unifiedDiff(part.path, part.old, part.new);
}

/** An image as `<img src>`: a data URL for inline bytes, else its uri. */
export function imageSource(image: Image): string | undefined {
  if (image.data) return `data:${image.mimeType};base64,${image.data}`;
  return image.uri;
}

/** A token count as people read it: 950, 12.3k, 1.2M. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim(n / 1000)}k`;
  return `${trim(n / 1_000_000)}M`;
}

function trim(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");
}

/** A duration: 800ms, 12s, 3m 4s, 1h 2m. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** How a turn ended, in a line: `Done in 12s · 3.4k tokens`. */
export function turnLine(turn: TurnSummary): string {
  const how: Record<TurnSummary["stop"], string> = {
    end_turn: "Done",
    cancelled: "Stopped",
    max_tokens: "Hit the output limit",
    max_turn_requests: "Hit the turn limit",
    refusal: "Refused",
    error: "Failed",
    other: "Ended",
  };
  const parts = [turn.durationMs !== undefined ? `${how[turn.stop]} in ${formatDuration(turn.durationMs)}` : how[turn.stop]];
  if (turn.tokens?.total) parts.push(`${formatCount(turn.tokens.total)} tokens`);
  return parts.join(" · ");
}

/** The context used, in a line: `42% · 84k of 200k`, or "" when nothing is known. */
export function usageLine(usage: Usage): string {
  const parts: string[] = [];
  if (usage.contextPct !== undefined) parts.push(`${usage.contextPct}%`);
  if (usage.tokens !== undefined) parts.push(usage.contextSize ? `${formatCount(usage.tokens)} of ${formatCount(usage.contextSize)}` : `${formatCount(usage.tokens)} tokens`);
  if (usage.cost) parts.push(`${usage.cost.amount.toFixed(2)} ${usage.cost.currency}`);
  return parts.join(" · ");
}

/** The options a header offers, in its order: mode, model, thought level, then the rest. */
export function headerOptions(t: Transcript): ConfigOption[] {
  const order: OptionCategory[] = ["mode", "model", "thought_level", "other"];
  return [...t.options].filter((option) => option.choices?.length || typeof option.current === "boolean").sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
}

/** The name of an option's current value. */
export function currentName(option: ConfigOption): string {
  if (typeof option.current === "boolean") return option.current ? "On" : "Off";
  return option.choices?.find((choice) => choice.id === option.current)?.name ?? option.current;
}

/** What the header names the conversation by: its title, else its agent. */
export function conversationTitle(t: Transcript): string {
  return t.session?.title || t.session?.agent || "Agent";
}
