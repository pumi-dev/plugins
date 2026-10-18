// The agents an ACP pane can run: how each starts its ACP server, signs in, and resumes in its
// own TUI. The table is the package's, and the `agents` option adds to it or replaces an entry
// (`{"goose": {"command": "goose", "args": ["acp"]}}`). No `import … from "pumi"` here.
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

/** One agent, as the table has it. */
export interface AgentDef {
  /** What it is called in the chat: `Claude`, `Codex`. */
  name: string;
  /** Ways to start its ACP server, tried in order: the first whose program is found runs; the last runs as it is. */
  run: string[][];
  env?: Record<string, string>;
  /** The command line that signs in, run in a terminal pane. */
  login?: string[];
  /** Its TUI resuming a session, `{session}` where the id goes (`agents`' restore recipes). */
  resume?: string[];
}

/** Where a recipe puts the session's id. */
export const SESSION = "{session}";

/**
 * The adapters' versions, pinned: `npx` fetches exactly these when the adapter is not installed.
 * Checked on npm when this was written.
 */
export const PINS = {
  claude: "@agentclientprotocol/claude-agent-acp@0.94.0",
  codex: "@agentclientprotocol/codex-acp@2.2.2",
  pi: "pi-acp@0.0.34",
} as const;

export const AGENTS: Record<string, AgentDef> = {
  claude: {
    name: "Claude",
    run: [["claude-agent-acp"], ["npx", "-y", PINS.claude]],
    login: ["claude", "/login"],
    resume: ["claude", "--resume", SESSION],
  },
  codex: {
    name: "Codex",
    run: [["codex-acp"], ["npx", "-y", PINS.codex]],
    login: ["codex", "login"],
    resume: ["codex", "resume", SESSION],
  },
  pi: {
    name: "pi",
    run: [["pi-acp"], ["npx", "-y", PINS.pi]],
    login: ["pi"],
    resume: ["pi", "--session", SESSION],
  },
  gemini: { name: "Gemini", run: [["gemini", "--acp"]], login: ["gemini"] },
  opencode: { name: "OpenCode", run: [["opencode", "acp"]], login: ["opencode", "auth", "login"], resume: ["opencode", "--session", SESSION] },
  copilot: { name: "Copilot", run: [["copilot", "--acp"]], login: ["copilot"] },
};

/** An agent the user adds in the `agents` option. */
interface Custom {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  login?: string[];
  resume?: string[];
}

const words = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((word) => typeof word === "string") ? (value as string[]) : undefined;

/** The table with the `agents` option's entries added; an entry that is not a table is ignored. */
export function agentTable(custom: unknown): Record<string, AgentDef> {
  const table: Record<string, AgentDef> = { ...AGENTS };
  if (!custom || typeof custom !== "object") return table;
  for (const [id, given] of Object.entries(custom as Record<string, Custom>)) {
    if (!given || typeof given !== "object" || typeof given.command !== "string" || given.command === "") continue;
    const env = given.env && typeof given.env === "object" ? Object.fromEntries(Object.entries(given.env).filter(([, v]) => typeof v === "string")) : undefined;
    table[id] = {
      name: typeof given.name === "string" && given.name !== "" ? given.name : id,
      run: [[given.command, ...(words(given.args) ?? [])]],
      ...(env ? { env } : {}),
      ...(words(given.login) ? { login: words(given.login) } : {}),
      ...(words(given.resume) ? { resume: words(given.resume) } : {}),
    };
  }
  return table;
}

/** Where agents install themselves beside `PATH`: an app started from the desktop often has a short one. */
const USER_DIRS = [".local/bin", ".bun/bin", ".cargo/bin", ".npm-global/bin", ".opencode/bin", ".volta/bin"];
const SYSTEM_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** `path`'s directories, then those agents install to. */
export function searchPath(path: string | undefined, home: string = homedir()): string {
  const dirs = (path ?? "").split(delimiter).filter((dir) => dir !== "");
  for (const dir of [...USER_DIRS.map((dir) => join(home, dir)), ...SYSTEM_DIRS]) if (!dirs.includes(dir)) dirs.push(dir);
  return dirs.join(delimiter);
}

/** `program` on `path`, or `undefined`. A program given with a `/` is taken as it is. */
export function findProgram(program: string, path: string): string | undefined {
  if (program.includes("/")) return executable(program) ? program : undefined;
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, program);
    if (executable(candidate)) return candidate;
  }
  return undefined;
}

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** How the host starts an agent: the program found and its arguments, and its environment's additions. */
export interface Launch {
  command: string[];
  env: Record<string, string>;
}

/** The first of `def`'s commands found on `path`; else its last, as it is, so the failure names it. */
export function launchOf(def: AgentDef, path: string): Launch {
  for (const command of def.run) {
    const found = findProgram(command[0]!, path);
    if (found) return { command: [found, ...command.slice(1)], env: def.env ?? {} };
  }
  return { command: def.run[def.run.length - 1]!, env: def.env ?? {} };
}

/** Whether the agent can start without fetching anything: one of its commands, other than `npx`, is found. */
export function installed(def: AgentDef, path: string): boolean {
  return def.run.some((command) => command[0] !== "npx" && findProgram(command[0]!, path) !== undefined);
}

/** A recipe as one shell line, the session put in and each word quoted; `undefined` for a session that cannot be one word. */
export function resumeLine(recipe: string[], session: string): string | undefined {
  const id = session.trim();
  if (id === "" || id.startsWith("-") || /[\u0000-\u001f\u007f]/.test(id) || !recipe.some((word) => word.includes(SESSION))) return undefined;
  return recipe.map((word) => quote(word.split(SESSION).join(id))).join(" ");
}

/** One word of a shell line: bare when plain, else in single quotes. */
export function quote(word: string): string {
  return word !== "" && /^[A-Za-z0-9\-_./=:,+@%]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
