// What every session-file parser shares: the shape a parser has, a tool's kind and title by the
// agent's name for it, and the small readers of untyped JSON. No `import … from "pumi"` here.
import type { Change, Stamp } from "../conversation/change.ts";
import { findTool, type Entry, type Image, type Tool, type ToolContent, type ToolKind, type Transcript } from "../conversation/model.ts";

/** One parsed line of a session file, or an object in one. */
export type Rec = Record<string, unknown>;

/** `value` when it is an object (not an array). */
export function obj(value: unknown): Rec | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : undefined;
}

/** `value`'s objects, when it is an array. */
export function objs(value: unknown): Rec[] {
  if (!Array.isArray(value)) return [];
  const out: Rec[] = [];
  for (const each of value) {
    const found = obj(each);
    if (found) out.push(found);
  }
  return out;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Reads one agent's session file, a line at a time, as the conversation's changes. A parser keeps
 * what it needs between lines (pi's branch, a running cost); the transcript it is given is the
 * producer's as it is now, so a tool's result finds the call it answers.
 */
export interface Parser {
  /** On a first read: the records that are the conversation now (pi: the branch its last record is on). */
  select?(records: Rec[]): Rec[];
  /** Whether a record read later goes on from what was read; `false`: read the file again. */
  continues?(record: Rec): boolean;
  /** The changes the record says. */
  record(record: Rec, t: Transcript, stamp: Stamp): Change[];
}

/** Each line as JSON; one that is not (cut, or not JSON) is left out. */
export function records(lines: string[]): Rec[] {
  const out: Rec[] = [];
  for (const line of lines) {
    try {
      const value = obj(JSON.parse(line));
      if (value) out.push(value);
    } catch {
      // A line the agent is still writing, or one that is not ours to read.
      continue;
    }
  }
  return out;
}

/** A time in a record (an ISO string, or ms), else now. */
export function timeOf(value: unknown, stamp: Stamp): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return stamp.now();
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A tool's kind, by the name the agent gives it (Claude's `Bash`, Codex's `exec_command`, pi's `bash`). */
export function toolKind(name: string): ToolKind {
  if (name.startsWith("mcp__") || name === "mcp") return "mcp";
  switch (name.toLowerCase()) {
    case "bash":
    case "bashoutput":
    case "killshell":
    case "shell":
    case "exec":
    case "exec_command":
    case "local_shell":
    case "write_stdin":
      return "shell";
    case "read":
    case "notebookread":
    case "view_image":
      return "read";
    case "edit":
    case "multiedit":
    case "notebookedit":
    case "apply_patch":
      return "edit";
    case "write":
      return "write";
    case "grep":
    case "glob":
    case "ls":
    case "find":
    case "search":
    case "tool_search":
      return "search";
    case "webfetch":
    case "websearch":
    case "fetch":
    case "fetch_content":
    case "web_search":
      return "fetch";
    case "task":
    case "agent":
    case "spawn_agent":
    case "subagent":
      return "subagent";
    default:
      return "other";
  }
}

/** A tool's title: its name, an MCP tool's as `server: tool`. */
export function toolTitle(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return mcp ? `${mcp[1]}: ${mcp[2]}` : name;
}

/** A new tool entry, running. */
export function toolPush(id: string, name: string, input: unknown, content: ToolContent[], at: number, stamp: Stamp): Extract<Change, { type: "push" }> {
  const tool: Tool = { id, kind: toolKind(name), title: toolTitle(name), status: "running", input, content };
  const args = obj(input);
  const path = args ? (str(args.file_path) ?? str(args.path)) : undefined;
  if (path) tool.locations = [{ path }];
  return { type: "push", entry: { id: stamp.id(), kind: "tool", at, tool } };
}

/**
 * A tool's result: the call's entry patched with its status and what it gave (a shell's output as
 * a terminal's, the content a call already shows kept when the result adds none). Nothing when the
 * call is not in the transcript (it was before the part of the file that was read).
 */
export function toolResult(t: Transcript, toolId: string, failed: boolean, output: ToolContent[]): Change[] {
  const entry: Entry | undefined = findTool(t, toolId);
  if (!entry?.tool) return [];
  const shell = entry.tool.kind === "shell";
  const shown = output.map((part): ToolContent => (shell && part.type === "text" ? { type: "terminal", output: part.text } : part));
  const kept = shown.some((part) => part.type === "diff") ? [] : entry.tool.content.filter((part) => part.type === "diff");
  const content = shown.length === 0 ? entry.tool.content : [...kept, ...shown];
  return [{ type: "tool", id: entry.id, patch: { status: failed ? "failed" : "completed", content } }];
}

/** Text and images of a result's content: a string, or blocks of `text` and `image`. */
export function resultContent(content: unknown): ToolContent[] {
  if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  const out: ToolContent[] = [];
  const texts: string[] = [];
  for (const block of objs(content)) {
    const text = str(block.text);
    if (text && (block.type === "text" || block.type === "input_text" || block.type === "output_text")) texts.push(text);
    const image = imageOf(block);
    if (image) out.push({ type: "image", image });
  }
  return texts.length > 0 ? [{ type: "text", text: texts.join("\n") }, ...out] : out;
}

/** An image block, as Claude (`source: {type: base64, media_type, data}`), pi (`data`, `mimeType`) and Codex (`image_url`) write one. */
export function imageOf(block: Rec): Image | undefined {
  const source = obj(block.source);
  if (block.type === "image" && source) {
    const mimeType = str(source.media_type) ?? "image/png";
    const data = source.type === "base64" ? str(source.data) : undefined;
    if (data) return { mimeType, data };
    const uri = str(source.url);
    if (uri) return { mimeType, uri };
  }
  const data = block.type === "image" ? str(block.data) : undefined;
  if (data) return { mimeType: str(block.mimeType) ?? "image/png", data };
  const uri = block.type === "input_image" ? str(block.image_url) : undefined;
  if (uri) return { mimeType: "image/png", uri };
  return undefined;
}

/** `text` with terminal colour codes taken out. */
export function plain(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape is what is taken out
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** A skill's instructions as pi (and the chat's host) put them in a prompt, with the blank line after. */
const SKILL_BLOCK = /<skill name="([^"]+)" location="[^"\n]*">\n[\s\S]*?\n<\/skill>(?:\n\n|$)/g;

/**
 * A prompt as its writer typed it: each skill's instructions put in for it taken out, and the
 * skill named where it was (`/skill:name`), or first when the text does not name it.
 */
export function collapseSkills(text: string): string {
  if (!text.includes("<skill name=")) return text;
  const names: string[] = [];
  const rest = text.replace(SKILL_BLOCK, (_, name: string) => {
    names.push(name);
    return "";
  });
  if (names.length === 0) return text;
  const named = (name: string) => rest.split(/\s+/).includes(`/skill:${name}`);
  return [...names.filter((name) => !named(name)).map((name) => `/skill:${name}`), rest.trim()].filter((part) => part !== "").join(" ");
}
