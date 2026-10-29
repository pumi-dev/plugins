// What the chat says in words, worked out apart from drawing it: which entries show, which slash
// commands a draft hints at, how a status, a turn, a tool or a count reads. `ui.tsx` draws these.
// No `import … from "pumi"` here.
import { describeInput, type ConfigOption, type Entry, type Image, type OptionCategory, type SlashCommand, type Status, type Tool, type ToolKind, type ToolStatus, type Transcript, type TurnSummary, type Usage } from "./model.ts";
import { diffStats } from "../diff/patch.ts";
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

/**
 * Where each of `tokens` is in `draft`, wherever it is: text typed against a mention leaves it a
 * mention. Longer first, none overlapping. The textarea draws the same spans as its inline nodes
 * (`inlines`), so what is sent is what shows.
 */
export function tokenSpans(draft: string, tokens: string[]): { token: string; start: number; end: number }[] {
  const spans: { token: string; start: number; end: number }[] = [];
  // Longest first, so `@a/b c` is one mention and not `@a/b` with ` c` after it.
  for (const token of [...new Set(tokens)].filter((each) => each !== "").sort((a, b) => b.length - a.length)) {
    let from = 0;
    for (let at = draft.indexOf(token, from); at !== -1; at = draft.indexOf(token, from)) {
      const end = at + token.length;
      from = at + 1;
      if (spans.some((span) => at < span.end && end > span.start)) continue;
      spans.push({ token, start: at, end });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** `draft` with a space between each of `tokens` and text typed against it, so the agent reads the mention whole. */
export function spaceTokens(draft: string, tokens: string[]): string {
  let out = draft;
  for (const span of tokenSpans(draft, tokens).reverse()) {
    const after = out[span.end];
    const before = out[span.start - 1];
    if (after !== undefined && !/\s/.test(after)) out = `${out.slice(0, span.end)} ${out.slice(span.end)}`;
    if (before !== undefined && !/\s/.test(before)) out = `${out.slice(0, span.start)} ${out.slice(span.start)}`;
  }
  return out;
}

/** `draft` without `tokens`, each with the space before it (or after, at the start). */
export function withoutTokens(draft: string, tokens: string[]): string {
  let out = draft;
  for (const span of tokenSpans(draft, tokens).reverse()) {
    const before = out.slice(0, span.start);
    const after = out.slice(span.end);
    out = before === "" || /\n$/.test(before) ? before + after.replace(/^[ \t]/, "") : before.replace(/[ \t]$/, "") + after;
  }
  return out;
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

/**
 * Whether a tool card starts open: a change to show, or a failure to read. A command's output never
 * does: while it runs it would open and close by itself, flashing the screen.
 */
export function toolOpensByDefault(tool: Tool): boolean {
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

/** An image as `<img src>`: a data URL for inline bytes, else its uri (a `file:` URL as its path). */
export function imageSource(image: Image): string | undefined {
  if (image.data) return `data:${image.mimeType};base64,${image.data}`;
  if (image.uri?.startsWith("file://")) return decodeURIComponent(image.uri.slice("file://".length));
  return image.uri;
}

/** The pictures a prompt names by their absolute path (how pi is told of an attached picture). */
export function imagePathsIn(text: string): string[] {
  const found: string[] = [];
  const quoted = /"(\/[^"\n]+?\.(?:png|jpe?g|gif|webp))"/gi;
  for (let m = quoted.exec(text); m; m = quoted.exec(text)) if (!found.includes(m[1]!)) found.push(m[1]!);
  const path = /(?:^|[\s"'(])((?:\/|file:\/\/\/)(?:[^\s"'()]|\\ )+?\.(?:png|jpe?g|gif|webp))(?=$|[\s"'),.;:])/gi;
  for (let m = path.exec(text); m; m = path.exec(text)) {
    const each = m[1]!.replace(/\\ /g, " ").replace(/^file:\/\//, "");
    if (!found.includes(each)) found.push(each);
  }
  return found;
}

/** A piece of a message as it is drawn: its text, or a chip for what it names (a file, a folder, a picture, a skill). */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "chip"; kind: "file" | "folder" | "image" | "skill"; text: string; label: string; path?: string };

/**
 * Where the chips are in a message: `@path` and `@"a path"` mentions, pictures named by their
 * absolute path (quoted or not, as pi is told of one), and skills (`/skill:name`). Each starts the
 * text or follows a space.
 */
const CHIP_AT =
  /(^|[\s(])(?:@"([^"\n]+)"|@([^\s"@]+)|"(\/[^"\n]+?\.(?:png|jpe?g|gif|webp))"|((?:\/|file:\/\/\/)(?:[^\s"'()]|\\ )+?\.(?:png|jpe?g|gif|webp))(?=$|[\s"'),.;:])|\/(skill:[\w.:-]+))/gi;

