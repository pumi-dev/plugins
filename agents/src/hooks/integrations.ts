// Agents' hooks, installed into each agent's own config: the agents the plugin knows (how its hook
// goes in, how its session resumes, what it takes), the hook's line, the merge of it beside the
// user's own hooks and the strip of it again, and the files installed whole (pi's extension,
// OpenCode's plugin). Each hook calls the plugin's `hook` function (`pumi call`) and only in a tab
// the plugin opened for an agent (`$PUMI_AGENT`); `hook.ts` is what it answers. No
// `import … from "pumi"` here.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { HOOK_FN } from "../names.ts";
import { OPENCODE_PLUGIN, PI_EXTENSION, PI_LIVE, PI_STOP, PI_STOP_QUEUE } from "./templates.ts";

/** What marks a hook, or a file, as the plugin's. */
export const MARKER = "pumi-agents";
/** The hooks' version: an installed hook of another is `outdated`. 2: pi and OpenCode hand on the workspace context. */
export const VERSION = 2;
/**
 * How long a permission hook waits for an answer in pumi before the agent asks in its own
 * prompt, in seconds.
 */
export const PERMISSION_WAIT = 120;
/** Where a resume recipe's session goes. */
export const SESSION = "{session}";
/** What a terminal opened for an agent has (`agentLaunch`): the agent's id. Its hook runs only where it is set. */
export const AGENT_ENV = "PUMI_AGENT";

/** How an agent's hook goes in. */
export type Shape =
  | {
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
  | { kind: "cursor"; file: string }
  | { kind: "pi"; file: string }
  | { kind: "opencode"; file: string }
  | { kind: "none" };

/** What a hook says the agent is at, as the hook function hears it. */
export type HookEvent = "start" | "prompt" | "stop" | "compact" | "permission" | "question" | "resume";

/** An agent the plugin knows: how its hook is installed, how its session resumes, and what it takes. */
export interface HookAgent {
  /** What `$PUMI_AGENT` and the hook name it by (`claude`). */
  id: string;
  label: string;
  /** Its program, looked for on the PATH. */
  command: string;
  shape: Shape;
  /** It reports its own state (OSC 7501), so its hook does not. */
  reports: boolean;
  /** The program and arguments that resume a session, `{session}` where its id goes: the tab's `restore_command`. Empty: it does not resume. */
  resume: string[];
  /** `queue`: it takes a queued prompt at a turn's end, through its stop hook or its extension. Only what was checked. */
  accepts: string[];
}

export const HOOK_AGENTS: HookAgent[] = [
  { id: "pi", label: "pi", command: "pi", shape: { kind: "pi", file: ".pi/agent/extensions/pumi-context.ts" }, reports: true, resume: ["pi", "--session", SESSION], accepts: ["queue"] },
  { id: "omp", label: "omp", command: "omp", shape: { kind: "pi", file: ".omp/agent/extensions/pumi-context.ts" }, reports: false, resume: [], accepts: [] },
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    shape: { kind: "hooks", file: ".claude/settings.json", start: "SessionStart", prompt: "UserPromptSubmit", stop: "Stop", permission: "PermissionRequest", asks: "AskUserQuestion|ExitPlanMode", ms: false },
    reports: false,
    resume: ["claude", "--resume", SESSION],
    accepts: ["queue"],
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    shape: { kind: "hooks", file: ".codex/hooks.json", start: "SessionStart", prompt: "UserPromptSubmit", stop: "Stop", ms: false },
    reports: false,
    resume: ["codex", "resume", SESSION],
    accepts: [],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    shape: { kind: "hooks", file: ".gemini/settings.json", start: "SessionStart", prompt: "BeforeAgent", stop: "AfterAgent", ms: true },
    reports: false,
    resume: [],
    accepts: [],
  },
  {
    id: "qwen",
    label: "Qwen Code",
    command: "qwen",
    shape: { kind: "hooks", file: ".qwen/settings.json", start: "SessionStart", prompt: "UserPromptSubmit", stop: "Stop", ms: true },
    reports: false,
    resume: [],
    accepts: [],
  },
  {
    id: "droid",
    label: "Droid",
    command: "droid",
    shape: { kind: "hooks", file: ".factory/settings.json", start: "SessionStart", prompt: "UserPromptSubmit", stop: "Stop", ms: false },
    reports: false,
    resume: [],
    accepts: [],
  },
  { id: "cursor", label: "Cursor", command: "cursor-agent", shape: { kind: "cursor", file: ".cursor/hooks.json" }, reports: false, resume: ["cursor-agent", "--resume", SESSION], accepts: [] },
  { id: "opencode", label: "OpenCode", command: "opencode", shape: { kind: "opencode", file: ".config/opencode/plugins/pumi-context.js" }, reports: false, resume: ["opencode", "--session", SESSION], accepts: [] },
  { id: "kilo", label: "Kilo", command: "kilo", shape: { kind: "opencode", file: ".config/kilo/plugins/pumi-context.js" }, reports: false, resume: [], accepts: [] },
  { id: "copilot", label: "GitHub Copilot", command: "copilot", shape: { kind: "none" }, reports: false, resume: [], accepts: [] },
  { id: "kiro", label: "Kiro CLI", command: "kiro-cli", shape: { kind: "none" }, reports: false, resume: [], accepts: [] },
  { id: "hermes", label: "Hermes", command: "hermes", shape: { kind: "none" }, reports: false, resume: [], accepts: [] },
  { id: "amp", label: "Amp", command: "amp", shape: { kind: "none" }, reports: false, resume: [], accepts: [] },
];

