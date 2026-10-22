// What the page keeps between runs: the directories a repository's tree has folded away. The core
// plugin's `State` also held the commit message, the caret and the filter; an `input` holds its own
// text and cursor now, and a draft is the panel's while it runs, so only the folding is written.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The file a package's folded directories are kept in, in its own state directory. */
const FILE = "folded.json";

/** What is in the file: each repository's root, and the rows it has folded. */
type Stored = Record<string, string[]>;

function read(dir: string): Stored {
  try {
    const stored: unknown = JSON.parse(readFileSync(join(dir, FILE), "utf8"));
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return {};
    const kept: Stored = {};
    for (const [root, ids] of Object.entries(stored as Record<string, unknown>)) {
      if (Array.isArray(ids)) kept[root] = ids.filter((id): id is string => typeof id === "string");
    }
    return kept;
  } catch {
    // No file yet, or one that does not read: every directory is open.
    return {};
  }
}

/** The rows `root`'s tree had folded the last time the page ran. */
export function load(dir: string, root: string): Set<string> {
  return new Set(read(dir)[root] ?? []);
}

/** Keep `collapsed` for `root`, and what the other repositories have. */
export async function save(dir: string, root: string, collapsed: ReadonlySet<string>): Promise<void> {
  const stored = read(dir);
  stored[root] = [...collapsed].sort();
  mkdirSync(dirname(join(dir, FILE)), { recursive: true });
  await Bun.write(join(dir, FILE), `${JSON.stringify(stored, null, 2)}\n`);
}
