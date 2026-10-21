// The files the picker offers: every file and directory under the terminal's directory, walked
// once when it opens, each knowing its own name and the directory above it.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** Directories never walked into: version control, build output, and installed dependencies. */
const SKIP = [
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "vendor",
  ".next",
  ".nuxt",
  ".output",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
  ".cache",
  "Pods",
];

/** How deep the walk goes, and how many entries it keeps. */
const MAX_DEPTH = 15;
const MAX_ENTRIES = 60_000;

/** One path under the root: `rel` is `/`-separated and relative to it. */
export class Entry {
  /** Where the file name starts in `rel`. */
  readonly nameAt: number;

  constructor(
    readonly rel: string,
    readonly dir: boolean,
  ) {
    this.nameAt = rel.lastIndexOf("/") + 1;
  }

  /** The file name. */
  get name(): string {
    return this.rel.slice(this.nameAt);
  }

  /** The directory above it, relative to the root; empty at the root. */
  get parent(): string {
    return this.rel.slice(0, Math.max(0, this.nameAt - 1));
  }

  /** The extension, lowercase, without the dot. */
  get extension(): string | null {
    if (this.dir) return null;
    const name = this.name;
    const at = name.lastIndexOf(".");
    return at <= 0 || at === name.length - 1 ? null : name.slice(at + 1).toLowerCase();
  }
}

/**
 * Every file and directory under `root`, alphabetically, without `SKIP`ed directories and without
 * following symlinks; at most `MAX_ENTRIES` of them, `MAX_DEPTH` directories deep.
 */
export function walk(root: string): Entry[] {
  const out: Entry[] = [];
  const stack: [dir: string, depth: number][] = [[root, 0]];
  while (stack.length > 0) {
    if (out.length >= MAX_ENTRIES) break;
    const [dir, depth] = stack.pop()!;
    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const below = relative(root, dir);
    const deeper: string[] = [];
    for (const child of children) {
      if (SKIP.includes(child.name)) continue;
      if (child.isSymbolicLink()) continue;
      const isDir = child.isDirectory();
      out.push(new Entry(below === "" ? child.name : `${below}/${child.name}`, isDir));
      if (isDir && depth < MAX_DEPTH) deeper.push(join(dir, child.name));
    }
    for (const child of deeper.reverse()) stack.push([child, depth + 1]);
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}