export function findAgent(id: unknown): HookAgent | undefined {
  return typeof id === "string" ? HOOK_AGENTS.find((agent) => agent.id === id) : undefined;
}

/**
 * The hook's line for `agent` at `event`: a no-op outside a tab the plugin opened for an agent.
 * The agent's input (its JSON on stdin) is the call's last argument.
 */
export function hookCommand(agent: string, event: HookEvent): string {
  return `[ -n "$${AGENT_ENV}" ] && "\${PUMI_BIN:-pumi}" call ${HOOK_FN} "$PUMI_TAB" ${agent} ${event} "$(cat)" || true # ${MARKER} v${VERSION}`;
}

/**
 * How a tab for `agent` opens: a shell with `PUMI_AGENT`, and the agent's command typed into it.
 * A shell, so that the tab restored runs its `restore_command` there (a tab opened with a command
 * runs the command again instead).
 */
export function agentLaunch(agent: HookAgent): { env: Record<string, string>; command: string } {
  return { env: { [AGENT_ENV]: agent.id }, command: agent.command };
}

/**
 * The line that resumes `agent`'s `session`: its recipe, or the one `overrides` (the `restore`
 * option) gives it; `undefined` when it has none, or the session is not one word to type.
 */
export function resumeLine(agent: string, session: string, overrides: unknown): string | undefined {
  const given = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? (overrides as Record<string, unknown>)[agent] : undefined;
  let recipe: string[];
  if (given !== undefined) {
    if (!Array.isArray(given) || !given.every((word) => typeof word === "string")) return undefined;
    recipe = given;
  } else {
    const known = findAgent(agent);
    if (!known) return undefined;
    recipe = known.resume;
  }
  return resumeCommand(recipe, session);
}

/** `recipe` with `session` in it, each word quoted for a shell. */
export function resumeCommand(recipe: string[], session: string): string | undefined {
  const id = session.trim();
  const bad = id === "" || id.startsWith("-") || /[\u0000-\u001f\u007f-\u009f]/.test(id);
  if (bad || !recipe.some((word) => word.includes(SESSION))) return undefined;
  return recipe.map((word) => quote(word.replaceAll(SESSION, id))).join(" ");
}

