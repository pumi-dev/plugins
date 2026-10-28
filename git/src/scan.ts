// The repositories under a directory that is in none: a folder of checkouts. Only a level or two
// down, and never under the home directory or the disk's root, which hold every repository there is.
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** How many directory levels under the user's directory are looked in for repositories. */
export const DEPTH = 2;
/** The most repositories listed: a directory of many more is not a project of a few. */
export const MAX_REPOS = 20;
/** Directories that hold dependencies and builds, not projects. */
const SKIP = new Set(["node_modules", "target", "dist", "build", "vendor", "Library"]);

/** Whether `dir` is too wide to look under: the home directory, or the disk's root. */
export function tooWide(dir: string, home: string = homedir()): boolean {
  const clean = dir.replace(/\/+$/, "") || "/";
  return clean === "/" || clean === home.replace(/\/+$/, "");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The repositories under `dir`, the shallowest first, at most `depth` levels down and `limit` of
 * them, not looking inside one or into a hidden directory; sorted by path. */
export async function nested(dir: string, depth: number = DEPTH, limit: number = MAX_REPOS): Promise<string[]> {
  const found: string[] = [];
  let level = [dir];
  for (let at = 1; at <= depth && level.length > 0; at++) {
    const next: string[] = [];
    for (const parent of level) {
      let names: string[];
      try {
        names = (await readdir(parent, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIP.has(entry.name))
          .map((entry) => entry.name)
          .sort();
      } catch {
        continue;
      }
      for (const name of names) {
        const path = join(parent, name);
        if (await exists(join(path, ".git"))) found.push(path);
        else next.push(path);
        if (found.length >= limit) return found.sort();
      }
    }
    level = next;
  }
  return found.sort();
}
