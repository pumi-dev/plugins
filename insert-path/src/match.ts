// How a query picks the files it keeps: a case-insensitive subsequence over the file name (or,
// once the query has a `/` in it, over the whole relative path), scored so that runs, word starts,
// exact case and camel humps come first.
import type { Entry } from "./entries.ts";

/** The most rows the picker holds at once. */
const MAX_HITS = 200;

/** What starts a word in a path. */
const BREAK = new Set(["/", "\\", "_", "-", ".", " "]);

/** An entry a query keeps, and how well it scored. */
export interface Hit {
  /** Where the entry is in the walked list. */
  readonly index: number;
  readonly score: number;
}

const lower = (c: string) => c === c.toLowerCase() && c !== c.toUpperCase();
const upper = (c: string) => c === c.toUpperCase() && c !== c.toLowerCase();

/**
 * How well `query` matches `haystack` as a case-insensitive subsequence: `null` when a character
 * is missing. Consecutive runs, word starts and exact case score higher, so `srcmain` finds
 * `src/main.rs` and `mm` prefers `mm.rs` to `src/module_math.rs`.
 */
export function score(haystack: string, query: string): number | null {
  if (query === "") return 0;
  const hay = Array.from(haystack);
  let at = 0;
  let total = 0;
  let last: number | null = null;
  for (const want of query) {
    const wantLower = want.toLowerCase();
    let hit = -1;
    while (at < hay.length) {
      if (hay[at]!.toLowerCase() === wantLower) {
        hit = at;
        break;
      }
      at += 1;
    }
    if (hit < 0) return null;
    const found = hay[hit]!;
    total += found === wantLower ? 3 : 2;
    if (last !== null && hit === last + 1) total += 6;
    if (hit === 0 || BREAK.has(hay[hit - 1]!)) total += 9;
    if (hit > 0 && lower(hay[hit - 1]!) && upper(found)) total += 5;
    last = hit;
    at = hit + 1;
  }
  return total;
}

/**
 * The entries a query keeps, best first, at most `MAX_HITS` of them. A query with a `/` in it is
 * matched against the whole relative path, so `src/ma` narrows to one directory.
 */
export function hits(entries: Entry[], query: string): Hit[] {
  if (query === "") {
    return entries.slice(0, MAX_HITS).map((_, index) => ({ index, score: 0 }));
  }
  const byPath = query.includes("/");
  const scored: Hit[] = [];
  entries.forEach((entry, index) => {
    const value = score(byPath ? entry.rel : entry.name, query);
    if (value !== null) scored.push({ index, score: value });
  });
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const left = entries[a.index]!.rel;
    const right = entries[b.index]!.rel;
    if (left.length !== right.length) return left.length - right.length;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return scored.slice(0, MAX_HITS);
}