function quote(word: string): string {
  return word !== "" && /^[A-Za-z0-9\-_./=:,+@%]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** Where a hook is: installed, installed by an older version, not, or not something the agent has. */
export type HookState = "installed" | "outdated" | "not_installed" | "unsupported";

/** The PATH agents are looked for in: the app's, after the directories agents are installed to (an app started from the Dock has the system's PATH alone). */
export function agentPath(path = process.env.PATH ?? "", home = homedir()): string {
  const dirs = [join(home, ".local", "bin"), join(home, ".cargo", "bin"), join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const inherited = path.split(delimiter).filter(Boolean);
  return [...dirs.filter((dir) => !inherited.includes(dir)), ...inherited].join(delimiter);
}

export function onPath(command: string, path = agentPath()): boolean {
  return path.split(delimiter).some((dir) => dir !== "" && existsSync(join(dir, command)));
}

/** The file `agent`'s hook is in, under `home`. */
export function hookFile(agent: HookAgent, home = homedir()): string | undefined {
  return agent.shape.kind === "none" ? undefined : join(home, agent.shape.file);
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function readJson(path: string): Json {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`${path}: ${(err as Error).message}`);
  }
  if (text.trim() === "") return {};
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : {};
  } catch (err) {
    throw new Error(`${path} is not JSON the plugin can edit: ${(err as Error).message}`);
  }
}

/** Writes `text` to `path` in one go, after keeping the first copy there was (`.pumi-bak`). */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const backup = `${path}.pumi-bak`;
  if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup);
  const tmp = `${path}.pumi-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

const isOurs = (hook: unknown): boolean => isObject(hook) && typeof hook.command === "string" && hook.command.includes(MARKER);

/** Takes the plugin's hooks out of `config`, leaving the user's; `nested` for Claude's `{matcher, hooks: […]}` groups. */
export function strip(config: Json, nested: boolean): void {
  const hooks = config.hooks;
  if (!isObject(hooks)) return;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    let list = entries;
    if (nested) {
      list = list.map((group) => (isObject(group) && Array.isArray(group.hooks) ? { ...group, hooks: group.hooks.filter((hook) => !isOurs(hook)) } : group));
      list = list.filter((group) => !(isObject(group) && Array.isArray(group.hooks) && group.hooks.length === 0));
    } else {
      list = list.filter((hook) => !isOurs(hook));
    }
    if (list.length === 0) delete hooks[event];
    else hooks[event] = list;
  }
}

/** `config[key]` as the kind it must be, made so when it is not. */
function entry<T>(config: Json, key: string, is: (value: unknown) => value is T, make: () => T): T {
  if (!is(config[key])) config[key] = make();
  return config[key] as T;
}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/** Puts `agent`'s hooks into `config`, once: any of the plugin's already there go first. */
export function merge(config: Json, agent: HookAgent): void {
  const shape = agent.shape;
  if (shape.kind === "hooks") {
    strip(config, true);
    const unit = shape.ms ? 1000 : 1;
    const hooks = entry(config, "hooks", isObject, () => ({}));
    const events: [string | undefined, HookEvent][] = [
      [shape.start, "start"],
      [shape.prompt, "prompt"],
      [shape.stop, "stop"],
      [shape.permission, "permission"],
    ];
    for (const [name, which] of events) {
      if (!name) continue;
      // A permission waits for the user's answer, and gives up on its own first.
      const timeout = unit * (which === "permission" ? PERMISSION_WAIT + 30 : 5);
      entry(hooks, name, isArray, () => []).push({ hooks: [{ type: "command", command: hookCommand(agent.id, which), timeout }] });
    }
    // A question (or a plan to approve) waits on the user: `blocked` before it, and `working`
    // again after a tool ran (it was answered, or a permission was given).
    if (shape.asks) {
      const after: [string, string, HookEvent][] = [
        ["PreToolUse", shape.asks, "question"],
        ["PostToolUse", "", "resume"],
        ["PostToolUseFailure", "", "resume"],
      ];
      for (const [name, matcher, which] of after) {
        const group: Json = { hooks: [{ type: "command", command: hookCommand(agent.id, which), timeout: unit * 5 }] };
        if (matcher !== "") group.matcher = matcher;
        entry(hooks, name, isArray, () => []).push(group);
      }
    }
  } else if (shape.kind === "cursor") {
    strip(config, false);
    if (!("version" in config)) config.version = 1;
    const hooks = entry(config, "hooks", isObject, () => ({}));
    entry(hooks, "sessionStart", isArray, () => []).push({ command: hookCommand(agent.id, "start"), timeout: 5 });
  }
}

/** The whole file the plugin installs for `agent` (pi's extension, OpenCode's plugin), or none for a hook merged into a config. */
export function ownedFile(agent: HookAgent): string | undefined {
  const header = `// installed by pumi's Agents plugin (Settings → Agents → Hooks); reinstalling overwrites this file.\n// ${MARKER} v${VERSION}\n`;
  const fill = (text: string) => text.replaceAll("{fn}", HOOK_FN).replaceAll("{agent}", agent.id);
  switch (agent.shape.kind) {
    case "pi": {
      const stop = agent.accepts.includes("queue") ? PI_STOP_QUEUE : PI_STOP;
      return header + fill(PI_EXTENSION.replace("{stop}", stop).replace("{live}", PI_LIVE));
    }
    case "opencode":
      return header + fill(OPENCODE_PLUGIN);
    default:
      return undefined;
  }
}

