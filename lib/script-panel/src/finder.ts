// What the page lists: a repository's runnable scripts, and the walk that finds them. A `Finder`
// is a package's half (what a directory holds, how deep to look, how to order what is found);
// `groupScripts` is the walk they share.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** Directories never walked into. */
export const SKIP: readonly string[] = [
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  "out",
  "vendor",
  ".next",
  ".nuxt",
  ".output",
  ".venv",
  "coverage",
];

/** Enough directories for any repository a person keeps scripts in. */
const MAX_DIRS = 20_000;

/** One runnable thing: its name, what to show beside it, and the line typed to run it. */
export interface Item {
  name: string;
  detail: string;
  command: string;
}

/** A directory's (or a package's) items, under a header. */
export interface Group {
  label: string;
  /** Where its items run. */
  dir: string;
  items: Item[];
}

/** What a package finds in a directory, and how it describes it. */
export interface Finder {
  /** How many directories below the root to look in at most. */
  depth: number;
  /** Whether an item's command shows beside its name. */
  showDetail: boolean;
  /** What the page says when nothing was found. */
  empty: string;
  /**
   * The options that re-read the finder when one changes: globs of their full names, tested as an
   * event's `match` is (`pkg.prefixed("*")` for the package's own).
   */
  optionMatch: string | string[];
  /** The items `dir` holds, if any; `root` is the repository's top. */
  group(dir: string, root: string): Group | null;
  /** The groups in the order shown; by label without one. */
  sort?(groups: Group[]): void;
}

/** The repository around `cwd`: the nearest directory with a `.git`, else `cwd` itself. */
export function repoRoot(cwd: string): string {
  for (let at = cwd; ; ) {
    if (existsSync(join(at, ".git"))) return at;
    const up = dirname(at);
    if (up === at) return cwd;
    at = up;
  }
}

/**
 * Every group below `root`, `depth` directories down at most, skipping hidden, symlinked and
 * `SKIP`ped directories, in the order the finder sorts them.
 */
export function groupScripts(finder: Finder, root: string): Group[] {
  const found: Group[] = [];
  const pending: [dir: string, level: number][] = [[root, 0]];
  let visited = 0;
  while (pending.length > 0) {
    const [dir, level] = pending.pop()!;
    if (++visited > MAX_DIRS) break;
    const group = finder.group(dir, root);
    if (group) found.push(group);
    if (level >= finder.depth) continue;
    for (const child of children(dir)) pending.push([child, level + 1]);
  }
  if (finder.sort) finder.sort(found);
  else found.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return found;
}

/** The directories in `dir` the walk goes into, by name. */
function children(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".") && !SKIP.includes(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort();
}

/** `dir` relative to `root`, `.` for the root itself. */
export function label(dir: string, root: string): string {
  const inside = relative(root, dir);
  return inside === "" ? "." : inside;
}

/** A word as the shell reads it: as it is when it is plain, else single-quoted. */
export function quote(word: string): string {
  const plain = word.length > 0 && /^[a-zA-Z0-9@._:/-]+$/.test(word);
  return plain ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