/** `text` as its plain runs and its chips, in order; a relative path is taken from `cwd`. */
export function messageParts(text: string, cwd?: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  const plain = (to: number) => {
    if (to > last) parts.push({ type: "text", text: text.slice(last, to) });
  };
  CHIP_AT.lastIndex = 0;
  for (let m = CHIP_AT.exec(text); m; m = CHIP_AT.exec(text)) {
    const start = m.index + m[1]!.length;
    let token = m[0].slice(m[1]!.length);
    let chip: MessagePart;
    if (m[6]) chip = { type: "chip", kind: "skill", text: token, label: m[6].slice("skill:".length) };
    else {
      // An unquoted mention ends before the punctuation that closes a sentence.
      const bare = m[3]?.replace(/[.,;:!?)]+$/, "");
      if (bare !== undefined) token = `@${bare}`;
      const named = m[2] ?? bare ?? m[4] ?? m[5]!.replace(/\\ /g, " ").replace(/^file:\/\//, "");
      if (named === "" || named === "/") continue;
      const dir = named.endsWith("/");
      const path = named.startsWith("/") || named.startsWith("~") || !cwd ? named : `${cwd.replace(/\/+$/, "")}/${named}`;
      chip = { type: "chip", kind: dir ? "folder" : imageTypeOf(named) ? "image" : "file", text: token, label: dir ? `${baseName(named)}/` : baseName(named), path };
    }
    plain(start);
    parts.push(chip);
    last = start + token.length;
    CHIP_AT.lastIndex = last;
  }
  plain(text.length);
  return parts;
}

/** A `/` the user is typing at the start or after a space: what follows it up to the caret, and where it starts. */
export function slashAt(draft: string, caret: number): MentionQuery | undefined {
  const match = /(^|\s)\/([^\s/]*)$/.exec(draft.slice(0, caret));
  if (!match) return undefined;
  return { start: caret - match[2]!.length - 1, end: caret, query: match[2]! };
}

/** The skills among `commands` whose name has what is typed, best first: those it starts with, then those with it anywhere. */
export function skillHints(query: string, commands: SlashCommand[], limit = 8): SlashCommand[] {
  const typed = query.toLowerCase().replace(/^skill:/, "");
  const skills = commands.filter((command) => command.skill);
  const name = (command: SlashCommand) => command.name.replace(/^\/?(skill:)?/, "").toLowerCase();
  const starts = skills.filter((command) => name(command).startsWith(typed));
  const contains = typed === "" ? [] : skills.filter((command) => !name(command).startsWith(typed) && name(command).includes(typed));
  return [...starts, ...contains].slice(0, limit);
}

/** How a skill is written in a prompt: `/skill:name`. */
export function skillToken(command: SlashCommand): string {
  const name = command.name.replace(/^\//, "");
  return `/${name.startsWith("skill:") ? name : `skill:${name}`}`;
}

/** The draft with the `/` being typed (`at`) replaced by `token` and a space, and where the caret goes. */
export function applySlash(draft: string, at: MentionQuery, token: string): { draft: string; caret: number } {
  const rest = draft.slice(at.end).replace(/^[^\s]*/, "");
  const tail = rest.startsWith(" ") ? rest.slice(1) : rest;
  const text = `${token} `;
  return { draft: draft.slice(0, at.start) + text + tail, caret: at.start + text.length };
}

// ── Diffs ─────────────────────────────────────────────────────────────────────────────────────

export { diffRows, diffStats, type DiffRow } from "../diff/patch.ts";

/** What a tool's changes add up to, over all its diffs. */
export function toolDiffStats(tool: Tool): { added: number; removed: number } | undefined {
  const diffs = tool.content.filter((part) => part.type === "diff");
  if (diffs.length === 0) return undefined;
  return diffs.reduce(
    (sum, part) => {
      const each = diffStats(patchOf(part as { path: string; old?: string; new: string; unified?: string }));
      return { added: sum.added + each.added, removed: sum.removed + each.removed };
    },
    { added: 0, removed: 0 },
  );
}

/** At most `max` lines of `text`, and how many more there were. */
export function clipLines(text: string, max: number): { text: string; more: number } {
  const lines = text.split("\n");
  if (lines.length <= max) return { text, more: 0 };
  return { text: lines.slice(0, max).join("\n"), more: lines.length - max };
}

// ── Grouping ──────────────────────────────────────────────────────────────────────────────────

/** A row of the timeline: one entry, or a run of the agent's work (its calls and thoughts) as one. */
export type TimelineRow = { type: "entry"; entry: Entry } | { type: "activity"; id: string; entries: Entry[]; live: boolean };

/** Whether an entry is the agent's work between what it says: a call (not a question) or a thought. */
function isWork(entry: Entry, isQuestion: (tool: Tool) => boolean): boolean {
  if (entry.kind === "thought") return true;
  return entry.kind === "tool" && !!entry.tool && !isQuestion(entry.tool);
}

/**
 * The timeline's rows: each run of two or more calls and thoughts in a row is one activity; the
 * last, while the agent works, is `live`. A question stands on its own, as does what is said.
 */
export function timelineRows(entries: Entry[], working: boolean, isQuestion: (tool: Tool) => boolean = () => false): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let run: Entry[] = [];
  const flush = () => {
    if (run.length === 1) rows.push({ type: "entry", entry: run[0]! });
    else if (run.length > 1) rows.push({ type: "activity", id: `activity:${run[0]!.id}`, entries: run, live: false });
    run = [];
  };
  for (const entry of entries) {
    if (isWork(entry, isQuestion)) {
      run.push(entry);
      continue;
    }
    flush();
    rows.push({ type: "entry", entry });
  }
  flush();
  const last = rows[rows.length - 1];
  if (working && last?.type === "activity") last.live = true;
  return rows;
}

