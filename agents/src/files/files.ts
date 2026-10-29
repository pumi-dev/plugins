// The files a search looks through, and the search itself.
// A file is a path from the root and the place in it where its name starts; a query scores the
// whole path, and a query that also matches the name adds that, so `lib` finds `src/lib.rs` before
// `crates/libfoo/mod.rs`. Between equals the file opened last wins, then the shorter path, then the
// alphabet. The walk is in `walk.ts`; this is what it fills and what reads it.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative as relativeTo, sep } from "node:path";
import { LENGTH_PENALTY, PATHS, match as fuzzy } from "./score.ts";
import { Walk } from "./walk.ts";

/** An index that has not been walked again within this is fresh enough (the core's `FRESH`). */
const FRESH = 3_000;

/** A file the index holds. */
export interface File {
  /** Its path from the root, with `/` between the parts. */
  rel: string;
  /** Where its name starts in `rel`. */
  nameAt: number;
}

export function file(rel: string): File {
  return { rel, nameAt: rel.lastIndexOf("/") + 1 };
}

/** Its name, without the directories above it. */
export function nameOf(entry: File): string {
  return entry.rel.slice(entry.nameAt);
}

/** The directories above it, without a trailing `/`. */
export function dirOf(entry: File): string {
  return entry.rel.slice(0, entry.nameAt).replace(/\/$/, "");
}

/** A file a query kept, and what it is worth. Its marks are asked for when the row is drawn: a
 * search scores every file, and only the rows in sight need to know where the match was. */
export interface Hit {
  /** Where the file is in the index's list. */
  file: number;
  score: number;
}

/**
 * The project's files as the palette knows them: walked once, extended a step at a time, and
 * searched from what it has. `generation` goes up whenever the list changes under a query, which is
 * how a search knows that the hits it found a moment ago are not what it must narrow.
 */
export class Index {
  root: string | null = null;
  files: File[] = [];
  /** It changes whenever the list does. */
  generation = 0;
  /** Whether a walk is still going (`Searching files…`). */
  walking = false;
  /** It stopped at the walk's limit. */
  truncated = false;
  /** Every path the walk has handed over, and how many of them are files yet. */
  private walked: string[] = [];
  private made = 0;
  /** The walk builds a list beside the one in use, which holds until it is all read. */
  private fresh = false;
  private walk: Walk | null = null;
  private walkedAt = 0;

  /** Starts walking `root`, unless it is already walking it or walked it a moment ago. Whether
   * there is now a walk to step. */
  start(root: string | null): boolean {
    if (root !== this.root) {
      this.root = root;
      this.files = [];
      this.walked = [];
      this.made = 0;
      this.fresh = false;
      this.walk = null;
      this.walking = false;
      this.truncated = false;
      this.walkedAt = 0;
      this.generation++;
    }
    if (this.root === null) return false;
    if (this.walking) return true;
    if (this.walkedAt !== 0 && Date.now() - this.walkedAt < FRESH) return false;
    this.walk = new Walk(this.root);
    this.walked = [];
    this.made = 0;
    // A list already there stays while the new one is read, so the search does not go blank; one
    // being made for the first time fills up in front of the user.
    this.fresh = this.files.length > 0;
    this.truncated = false;
    this.walking = true;
    return true;
  }

  /** Reads for a moment. Whether there is more to read. */
  async step(): Promise<boolean> {
    if (this.walk === null) {
      this.walking = false;
      return false;
    }
    if (!this.fresh) this.generation++;
    const more = await this.walk.step(this.walked);
    this.truncated = this.walk.truncated;
    if (this.fresh) {
      if (!more) {
        this.files = this.walked.map(file);
        this.made = this.walked.length;
        this.generation++;
      }
    } else {
      for (; this.made < this.walked.length; this.made++) this.files.push(file(this.walked[this.made]!));
    }
    if (!more) {
      this.walk = null;
      this.walking = false;
      this.fresh = false;
      this.walkedAt = Date.now();
      this.generation++;
    }
    return more;
  }

  /** The files `query` finds, best first: the whole of the project when the query is empty, the files
   * opened lately first. All of them, as the core keeps them — the palette draws the first
   * `MAX_ROWS` — so a query typed on from this one narrows through every hit, not just the ones in
   * sight. `pool` is that narrowing. */
  search(query: string, recent: Map<string, number>, pool?: readonly number[]): Hit[] {
    const text = collapse(query);
    const rank = (hit: Hit) => recent.get(this.files[hit.file]!.rel) ?? Number.POSITIVE_INFINITY;
    if (text === "") {
      const hits: Hit[] = this.files.map((_, at) => ({ file: at, score: 0 }));
      hits.sort((a, b) => rank(a) - rank(b) || a.file - b.file);
      return hits;
    }
    const hits: Hit[] = [];
    for (const at of pool ?? this.files.keys()) {
      const entry = this.files[at];
      if (entry === undefined) continue;
      const path = fuzzy(entry.rel, text, PATHS);
      if (path === null) continue;
      const name = fuzzy(nameOf(entry), text);
      hits.push({ file: at, score: path.score + (name?.score ?? 0) - entry.rel.length * LENGTH_PENALTY });
    }
    hits.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const left = this.files[a.file]!;
      const right = this.files[b.file]!;
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      if (left.rel.length !== right.rel.length) return left.rel.length - right.rel.length;
      return left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0;
    });
    return hits;
  }

  /** Where `query` matched file `at`, as character indices into its name: the name's own marks when
   * the name matched, otherwise the path's, taken back to where the name starts. */
  marks(at: number, query: string): number[] {
    const entry = this.files[at];
    if (entry === undefined) return [];
    const text = collapse(query);
    if (text === "") return [];
    const inName = fuzzy(nameOf(entry), text);
    if (inName !== null) return inName.marks;
    const path = fuzzy(entry.rel, text, PATHS);
    return path === null ? [] : path.marks.filter((mark) => mark >= entry.nameAt).map((mark) => mark - entry.nameAt);
  }
}

/** A query as the matcher takes it: its words, with the spaces between them run together. */
function collapse(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .join(" ");
}

/**
 * The directory a palette asked from a `cwd` searches: the nearest directory above it that holds a
 * `.git`, unless that is the home directory or the filesystem's root, which are not projects. A
 * `cwd` that names nothing searches nothing.
 */
export function rootFor(cwd: string, home: string | null = homeDir()): string | null {
  if (cwd === "") return null;
  let root = cwd;
  for (let at = cwd; ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) {
      root = at;
      break;
    }
    if (dirname(at) === at) break;
  }
  return dirname(root) === root || (home !== null && home === root) ? null : root;
}

function homeDir(): string | null {
  try {
    return homedir();
  } catch {
    return process.env.HOME ?? null;
  }
}

/** A path as a file of a root names itself, or `null` when it is not under it. */
export function relativePath(root: string, path: string): string | null {
  const rel = relativeTo(root, path);
  if (rel === "" || rel.startsWith("..")) return null;
  return rel.split(sep).join("/");
}
