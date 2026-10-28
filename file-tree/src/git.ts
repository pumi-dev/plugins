// What git says of a path, and the colour that gives a row, from
// `git status --porcelain`. Every status entry counts towards itself and towards
// every directory above it, so a folder is tinted by what is under it.
import * as rel from "./relpath.ts";

/** The changes of one side of git's index, counted. */
export interface TrackedSummary {
  added: number;
  modified: number;
  deleted: number;
}

/** What one path has done to it; a directory holds what all of its entries have. */
export interface GitSummary {
  index: TrackedSummary;
  worktree: TrackedSummary;
  conflict: number;
  untracked: number;
}

const NONE: TrackedSummary = { added: 0, modified: 0, deleted: 0 };

export const UNCHANGED: GitSummary = { index: NONE, worktree: NONE, conflict: 0, untracked: 0 };
export const UNTRACKED: GitSummary = { index: NONE, worktree: NONE, conflict: 0, untracked: 1 };
export const CONFLICT: GitSummary = { index: NONE, worktree: NONE, conflict: 1, untracked: 0 };

/** `a` with `b`'s counts added to it. */
export function plus(a: GitSummary, b: GitSummary): GitSummary {
  return {
    index: sum(a.index, b.index),
    worktree: sum(a.worktree, b.worktree),
    conflict: a.conflict + b.conflict,
    untracked: a.untracked + b.untracked,
  };
}

function sum(a: TrackedSummary, b: TrackedSummary): TrackedSummary {
  return { added: a.added + b.added, modified: a.modified + b.modified, deleted: a.deleted + b.deleted };
}

/** Whether a path has nothing to say: the tree keeps no summary for it. */
export function isUnchanged(summary: GitSummary): boolean {
  return (
    summary.conflict === 0 &&
    summary.untracked === 0 &&
    summary.index.added === 0 &&
    summary.index.modified === 0 &&
    summary.index.deleted === 0 &&
    summary.worktree.added === 0 &&
    summary.worktree.modified === 0 &&
    summary.worktree.deleted === 0
  );
}

/** The theme colour name a row is drawn in: git's own naming of it. */
export type LabelColor = "conflict" | "deleted" | "modified" | "added" | "ignored" | "selected" | "muted";

/** The colour of a row's text: git's state of it, else whether it is ignored or selected. */
export function labelColor(git: GitSummary, ignored: boolean, selected: boolean): LabelColor {
  const tracked = sum(git.index, git.worktree);
  if (git.conflict > 0) return "conflict";
  if (tracked.deleted > 0) return "deleted";
  if (tracked.modified > 0) return "modified";
  if (tracked.added > 0 || git.untracked > 0) return "added";
  if (ignored) return "ignored";
  return selected ? "selected" : "muted";
}

/** The repository `cwd` is in: its work tree's directory, or `null` when it is in none. */
export function repositoryRoot(cwd: string): string | null {
  const answer = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd, stdout: "pipe", stderr: "ignore" });
  if (!answer.success) return null;
  const root = new TextDecoder().decode(answer.stdout).trim();
  return root === "" ? null : root;
}

/**
 * Every path with something to report, and every directory above it, from `git status`.
 *
 * `--porcelain -z` is one entry per line but for a rename, which is two records: the new name, then
 * the old; `--untracked-files=all` lists the files of a new directory one by one, so each is
 * marked.
 */
export async function summaries(root: string): Promise<Map<string, GitSummary>> {
  const out = new Map<string, GitSummary>();
  const statuses = await status(root);
  for (const { path, summary } of statuses) {
    if (isUnchanged(summary)) continue;
    for (const above of rel.ancestors(path)) out.set(above, plus(out.get(above) ?? UNCHANGED, summary));
  }
  return out;
}

/** One record of `git status`: a path in the repository, and what happened to it. */
export interface Status {
  path: string;
  summary: GitSummary;
}

/** Runs `git status` where `root` is, and reads it. Nothing for a directory that is no repository. */
export async function status(root: string): Promise<Status[]> {
  const text = await run(["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=no"], root);
  return text === null ? [] : parse(text);
}

function run(args: string[], cwd: string): Promise<string | null> {
  try {
    const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    return child.exited.then(async (code) => (code === 0 ? await new Response(child.stdout).text() : null));
  } catch {
    return Promise.resolve(null);
  }
}

/** The records of `git status --porcelain -z`: `XY path`, and a rename's two paths. */
export function parse(text: string): Status[] {
  const out: Status[] = [];
  const records = text.split("\0");
  for (let at = 0; at < records.length; at++) {
    const record = records[at]!;
    if (record.length < 4) continue;
    const x = record[0]!;
    const y = record[1]!;
    const path = record.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      // The record after this one is where it came from; git reports the move, not both ends.
      at++;
    }
    out.push({ path, summary: summaryOf(x, y) });
  }
  return out;
}

const CONFLICT_PAIRS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** What a two-letter status code adds up to. */
export function summaryOf(x: string, y: string): GitSummary {
  if (CONFLICT_PAIRS.has(`${x}${y}`)) return CONFLICT;
  if (x === "?" || y === "?") return UNTRACKED;
  if (x === "!" || y === "!") return UNCHANGED;
  const side = (code: string): TrackedSummary => {
    switch (code) {
      case "A":
        return { ...NONE, added: 1 };
      case "M":
      case "T":
        return { ...NONE, modified: 1 };
      case "D":
        return { ...NONE, deleted: 1 };
      default:
        // `R` (a rename), `C` (a copy) and a space change nothing the tree shows.
        return NONE;
    }
  };
  return { index: side(x), worktree: side(y), conflict: 0, untracked: 0 };
}
