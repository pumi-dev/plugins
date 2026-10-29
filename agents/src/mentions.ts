// The files an `@` in the chat finds: the agent's directory walked as the palette walks a project
// (its `.gitignore`s kept, `.git` left out), searched with the palette's fuzzy score, directories
// too. One index per directory, walked again when it is asked after a while. No `import … from "pumi"`.
import { homedir } from "node:os";

import type { MentionHit } from "./conversation/view.ts";
import { Index } from "./files/files.ts";
import { LENGTH_PENALTY, PATHS, match } from "./files/score.ts";

/** How long one ask may wait for a walk under way, in ms: what it has by then is searched. */
const WAIT = 250;
/** How long a walk is good for, in ms: an ask after it walks again (the list in use meanwhile). */
const FRESH = 30_000;
/** How many hits an ask answers. */
const LIMIT = 30;

interface Known {
  index: Index;
  /** The walk's list, files and the directories above them, as of `generation`. */
  paths: { path: string; dir: boolean; nameAt: number }[];
  generation: number;
  /** The walk under way: one at a time, stepped until it is done. */
  walk: Promise<void> | null;
  walkedAt: number;
}

const known = new Map<string, Known>();

/** Every path the index has: its files, and each directory above one, once. */
function pathsOf(index: Index): Known["paths"] {
  const dirs = new Set<string>();
  const out: Known["paths"] = [];
  for (const file of index.files) {
    out.push({ path: file.rel, dir: false, nameAt: file.nameAt });
    for (let at = file.rel.lastIndexOf("/"); at > 0; at = file.rel.lastIndexOf("/", at - 1)) {
      const dir = file.rel.slice(0, at);
      if (dirs.has(dir)) break;
      dirs.add(dir);
    }
  }
  for (const dir of dirs) out.push({ path: dir, dir: true, nameAt: dir.lastIndexOf("/") + 1 });
  return out;
}

/** The best of `paths` for `query`; for an empty one, the shallowest, directories first. */
export function searchPaths(paths: Known["paths"], query: string, limit = LIMIT): MentionHit[] {
  const text = query.trim();
  if (text === "") {
    const depth = (path: string) => path.split("/").length;
    return [...paths]
      .sort((a, b) => depth(a.path) - depth(b.path) || Number(b.dir) - Number(a.dir) || (a.path < b.path ? -1 : 1))
      .slice(0, limit)
      .map(({ path, dir }) => (dir ? { path, dir } : { path }));
  }
  const scored: { hit: MentionHit; score: number }[] = [];
  for (const each of paths) {
    const whole = match(each.path, text, PATHS);
    if (whole === null) continue;
    const name = match(each.path.slice(each.nameAt), text);
    scored.push({ hit: each.dir ? { path: each.path, dir: true } : { path: each.path }, score: whole.score + (name?.score ?? 0) - each.path.length * LENGTH_PENALTY });
  }
  scored.sort((a, b) => b.score - a.score || a.hit.path.length - b.hit.path.length || (a.hit.path < b.hit.path ? -1 : 1));
  return scored.slice(0, limit).map((each) => each.hit);
}

/** The files and directories under `cwd` that `query` finds, best first, as paths from `cwd`. */
export async function mentions(cwd: string | undefined, query: string): Promise<MentionHit[]> {
  // The home directory, or the filesystem's root, is not a project: walking it would take long.
  if (!cwd || cwd === "/" || cwd === homedir()) return [];
  let entry = known.get(cwd);
  if (!entry) {
    entry = { index: new Index(), paths: [], generation: -1, walk: null, walkedAt: 0 };
    known.set(cwd, entry);
  }
  const { index } = entry;
  if (!entry.walk && Date.now() - entry.walkedAt > FRESH && index.start(cwd)) {
    const walking = entry;
    walking.walkedAt = Date.now();
    walking.walk = (async () => {
      while (await index.step());
    })()
      .catch(() => {})
      .finally(() => (walking.walk = null));
  }
  // A walk under way is waited for a moment; what it has by then is searched, and it reads on.
  if (entry.walk) await Promise.race([entry.walk, Bun.sleep(WAIT)]);
  if (entry.generation !== index.generation) {
    entry.paths = pathsOf(index);
    entry.generation = index.generation;
  }
  return searchPaths(entry.paths, query);
}