/** Whether `value` holds the string `wanted` anywhere. */
function hasString(value: unknown, wanted: string): boolean {
  if (typeof value === "string") return value === wanted;
  if (Array.isArray(value)) return value.some((each) => hasString(each, wanted));
  if (isObject(value)) return Object.values(value).some((each) => hasString(each, wanted));
  return false;
}

export function hookState(agent: HookAgent, home = homedir()): HookState {
  const path = hookFile(agent, home);
  if (!path) return "unsupported";
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return "not_installed";
  }
  if (!text.includes(MARKER)) return "not_installed";
  const owned = ownedFile(agent);
  if (owned !== undefined) return text === owned ? "installed" : "outdated";
  try {
    return hasString(JSON.parse(text), hookCommand(agent.id, "start")) ? "installed" : "outdated";
  } catch {
    return "outdated";
  }
}

/** Installs `agent`'s hook, or brings it up to date; answers the file it is in. */
export function install(agent: HookAgent, home = homedir()): string {
  const path = hookFile(agent, home);
  if (!path) throw new Error(`${agent.label} has no hook the plugin can install`);
  let text = ownedFile(agent);
  if (text === undefined) {
    const config = readJson(path);
    merge(config, agent);
    text = `${JSON.stringify(config, null, 2)}\n`;
  }
  write(path, text);
  return path;
}

/** Takes `agent`'s hook out: its own file goes, its lines leave the agent's config. */
export function uninstall(agent: HookAgent, home = homedir()): void {
  const path = hookFile(agent, home);
  if (!path || !existsSync(path)) return;
  if (ownedFile(agent) !== undefined) {
    if (readFileSync(path, "utf8").includes(MARKER)) rmSync(path);
    return;
  }
  const config = readJson(path);
  const before = JSON.stringify(config);
  strip(config, agent.shape.kind === "hooks");
  if (JSON.stringify(config) !== before) write(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** An agent and its hook, as Settings lists them. */
export interface HookRow {
  id: string;
  label: string;
  /** Its program is on the PATH. */
  available: boolean;
  hook: HookState;
  accepts: string[];
  resumes: boolean;
  /** The file its hook is in, `~/…`. */
  file?: string;
}

/** What Settings says of a row's hook, and the one thing its button does. */
export function hookStatus(row: Pick<HookRow, "hook" | "available">): { text: string; action?: "install" | "update" } {
  switch (row.hook) {
    case "installed":
      return { text: "Installed" };
    case "outdated":
      return { text: "Outdated", action: "update" };
    case "not_installed":
      return { text: row.available ? "Not installed" : "Not found", action: "install" };
    case "unsupported":
      return { text: "No hook" };
  }
}

/** Every agent, whether it is here, and whether its hook is in. */
export function hookRows(home = homedir(), path = agentPath(process.env.PATH ?? "", home)): HookRow[] {
  return HOOK_AGENTS.map((agent) => ({
    id: agent.id,
    label: agent.label,
    available: onPath(agent.command, path),
    hook: hookState(agent, home),
    accepts: agent.accepts,
    resumes: agent.resume.length > 0,
    ...(agent.shape.kind === "none" ? {} : { file: `~/${agent.shape.file}` }),
  }));
}
