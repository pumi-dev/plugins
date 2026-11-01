// pi (and omp)'s slash commands: its own, and the ones made of files where it reads them.
import { basename, dirname, join } from "node:path";

import { fromFile, markdown, projectDirs, skills, T, builtins, type AgentSpec, type Builtin, type SlashCommand } from "../../../src/api.ts";

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

/** pi (and omp)'s own commands. */
export const piBuiltins: SlashCommand[] = builtins(PI);

/** The commands made of files that `spec`'s agent in `cwd` takes. */
export function piFileCommands(spec: AgentSpec, cwd: string | undefined, home: string): SlashCommand[] {
  const user = join(home, spec.home);
  const projects = projectDirs(cwd, home);
  const out: SlashCommand[] = [];
  const add = (command: SlashCommand | undefined) => command && out.push(command);
  const local = spec.id === "omp" ? ".omp" : ".pi";
  for (const root of [...projects.slice(0, 1).map((dir) => join(dir, local)), user]) {
    for (const file of markdown(join(root, "prompts"), false)) add(fromFile(file, basename(file, ".md")));
  }
  for (const root of [...projects.slice(0, 1).map((dir) => join(dir, local)), user, ...projects.map((dir) => join(dir, ".agents")), join(home, ".agents")]) {
    for (const file of skills(join(root, "skills"), true)) add(fromFile(file, basename(dirname(file)), "skill:"));
  }
  return out;
}
