// The agents the chat knows: which `@agent` ids it bridges, what each is called, which parser reads
// its session file, and the keys its TUI takes. No `import … from "pumi"` here.
import type { Status } from "../../lib/conversation/src/model.ts";

export type Format = "claude" | "codex" | "pi";

export interface AgentSpec {
  /** The `@agent` id its hook sets. */
  id: string;
  /** What the chat calls it. */
  label: string;
  /** How its session file is written. */
  format: Format;
  /** What ends its running turn when typed into its terminal. */
  cancel: string;
  /**
   * How a picture goes in: `paste`, its path pasted alone (the TUI attaches a pasted image path,
   * as it does a dragged one), or `text`, its path in the prompt for the agent to read.
   */
  images: "paste" | "text";
  /** Where its own settings, commands and skills are, from the home directory. */
  home: string;
}

export const AGENTS: Record<string, AgentSpec> = {
  claude: { id: "claude", label: "Claude Code", format: "claude", cancel: "\x1b", images: "paste", home: ".claude" },
  codex: { id: "codex", label: "Codex", format: "codex", cancel: "\x1b", images: "paste", home: ".codex" },
  pi: { id: "pi", label: "pi", format: "pi", cancel: "\x1b", images: "text", home: ".pi/agent" },
  omp: { id: "omp", label: "omp", format: "pi", cancel: "\x1b", images: "text", home: ".omp/agent" },
};

/** The agent a pane's `@agent` names, when the chat can bridge it. */
export function agentSpec(agent: unknown): AgentSpec | undefined {
  return typeof agent === "string" ? AGENTS[agent] : undefined;
}

/** `@agent_status` as the conversation has it: the hooks say `idle`, `working`, `blocked`, `done`. */
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
