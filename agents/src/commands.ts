// The slash commands an agent's TUI takes, for the chat's `/` list: its own, and the ones made of
// files (Claude's commands and skills, Codex's prompts, pi's prompt templates and skills), read
// from where each agent reads them. A command the chat cannot show the answer to (a picker, a
// settings screen) is `terminal`, and sending it shows the terminal. No `import … from "pumi"` here.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { SlashCommand } from "./conversation/model.ts";
import type { AgentSpec, Format } from "./agents.ts";

type Builtin = [name: string, description: string, extra?: { hint?: string; terminal?: boolean }];
const T = { terminal: true };

const CLAUDE: Builtin[] = [
  ["clear", "Clear the conversation and start again"],
  ["compact", "Free up context by summarizing the conversation so far", { hint: "[instructions]" }],
  ["model", "Set the model", { hint: "[model]", ...T }],
  ["effort", "Set effort level for model usage", { hint: "[level]" }],
  ["context", "Show the current context usage", T],
  ["usage", "Show plan usage limits", T],
  ["cost", "Show the cost and duration of this session", T],
  ["init", "Write a CLAUDE.md with what to know about this codebase"],
  ["review", "Review a pull request"],
  ["security-review", "Complete a security review of the pending changes on the current branch"],
  ["plan", "Enable plan mode or view the current session plan"],
  ["resume", "Resume a previous conversation", T],
  ["rewind", "Go back to an earlier point in the conversation", T],
  ["export", "Export the conversation to a file or the clipboard", T],
  ["copy", "Copy Claude's last response to the clipboard"],
  ["add-dir", "Add a new working directory", { hint: "<path>" }],
  ["memory", "Edit CLAUDE.md files and memory settings", T],
  ["config", "Open settings", T],
  ["permissions", "Manage which tools are allowed", T],
  ["mcp", "Manage MCP servers", T],
  ["agents", "Manage subagents", T],
  ["hooks", "View hook configurations for tool events", T],
  ["skills", "List available skills", T],
  ["plugin", "Manage plugins", T],
  ["status", "Show the version, model, account and connectivity", T],
  ["doctor", "Check the installation", T],
  ["help", "Show help and available commands", T],
  ["login", "Sign in to your Anthropic account", T],
  ["logout", "Sign out from your Anthropic account", T],
  ["exit", "Exit Claude Code"],
];

const CODEX: Builtin[] = [
  ["model", "Choose what model and reasoning effort to use", T],
  ["permissions", "Choose what Codex is allowed to do", T],
  ["review", "Review my current changes and find issues"],
  ["new", "Start a new chat during a conversation"],
  ["resume", "Resume a saved chat", T],
  ["fork", "Fork the current chat", T],
  ["rename", "Rename the current thread", { hint: "<name>" }],
  ["init", "Create an AGENTS.md file with instructions for Codex"],
  ["compact", "Summarize conversation to prevent hitting the context limit"],
  ["plan", "Switch to Plan mode"],
  ["goal", "Set or view the goal for a long-running task", { hint: "[goal]" }],
  ["diff", "Show git diff (including untracked files)", T],
  ["status", "Show current session configuration and token usage", T],
  ["mcp", "List configured MCP tools", T],
  ["skills", "Use skills to improve how Codex performs specific tasks", T],
  ["copy", "Copy the last response"],
  ["logout", "Log out of Codex"],
  ["quit", "Exit Codex"],
];

const PI: Builtin[] = [
  ["model", "Select a model", { hint: "[provider/model]", ...T }],
  ["thinking", "Set the thinking level", { hint: "[level]", ...T }],
  ["settings", "Open settings", T],
  ["scoped-models", "Configure the models used by interactive cycling", T],
  ["new", "Start a new session"],
  ["resume", "Switch to another saved session", T],
  ["name", "Set the session display name", { hint: "[name]" }],
  ["session", "Show current session information and statistics", T],
  ["tree", "Navigate the session tree", T],
  ["fork", "Create a new session from an earlier user message", T],
  ["clone", "Duplicate the current session at its current position"],
  ["compact", "Compact the current context", { hint: "[instructions]" }],
  ["copy", "Copy the last assistant message"],
  ["export", "Export the session as HTML or JSONL", { hint: "[path]" }],
  ["share", "Upload the session and return a viewer link", T],
  ["reload", "Reload keybindings, extensions, skills, templates, themes, and context files"],
  ["hotkeys", "Show active keyboard shortcuts", T],
  ["login", "Add provider authentication", { hint: "[provider]", ...T }],
  ["logout", "Remove provider authentication", T],
  ["quit", "Quit pi"],
];

const BUILTIN: Record<Format, Builtin[]> = { claude: CLAUDE, codex: CODEX, pi: PI };

/** The agent's own commands. */
export function builtinCommands(format: Format): SlashCommand[] {
  return BUILTIN[format].map(([name, description, extra]) => ({ name, description, ...(extra?.hint ? { hint: extra.hint } : {}), ...(extra?.terminal ? { terminal: true } : {}) }));
}

// ── Commands made of files ───────────────────────────────────────────────────────────────────

