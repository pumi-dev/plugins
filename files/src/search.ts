// The search over the whole project, for the box on top of the tree: every file and folder of it
// (git's list in a repository, `git ls-files`, so what `.gitignore` hides is left out as VS Code's
// quick open leaves it; a walk of the disk elsewhere), read once and again only after the disk
// changes, and a fuzzy match over it ranked the way a file finder ranks: the letters of the query
// in order, closer together, at the start of a name, in the file's own name rather than its folders.
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** One path of the project, and whether it is a folder. */
export interface Indexed {
  rel: string;
  dir: boolean;
}

/** How many paths a walk outside a repository reads before it stops: a home directory is huge. */
export const WALK_LIMIT = 200_000;

/** The paths of the project at `root`: git's, with every folder above them, or the disk's. */
export async function listProject(root: string, opts: { inRepo: boolean; hideHidden: boolean }): Promise<Indexed[]> {
  const files = opts.inRepo ? await gitFiles(root) : null;
  const out = files === null ? walk(root, opts.hideHidden) : withFolders(files);
  return opts.hideHidden ? out.filter((each) => !each.rel.split("/").some((part) => part.startsWith("."))) : out;
}

/** `git ls-files`: the tracked files and the untracked ones not ignored; null when git fails. */
async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const child = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const text = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) return null;
    // A file deleted but still in the index is listed too; the tree is the disk, so it is kept out
    // only by the next read after the deletion is staged. Duplicates (a conflict's stages) are one.
    return [...new Set(text.split("\0").filter((each) => each !== ""))];
  } catch {
    return null;
  }
}

/** The files with each folder above them, once. */
export function withFolders(files: string[]): Indexed[] {
  const dirs = new Set<string>();
  const out: Indexed[] = [];
  for (const rel of files) {
    out.push({ rel, dir: false });
    for (let slash = rel.lastIndexOf("/"); slash > 0; slash = rel.lastIndexOf("/", slash - 1)) {
      const dir = rel.slice(0, slash);
      if (dirs.has(dir)) break;
      dirs.add(dir);
    }
  }
  for (const rel of dirs) out.push({ rel, dir: true });
  return out;
}

/** The disk under `root`, breadth first, up to `WALK_LIMIT` paths; `.git` and `node_modules` left out. */
function walk(root: string, hideHidden: boolean): Indexed[] {
  const out: Indexed[] = [];
  const queue = [""];
  while (queue.length > 0 && out.length < WALK_LIMIT) {
    const at = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(at === "" ? root : join(root, at), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name === ".git" || name === "node_modules" || (hideHidden && name.startsWith("."))) continue;
      const rel = at === "" ? name : `${at}/${name}`;
      const dir = entry.isDirectory();
      out.push({ rel, dir });
      if (dir) queue.push(rel);
    }
  }
  return out;
}

/** How well `query` fits `rel`, or null when it does not: its letters must all be there, in order. */
export function score(query: string, rel: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (q === "") return 0;
  const text = rel.toLowerCase();
  const nameAt = rel.lastIndexOf("/") + 1;
  // A query with a slash is a path; without one, it is first tried within the name alone.
  if (!q.includes("/")) {
    const inName = fit(q, text, nameAt, rel);
    if (inName !== null) return inName + 1000;
  }
  return fit(q, text, 0, rel);
}

/** How well `q` fits `text` after `from`: each letter at the next word's start it can take (a
 *  jump that leaves later letters nowhere to go falls back to taking each at the next hit). */
function fit(q: string, text: string, from: number, original: string): number | null {
  // From each of the first few places the first letter is (`pumi-panel`: the `p` of `panel` makes
  // a run where the `p` of `pumi` does not), the best.
  let best: number | null = null;
  let tries = 0;
  for (let start = text.indexOf(q[0]!, from); start >= 0 && tries < STARTS; start = text.indexOf(q[0]!, start + 1), tries++) {
    const points = fitting(q, text, from, start, original, true) ?? fitting(q, text, from, start, original, false);
    if (points !== null && (best === null || points > best)) best = points;
  }
  return best;
}

/** How many places of the first letter a match is tried from. */
const STARTS = 12;

function fitting(q: string, text: string, from: number, start: number, original: string, jump: boolean): number | null {
  let total = 0;
  let at = start;
  let last = -2;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i]!;
    let found = i === 0 ? start : text.indexOf(ch, at);
    if (found < 0) return null;
    if (jump && i > 0 && found !== last + 1) {
      const boundary = nextBoundary(text, original, ch, at);
      if (boundary >= 0) found = boundary;
    }
    let points = 1;
    if (found === last + 1) points += 8; // consecutive
    if (isBoundary(text, original, found)) points += 6;
    if (found === from) points += 4;
    total += points;
    last = found;
    at = found + 1;
  }
  // Shorter paths first, among those that fit as well.
  return total * 10 - Math.min(text.length - from, 200) / 10;
}

function isBoundary(text: string, original: string, i: number): boolean {
  if (i === 0) return true;
  const before = text[i - 1]!;
  if ("/._- ".includes(before)) return true;
  // camelCase: a capital after a lowercase letter.
  const c = original[i]!;
  const b = original[i - 1]!;
  return c !== c.toLowerCase() && b === b.toLowerCase();
}

function nextBoundary(text: string, original: string, ch: string, from: number): number {
  for (let i = text.indexOf(ch, from); i >= 0; i = text.indexOf(ch, i + 1)) {
    if (isBoundary(text, original, i)) return i;
  }
  return -1;
}

/** The `limit` best of `paths` for `query`, best first, and every one that fits: a longer query
 *  (the next keystroke) need only look among those. */
export function searched(paths: Indexed[], query: string, limit: number): { hits: Indexed[]; fits: Indexed[] } {
  const scored: { each: Indexed; points: number }[] = [];
  for (const each of paths) {
    const points = score(query, each.rel);
    if (points !== null) scored.push({ each, points });
  }
  const fits = scored.map((hit) => hit.each);
  scored.sort((a, b) => b.points - a.points || a.each.rel.length - b.each.rel.length || (a.each.rel < b.each.rel ? -1 : 1));
  return { hits: scored.slice(0, limit).map((hit) => hit.each), fits };
}

/** The `limit` best of `paths` for `query`, best first. */
export function search(paths: Indexed[], query: string, limit: number): Indexed[] {
  return searched(paths, query, limit).hits;
}
