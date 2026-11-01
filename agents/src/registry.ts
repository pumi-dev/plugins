// The agents the plugin knows, and what reads and runs them. None is built in: each comes from a
// sub-plugin (`subplugins.ts`), one the plugin ships in `agents/` or one installed, whose manifest
// says its agents (`agents`), the session-file formats its code reads (`formats`), and the engines
// its code runs a GUI tab with (`engines`). Both halves fill this from the same manifests: the
// window from their data alone, the worker with their code too. No `import … from "pumi"` here.
import type { AgentSpec } from "./agents.ts";
import type { Choice as ModelChoice, SlashCommand } from "./conversation/model.ts";
import type { Parser } from "./parse/common.ts";

/** The level of the plugin's sub-plugin API: `subPlugins.api` in its manifest. */
export const SUB_API = 1;

/** What Settings offers for an agent, and the `modes` option holds. */
export type Choice = "off" | "terminal" | "gui";

/** How an agent's hook goes in. */
export type Shape =
  | {
      /** Merged into a JSON config of the agent's, as Claude Code's `hooks`: an event's list of `{hooks: [{command}]}`. */
      kind: "hooks";
      file: string;
      start: string;
      prompt?: string;
      stop?: string;
      /** The event that runs when the agent would ask the user's permission: with `permissions` on, it is asked in pumi instead. */
      permission?: string;
      /** The tools that wait on the user (a `PreToolUse` matcher): `blocked` before them, and `working` again after any tool. */
      asks?: string;
      /** Its timeouts are in milliseconds. */
      ms: boolean;
    }
  /** Merged into a flat JSON list of hooks by event, as Cursor's `hooks.json`. */
  | { kind: "cursor"; file: string }
  /**
   * A whole file of the plugin's (pi's extension, OpenCode's plugin): `template`, a file of the
   * sub-plugin, with `{fn}` (the hook function) and `{agent}` (its id) filled in.
   */
  | { kind: "file"; file: string; template: string }
  | { kind: "none" };

/** An agent's hook: how it goes in, and what it does with the plugin. */
export interface HookDef {
  shape: Exclude<Shape, { kind: "none" }>;
  /** It reports its own state (OSC 7501), so its hook does not. */
  reports?: boolean;
  /** The program and arguments that resume a session in its terminal, `{session}` where its id goes: the tab's `restore_command`. */
  restore?: string[];
  /** `queue`: it takes a queued prompt at a turn's end, through its stop hook or its extension. */
  accepts?: string[];
}

/** How the chat drawn over an agent's terminal reads it and types into it (`AgentSpec`, without its id and label). */
export interface ChatDef {
  /** The format its session files are in: one a sub-plugin's code reads (`formats`). */
  format: string;
  /** What ends its running turn when typed into its terminal. */
  cancel: string;
  /** How a picture goes in: its path pasted alone, or in the prompt's text. */
  images: "paste" | "text";
  /** Where its own settings, commands and skills are, from the home directory. */
  home: string;
  /** How it goes back to before a message: the format's `extension` (`command`), its own list, or Escape twice. */
  rewind: "command" | "picker" | "backtrack";
}

/** One agent, as a sub-plugin's manifest says it (`pumi.agents`). */
export interface AgentDef {
  /** The id its hook sets as the trait, `modes`'s key, and the `+` menu's command (`new_<id>`). */
  id: string;
  /** What the menu and Settings call it. */
  title: string;
  /** What its chat, its hook's prompts and its errors call it; `title` without. */
  label?: string;
  /** Its TUI: the program on `PATH`. */
  program: string;
  /** Where it goes among the others, the lowest first; 1000 without. */
  rank?: number;
  /** The choice it has until Settings says otherwise; `terminal` without. */
  default?: Choice;
  /** Its mark: a file of the sub-plugin (an absolute path once loaded). */
  icon?: string;
  /** Its TUI resuming a session, `{session}` where the id goes. */
  resume?: string[];
  /** How its ACP server starts, tried in order (the first whose program is found), and signs in. */
  acp?: { run: string[][]; env?: Record<string, string>; login?: string[] };
  /** The engine its GUI runs it with besides ACP (`engines`). */
  sdk?: string;
  /** Said under its row while its GUI runs its SDK. */
  sdkNote?: string;
  hook?: HookDef;
  chat?: ChatDef;
  /** The sub-plugin it is from. */
  from: string;
}

/** Where an agent's session file is looked for. */
export interface FormatWhere {
  cwd?: string;
  home: string;
  env: Record<string, string | undefined>;
}

/** A session-file format, as a sub-plugin's code gives it (`formats`). */
export interface FormatDef {
  /** A parser of its records, one per file followed. */
  parser(): Parser;
  /** The session file of `session` (its id) for `spec`'s agent, or none while it is not there. */
  locate(spec: AgentSpec, session: string, where: FormatWhere): string | undefined;
  /** The models the chat's picker offers. */
  models?(spec: AgentSpec, cwd: string | undefined, env: Record<string, string | undefined>): ModelChoice[] | Promise<ModelChoice[]>;
  /** The agent's own slash commands. */
  builtins?: SlashCommand[];
  /** The slash commands made of files (prompts, skills) the agent in `cwd` takes. */
  fileCommands?(spec: AgentSpec, cwd: string | undefined, home: string): SlashCommand[];
  /** The agent writes a live file of the turn as it goes (pi's, through the plugin's hook). */
  live?: boolean;
  /** Its model is picked in its own terminal, whatever is chosen in the chat. */
  modelsInTerminal?: boolean;
  /** The agent extension `rewind: "command"` goes back with: a file, installed under the agent's `home` on first use. */
  extension?: string;
}

/** An engine a GUI tab's host runs an agent with, besides ACP (`engines`). */
export interface EngineDef {
  id: string;
  /** Its module, which the host imports: an absolute path once loaded. Its `createDriver(spec, write, events)` is the driver. */
  module: string;
  /** The agent's server, `{program}` where its program goes; none for an engine without a process of its own. */
  run?: string[];
  /** What goes after `run` to continue a session, `{session}` where its id goes. */
  session?: string[];
  /** It runs the agent's server as a process (`run`); `false`, it runs the agent in the host itself. */
  process?: boolean;
  /** The sub-plugin it is from. */
  from: string;
}

/** What the sub-plugins give, together. */
export interface Registry {
  agents: AgentDef[];
  /** Each format by id; `null` for one a sub-plugin says it reads, whose code is not loaded (the window). */
  formats: Map<string, FormatDef | null>;
  engines: Map<string, EngineDef>;
}

let now: Registry = { agents: [], formats: new Map(), engines: new Map() };
const listeners = new Set<() => void>();

/** What the sub-plugins give from now on; each listener hears it. */
export function setRegistry(next: Registry): void {
  now = { ...next, agents: [...next.agents].sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000)) };
  for (const listen of listeners) listen();
}

/** Hears each change; answers its disposer. */
export function onRegistry(listen: () => void): () => void {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

/** Every agent, in order. */
export function agentList(): AgentDef[] {
  return now.agents;
}

export function agentDef(id: unknown): AgentDef | undefined {
  return typeof id === "string" ? now.agents.find((agent) => agent.id === id) : undefined;
}

/** Whether a sub-plugin that is on reads `format`. */
export function hasFormat(format: string): boolean {
  return now.formats.has(format);
}

/** The code that reads `format`, when it is loaded. */
export function formatOf(format: string): FormatDef | undefined {
  return now.formats.get(format) ?? undefined;
}

export function engineOf(id: string | undefined): EngineDef | undefined {
  return id === undefined ? undefined : now.engines.get(id);
}