/** An activity in a line: `Ran 3 commands, read 2 files, edited 1 file`. */
export function activitySummary(entries: Entry[]): string {
  const count = new Map<string, number>();
  const edited = new Set<string>();
  let thoughts = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.kind === "thought") {
      thoughts++;
      continue;
    }
    const tool = entry.tool;
    if (!tool) continue;
    if (tool.status === "failed") failed++;
    if (tool.kind === "edit" || tool.kind === "write") {
      edited.add(tool.locations?.[0]?.path ?? tool.id);
      continue;
    }
    count.set(tool.kind, (count.get(tool.kind) ?? 0) + 1);
  }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  const verbs: [string, (n: number) => string][] = [
    ["shell", (n) => `ran ${plural(n, "command", "commands")}`],
    ["read", (n) => `read ${plural(n, "file", "files")}`],
    ["search", (n) => `searched ${plural(n, "time", "times")}`],
    ["fetch", (n) => `fetched ${plural(n, "page", "pages")}`],
    ["subagent", (n) => `ran ${plural(n, "agent", "agents")}`],
    ["mcp", (n) => `used ${plural(n, "MCP tool", "MCP tools")}`],
    ["other", (n) => `used ${plural(n, "tool", "tools")}`],
  ];
  if (edited.size > 0) parts.push(`edited ${plural(edited.size, "file", "files")}`);
  for (const [kind, say] of verbs) {
    const n = count.get(kind);
    if (n) parts.push(say(n));
  }
  if (parts.length === 0) parts.push(thoughts > 1 ? `thought ${thoughts} times` : "thought");
  if (failed > 0) parts.push(`${failed} failed`);
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// ── Colour ────────────────────────────────────────────────────────────────────────────────────

export { blend, tint } from "../diff/patch.ts";

/** A model's id as a header shows it: its provider left off (`kiro/claude-opus-5.5` is `claude-opus-5.5`). */
export function shortModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return model.split("/").pop() || model;
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

/**
 * A call's line as the timeline says it: what it did, in the tense of where it is (`Ran`,
 * `Running`), and what it did it to, a command in the code font.
 */
export function toolHeadline(tool: Tool): { verb: string; target?: string; mono: boolean } {
  const running = tool.status === "running" || tool.status === "pending";
  const words: Partial<Record<ToolKind, [string, string]>> = {
    shell: ["Ran", "Running"],
    read: ["Read", "Reading"],
    edit: ["Edited", "Editing"],
    write: ["Wrote", "Writing"],
    search: ["Searched", "Searching"],
    fetch: ["Fetched", "Fetching"],
  };
  const pair = words[tool.kind];
  const { title, detail } = toolLine(tool);
  const path = tool.locations?.[0]?.path;
  if (pair) {
    const target = tool.kind === "shell" ? (describeInput(tool.input) ?? detail ?? title) : (path ?? detail ?? (title.toLowerCase() === tool.kind ? undefined : title));
    return { verb: pair[running ? 1 : 0], target: target?.split("\n")[0], mono: tool.kind === "shell" || tool.kind === "search" };
  }
  if (tool.kind === "subagent") return { verb: running ? "Agent working" : "Agent", target: detail ?? title, mono: false };
  return { verb: title, target: detail?.split("\n")[0], mono: false };
}

