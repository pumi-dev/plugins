// Claude Code's slash commands: its own, and the ones made of files where it reads them.
import { basename, dirname, join } from "node:path";

import { fromFile, markdown, projectDirs, skills, T, builtins, type AgentSpec, type Builtin, type SlashCommand } from "../../../src/api.ts";

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

/** Claude Code's own commands. */
export const claudeBuiltins: SlashCommand[] = builtins(CLAUDE);

/** The commands made of files that `spec`'s agent in `cwd` takes. */
export function claudeFileCommands(spec: AgentSpec, cwd: string | undefined, home: string): SlashCommand[] {
  const user = join(home, spec.home);
  const projects = projectDirs(cwd, home);
  const out: SlashCommand[] = [];
  const add = (command: SlashCommand | undefined) => command && out.push(command);
  for (const root of [...projects.map((dir) => join(dir, ".claude")), user]) {
    for (const file of markdown(join(root, "commands"), true)) add(fromFile(file, basename(file, ".md")));
    for (const file of skills(join(root, "skills"), false)) add(fromFile(file, basename(dirname(file))));
  }
  return out;
}