/** A markdown file's front matter (`key: value` lines between `---`), and the body after it. */
export function frontMatter(source: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { fields: {}, body: source };
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (field) fields[field[1]!.toLowerCase()] = field[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { fields, body: source.slice(match[0].length) };
}

/** What a file's command says it does: its `description`, else its first line of text. */
function described(fields: Record<string, string>, body: string): string | undefined {
  if (fields.description) return fields.description;
  const first = body.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find((line) => line !== "");
  return first ? first.slice(0, 200) : undefined;
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").slice(0, 16_384);
  } catch {
    return undefined;
  }
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The `.md` files in `dir`, and in its directories too when `deep`. */
function markdown(dir: string, deep: boolean, depth = 0): string[] {
  const out: string[] = [];
  for (const name of names(dir)) {
    const path = join(dir, name);
    if (name.endsWith(".md") && !isDir(path)) out.push(path);
    else if (deep && depth < 4 && !name.startsWith(".") && isDir(path)) out.push(...markdown(path, deep, depth + 1));
  }
  return out;
}

/** The skills in `dir`: each directory with a `SKILL.md`, there or deeper when `deep`. */
function skills(dir: string, deep: boolean, depth = 0): string[] {
  const out: string[] = [];
  for (const name of names(dir)) {
    const path = join(dir, name);
    if (!isDir(path) || name.startsWith(".")) continue;
    if (existsSync(join(path, "SKILL.md"))) out.push(join(path, "SKILL.md"));
    else if (deep && depth < 4) out.push(...skills(path, deep, depth + 1));
  }
  return out;
}

/** A command file as a command named `prefix + name`; `undefined` when it says it is not one. */
function fromFile(path: string, name: string, prefix = ""): SlashCommand | undefined {
  const source = read(path);
  if (source === undefined) return undefined;
  const { fields, body } = frontMatter(source);
  if (fields["user-invocable"] === "false") return undefined;
  const description = described(fields, body);
  const hint = fields["argument-hint"];
  return { name: `${prefix}${fields.name && path.endsWith("SKILL.md") ? fields.name : name}`, ...(description ? { description } : {}), ...(hint ? { hint } : {}) };
}

/**
 * The directories a project's own commands are looked for in: `cwd` and those above it, up to the
 * repository's root (the one with `.git`), and never the home directory itself.
 */
export function projectDirs(cwd: string | undefined, home: string): string[] {
  if (!cwd) return [];
  const out: string[] = [];
  for (let at = cwd; ; at = dirname(at)) {
    if (at === home) break;
    out.push(at);
    if (existsSync(join(at, ".git")) || dirname(at) === at) break;
  }
  return out;
}

/** The commands made of files that `spec`'s agent in `cwd` takes. */
export function fileCommands(spec: AgentSpec, cwd: string | undefined, home: string = homedir()): SlashCommand[] {
  const user = join(home, spec.home);
  const projects = projectDirs(cwd, home);
  const out: SlashCommand[] = [];
  const add = (command: SlashCommand | undefined) => command && out.push(command);
  switch (spec.format) {
    case "claude": {
      for (const root of [...projects.map((dir) => join(dir, ".claude")), user]) {
        for (const file of markdown(join(root, "commands"), true)) add(fromFile(file, basename(file, ".md")));
        for (const file of skills(join(root, "skills"), false)) add(fromFile(file, basename(dirname(file))));
      }
      break;
    }
    case "codex": {
      const codexHome = process.env.CODEX_HOME || user;
      for (const file of markdown(join(codexHome, "prompts"), false)) add(fromFile(file, basename(file, ".md"), "prompts:"));
      break;
    }
    case "pi": {
      const local = spec.id === "omp" ? ".omp" : ".pi";
      for (const root of [...projects.slice(0, 1).map((dir) => join(dir, local)), user]) {
        for (const file of markdown(join(root, "prompts"), false)) add(fromFile(file, basename(file, ".md")));
      }
      for (const root of [...projects.slice(0, 1).map((dir) => join(dir, local)), user, ...projects.map((dir) => join(dir, ".agents")), join(home, ".agents")]) {
        for (const file of skills(join(root, "skills"), true)) add(fromFile(file, basename(dirname(file)), "skill:"));
      }
      break;
    }
  }
  return out;
}

/** Every command `spec`'s agent in `cwd` takes: those made of files first, then its own; one per name. */
export function commandsFor(spec: AgentSpec, cwd: string | undefined, home: string = homedir()): SlashCommand[] {
  const seen = new Set<string>();
  const out: SlashCommand[] = [];
  for (const command of [...fileCommands(spec, cwd, home), ...builtinCommands(spec.format)]) {
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    out.push(command);
  }
  return out;
}

/** The command a prompt is, when it is one with nothing after its name: `/model` is, `/model x` is not. */
export function bareCommand(text: string, commands: SlashCommand[]): SlashCommand | undefined {
  const match = /^\/(\S+)$/.exec(text.trim());
  return match ? commands.find((command) => command.name.replace(/^\//, "") === match[1]) : undefined;
}
