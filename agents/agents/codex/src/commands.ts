// Codex's slash commands: its own, and the ones made of files where it reads them.
import { basename, join } from "node:path";

import { fromFile, markdown, T, builtins, type AgentSpec, type Builtin, type SlashCommand } from "../../../src/api.ts";

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

/** Codex's own commands. */
export const codexBuiltins: SlashCommand[] = builtins(CODEX);

/** The commands made of files that `spec`'s agent in `cwd` takes. */
export function codexFileCommands(spec: AgentSpec, _cwd: string | undefined, home: string): SlashCommand[] {
  const user = join(home, spec.home);
  const out: SlashCommand[] = [];
  const add = (command: SlashCommand | undefined) => command && out.push(command);
  const codexHome = process.env.CODEX_HOME || user;
  for (const file of markdown(join(codexHome, "prompts"), false)) add(fromFile(file, basename(file, ".md"), "prompts:"));
  return out;
}
