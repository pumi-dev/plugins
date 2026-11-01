// The agents the chat over a terminal reads: which agent ids (the trait's, `names.ts` `AGENT`) it
// bridges, as their sub-plugins say (`registry.ts`), and how a prompt is typed into a TUI. No
// `import … from "pumi"` here.
import type { Status } from "./conversation/model.ts";
import { agentDef, hasFormat, type ChatDef } from "./registry.ts";

/** The format an agent's session files are in: one a sub-plugin's code reads (`registry.ts`). */
export type Format = string;

/** An agent the chat over its terminal reads: its `chat` (`registry.ts` `ChatDef`), its id and its label. */
export interface AgentSpec extends ChatDef {
  /** The agent's id, as its hook sets the trait. */
  id: string;
  /** What the chat calls it. */
  label: string;
}

/** The agent a tab's trait names, when the chat can bridge it: its sub-plugin says how, and one that is on reads its format. */
export function agentSpec(agent: unknown): AgentSpec | undefined {
  const def = agentDef(agent);
  if (!def?.chat || !hasFormat(def.chat.format)) return undefined;
  return { ...def.chat, id: def.id, label: def.label ?? def.title };
}

/** `@status` as the conversation has it: the hooks say `idle`, `working`, `blocked`, `done`; `unknown` is `idle`. */
export function statusOf(value: unknown): Status {
  switch (value) {
    case "working":
    case "blocked":
    case "done":
    case "error":
      return value;
    default:
      return "idle";
  }
}

/** Whether a prompt typed now goes to the agent, rather than waiting for its turn to end. */
export function takesPrompt(status: Status): boolean {
  return status === "idle" || status === "done" || status === "error";
}

/**
 * The writes that put `text` into the agent's prompt and submit it: a slash command on one line
 * is typed (a TUI opens its command palette for typed keys, not pasted ones), anything else goes
 * as a bracketed paste. Enter is a write of its own, after a pause (a TUI can swallow an Enter that
 * arrives with the paste).
 */
export function promptWrites(text: string): { body: { text: string } | { paste: string }; submit: { text: string } } {
  const command = /^\/\S/.test(text) && !text.includes("\n");
  return { body: command ? { text } : { paste: text }, submit: { text: "\r" } };
}

/** A path as a prompt names it: quoted when it has a space. */
function quoted(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/** A path as a terminal pastes a dragged file: its spaces and shell characters escaped. */
function escaped(path: string): string {
  return path.replace(/([\s'"\\()&;|<>$`!*?[\]{}#~])/g, "\\$1");
}

/**
 * What goes into the terminal for a prompt with pictures, in order: for an agent that attaches a
 * pasted image path, each path pasted alone, then the text; for one that does not, the paths in
 * the text. The writes of the text are `promptWrites`'s.
 */
export function promptParts(spec: AgentSpec, text: string, images: string[]): { pastes: string[]; text: string } {
  if (images.length === 0) return { pastes: [], text };
  if (spec.images === "paste") return { pastes: images.map(escaped), text: text === "" ? "" : ` ${text}` };
  return { pastes: [], text: [...images.map(quoted), text].filter((part) => part !== "").join(" ") };
}

/** Where this plugin's own extension goes for an agent of the `command` kind, from the home directory. */
export function extensionFile(spec: AgentSpec): string {
  return `${spec.home}/extensions/pumi-chat.ts`;
}

/** The version line of this plugin's extension (`pi/pumi-chat.ts`), which a copy must have to be current. */
export const EXTENSION_MARK = "// pumi-chat v1";

/** Whether an installed copy of the extension is the one this plugin ships. */
export function extensionCurrent(installed: string | undefined, shipped: string): boolean {
  return typeof installed === "string" && installed.includes(EXTENSION_MARK) && installed === shipped;
}

/** The writes that go back to before entry `source`, for an agent of the `command` kind. */
export function rewindCommand(source: string): string {
  return `/pumi-rewind ${source}`;
}
