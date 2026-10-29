// Walking a project's files: everything under the
// root except what a `.gitignore` (or a `.ignore`) leaves out, and `.git` itself; dotfiles included,
// symlinks not followed. The rules are read here and matched by a small translation of git's glob syntax.
//
// The walk is stepped rather than run: a big tree read in one go would hold the worker and with it
// the palette's drawing, so each step reads for a slice of time and hands back, and the palette
// shows what it has and keeps going, as the core's does with its timer.
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** The most files an index holds (the core's `MAX_FILES`): a tree past this is cut short. */
export const MAX_FILES = 200_000;
/** How long one step may read for, in milliseconds (the core's `SLICE`). */
export const SLICE = 12;

/** One rule of a `.gitignore`: a pattern, whether it leaves things out or takes them back, and
 * whether it is about directories only. */
interface Rule {
  pattern: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

/** git's glob syntax, as far as a `.gitignore` uses it: `**` across directories, `*` and `?` within
 * one, `[a-z]`, a leading `/` pinning the pattern to the directory the file is in, and a trailing
 * `/` for directories only. */
function compile(pattern: string): RegExp | null {
  let text = pattern;
  const pinned = text.startsWith("/") || text.includes("/");
  if (text.startsWith("/")) text = text.slice(1);
  let out = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (char === "*") {
      if (text[at + 1] === "*") {
        at++;
        if (text[at + 1] === "/") {
          at++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    if (char === "[") {
      const end = text.indexOf("]", at + 1);
      if (end > at) {
        let body = text.slice(at + 1, end);
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        out += `[${body}]`;
        at = end;
        continue;
      }
    }
    if (char === "\\" && at + 1 < text.length) {
      at++;
      out += escape(text[at]!);
      continue;
    }
    out += escape(char);
  }
  try {
    return new RegExp(pinned ? `^${out}$` : `(?:^|/)${out}$`);
  } catch {
    return null;
  }
}

function escape(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The rules a `.gitignore` or a `.ignore` holds. */
function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split("\n")) {
    let body = line.replace(/\r$/, "");
    if (body === "" || body.startsWith("#")) continue;
    // A trailing space is part of the pattern only when a backslash escapes it.
    body = body.replace(/(?<!\\) +$/, "");
    let negate = false;
    if (body.startsWith("!")) {
      negate = true;
      body = body.slice(1);
    }
    const dirOnly = body.endsWith("/");
    if (dirOnly) body = body.slice(0, -1);
    if (body === "") continue;
    const pattern = compile(body);
    if (pattern !== null) rules.push({ pattern, negate, dirOnly });
  }
  return rules;
}

/**
 * The rules in force under one root: each directory's `.gitignore` and `.ignore`, read once and
 * remembered, with the deepest file that says anything about a path deciding it — as git does.
 */
export class Ignorers {
  private readonly known = new Map<string, Rule[]>();

  constructor(private readonly root: string) {}

  /** The rules written in directory `rel` (`""` is the root), read on first asking. */
  private async rulesIn(rel: string): Promise<Rule[]> {
    const known = this.known.get(rel);
    if (known !== undefined) return known;
    const rules: Rule[] = [];
    for (const name of [".gitignore", ".ignore"]) {
      try {
        rules.push(...parseRules(await readFile(join(this.root, rel, name), "utf8")));
      } catch {
        // No such file, or it cannot be read: nothing it leaves out.
      }
    }
    this.known.set(rel, rules);
    return rules;
  }

  /** Whether `rel` (a directory when `dir` says so) is left out. */
  async ignored(rel: string, dir: boolean): Promise<boolean> {
    const parts = rel.split("/");
    for (let depth = parts.length - 1; depth >= 0; depth--) {
      const rules = await this.rulesIn(parts.slice(0, depth).join("/"));
      if (rules.length === 0) continue;
      const within = parts.slice(depth).join("/");
      for (let at = rules.length - 1; at >= 0; at--) {
        const rule = rules[at]!;
        if (rule.dirOnly && !dir) continue;
        if (rule.pattern.test(within)) return !rule.negate;
      }
    }
    return false;
  }
}

/** A directory of the walk whose names are being taken, and how far along them it got. */
interface Step {
  rel: string;
  entries: string[];
  at: number;
}

/** A walk of one root, taken a step at a time. */
export class Walk {
  private readonly ignore: Ignorers;
  private readonly stack: Step[] = [];
  private started = false;
  /** It stopped at `MAX_FILES`: what it has is not all there is. */
  truncated = false;

  constructor(readonly root: string) {
    this.ignore = new Ignorers(root);
  }

  /** Reads for up to `slice` milliseconds, adding the path of each file it meets to `into` (from the
   * root, `/` between the parts); `true` while there is more to read. */
  async step(into: string[], slice = SLICE): Promise<boolean> {
    const until = Date.now() + slice;
    if (!this.started) {
      this.started = true;
      await this.open("");
    }
    while (this.stack.length > 0) {
      const dir = this.stack[this.stack.length - 1]!;
      if (dir.at >= dir.entries.length) {
        this.stack.pop();
        continue;
      }
      if (into.length >= MAX_FILES) {
        this.truncated = true;
        this.stack.length = 0;
        return false;
      }
      if (Date.now() >= until) return true;
      const name = dir.entries[dir.at++]!;
      const rel = dir.rel === "" ? name : `${dir.rel}/${name}`;
      const path = join(this.root, rel);
      let kind;
      try {
        kind = await lstat(path);
      } catch {
        continue;
      }
      // A link is not followed into (`follow_links(false)`), but a link to a file is a file.
      if (kind.isSymbolicLink()) {
        try {
          kind = await stat(path);
        } catch {
          continue;
        }
        if (!kind.isFile()) continue;
      }
      if (kind.isDirectory()) {
        if (!(await this.ignore.ignored(rel, true))) await this.open(rel);
      } else if (kind.isFile()) {
        if (!(await this.ignore.ignored(rel, false))) into.push(rel);
      }
    }
    return false;
  }

  /** Reads directory `rel`'s names, sorted, and puts it at the front of the walk: `.git` is never
   * read, and a name the walk cannot read is left out. */
  private async open(rel: string): Promise<void> {
    let entries: string[];
    try {
      entries = (await readdir(join(this.root, rel), { withFileTypes: true }))
        .filter((entry) => entry.name !== ".git")
        .map((entry) => entry.name)
        .sort();
    } catch {
      return;
    }
    this.stack.push({ rel, entries, at: 0 });
  }
}