// ── Zed's bar ────────────────────────────────────────────────────────────────────────────────

/** A thought level as Zed's thinking control has it: whether it toggles, whether it is on, its effort levels. */
export interface ThinkingState {
  /** It has a choice that turns thinking off: the bulb is a toggle. */
  toggles: boolean;
  on: boolean;
  /** The level in use (none while off). */
  level?: string;
  /** The choices that are levels, in order (not the off one). */
  levels: { id: string; name: string; description?: string }[];
  /** The level the model uses when none was picked. */
  fallback?: string;
}

export function thinkingOf(option: ConfigOption): ThinkingState {
  const levels = (option.choices ?? []).filter((choice) => choice.id !== option.off);
  const current = typeof option.current === "string" ? option.current : undefined;
  const on = option.off === undefined || current !== option.off;
  return { toggles: option.off !== undefined, on, ...(on && current ? { level: current } : {}), levels, ...(option.default ? { fallback: option.default } : {}) };
}

/**
 * Zed's context ring as an SVG's markup, 16 across: a 2-wide stroke around a circle of radius 6,
 * filled clockwise from the top for `ratio` of it (a whole circle from 0.999). Nothing for 0.
 */
export function ringArc(ratio: number): string | undefined {
  const r = Math.max(0, Math.min(1, ratio));
  if (r <= 0) return undefined;
  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none">';
  if (r >= 0.999) return `${open}<circle cx="8" cy="8" r="6" stroke="black" stroke-width="2"/></svg>`;
  const angle = r * 2 * Math.PI;
  const x = (8 + 6 * Math.sin(angle)).toFixed(3);
  const y = (8 - 6 * Math.cos(angle)).toFixed(3);
  return `${open}<path d="M8 2A6 6 0 ${r > 0.5 ? 1 : 0} 1 ${x} ${y}" stroke="black" stroke-width="2" stroke-linecap="butt"/></svg>`;
}

/** The ring's tooltip, as Zed's: `Context: 42% • 84k/200k`. */
export function contextTooltip(usage: Usage): string {
  const pct = usage.contextPct ?? (usage.tokens !== undefined && usage.contextSize ? Math.round((usage.tokens / usage.contextSize) * 100) : undefined);
  const parts = [pct !== undefined ? `${pct}%` : undefined, usage.tokens !== undefined ? (usage.contextSize ? `${formatCount(usage.tokens)}/${formatCount(usage.contextSize)}` : `${formatCount(usage.tokens)} tokens`) : undefined].filter(Boolean);
  const cost = usage.cost ? ` · ${usage.cost.currency === "USD" ? "$" : ""}${usage.cost.amount.toFixed(2)}${usage.cost.currency === "USD" ? "" : ` ${usage.cost.currency}`}` : "";
  return `Context: ${parts.join(" • ")}${cost}`;
}

/** The maker of a model, by its id (`anthropic/claude-…`, `gpt-5`), for the model selector's mark. */
export function modelMaker(model: string | undefined, agent?: string): "claude" | "openai" | "anthropic" | "gemini" | "deepseek" | "openrouter" | "google" | "mistral" | "xai" | "ollama" | undefined {
  const id = (model ?? "").toLowerCase();
  const provider = id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
  if (provider === "ollama") return "ollama";
  if (/deepseek/.test(id)) return "deepseek";
  if (/gemini/.test(id)) return "gemini";
  if (/grok|xai/.test(id)) return "xai";
  if (/mistral|codestral/.test(id)) return "mistral";
  if (/gpt|^o\d|codex|openai/.test(id)) return "openai";
  if (/claude|opus|sonnet|haiku|anthropic/.test(id)) return provider === "anthropic" ? "anthropic" : "claude";
  if (provider === "openrouter" || id.startsWith("~")) return "openrouter";
  if (provider === "google") return "google";
  const who = (agent ?? "").toLowerCase();
  if (who.includes("claude")) return "claude";
  if (who.includes("codex")) return "openai";
  return undefined;
}

/**
 * Whether the files can be put back as they were before the user's message at `at`: its producer
 * keeps a checkpoint of it, and something after it changed a file.
 */
export function restorable(entries: Entry[], at: number): boolean {
  const entry = entries[at];
  if (entry?.kind !== "user" || entry.checkpoint !== true) return false;
  for (let i = at + 1; i < entries.length; i++) {
    const tool = entries[i]!.tool;
    if (tool && (tool.kind === "edit" || tool.kind === "write") && tool.status !== "failed") return true;
  }
  return false;
}
