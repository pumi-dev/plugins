// The slash commands an agent's TUI takes, for the chat's `/` list: its own, and the ones made of
// files (Claude's commands and skills, Codex's prompts, pi's prompt templates and skills), as the
// format its sub-plugin reads lists them (`registry.ts` `FormatDef`), with the helpers here to read
// them where each agent reads them. A command the chat cannot show the answer to (a picker, a
// settings screen) is `terminal`, and sending it shows the terminal. No `import … from "pumi"` here.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { SlashCommand } from "./conversation/model.ts";
import type { AgentSpec, Format } from "./agents.ts";
import { formatOf } from "./registry.ts";

/** An agent's own command, as a sub-plugin writes it: its name, what it does, and its hint or `terminal`. */
export type Builtin = [name: string, description: string, extra?: { hint?: string; terminal?: boolean }];
/** A command whose answer is a screen of the agent's own. */
export const T = { terminal: true };

/** Commands written as `Builtin`s. */
export function builtins(list: Builtin[]): SlashCommand[] {
  return list.map(([name, description, extra]) => ({ name, description, ...(extra?.hint ? { hint: extra.hint } : {}), ...(extra?.terminal ? { terminal: true } : {}) }));
}

/** The agent's own commands. */
export function builtinCommands(format: Format): SlashCommand[] {
  return formatOf(format)?.builtins ?? [];
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
export function markdown(dir: string, deep: boolean, depth = 0): string[] {
  const out: string[] = [];
  for (const name of names(dir)) {
    const path = join(dir, name);
    if (name.endsWith(".md") && !isDir(path)) out.push(path);
    else if (deep && depth < 4 && !name.startsWith(".") && isDir(path)) out.push(...markdown(path, deep, depth + 1));
  }
  return out;
}

/** The skills in `dir`: each directory with a `SKILL.md`, there or deeper when `deep`. */
export function skills(dir: string, deep: boolean, depth = 0): string[] {
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
export function fromFile(path: string, name: string, prefix = ""): SlashCommand | undefined {
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
  return formatOf(spec.format)?.fileCommands?.(spec, cwd, home) ?? [];
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
