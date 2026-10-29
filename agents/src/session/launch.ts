// Finding and starting an agent's program: the directories agents install to beside `PATH`, the
// first of a list of command lines whose program is there, and a resume recipe as one shell line.
// No `import … from "pumi"` here.
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

/** Where a recipe puts the session's id. */
export const SESSION = "{session}";

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

/** How the host starts an agent's server: the program found and its arguments, and its environment's additions. */
export interface Launch {
  command: string[];
  env: Record<string, string>;
}

/** The first of `run`'s command lines found on `path`; else its last, as it is, so the failure names it. */
export function launchOf(run: string[][], env: Record<string, string> | undefined, path: string): Launch {
  for (const command of run) {
    const found = findProgram(command[0]!, path);
    if (found) return { command: [found, ...command.slice(1)], env: env ?? {} };
  }
  return { command: run[run.length - 1] ?? [], env: env ?? {} };
}

/** Whether one of `run`'s command lines, other than `npx`, is found: it starts without fetching anything. */
export function installed(run: string[][], path: string): boolean {
  return run.some((command) => command[0] !== "npx" && findProgram(command[0]!, path) !== undefined);
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
