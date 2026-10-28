// What the tree hides. A directory is read for a `.gitignore` when
// it is listed, that file's patterns are stacked on the ones above it, and an entry is ignored when
// the innermost file that says anything about it says so — git's own rule.
//
// The patterns are git's: `#` comments, blank lines, `!` to bring something back, a leading `/` to
// anchor to the file's own directory, a trailing `/` for directories only, and `*`, `?`, `**` and
// `[…]` for the rest. `\` escapes the next character.
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import * as rel from "./relpath.ts";

/** One line of a `.gitignore`, ready to test a path against. */
interface Rule {
  regex: RegExp;
  /** `!`: it brings a path back rather than hiding it. */
  negate: boolean;
  /** The pattern ended with `/`: it is about directories. */
  dirOnly: boolean;
}

/** A `.gitignore`'s patterns, matched against paths below the directory that holds it. */
class Gitignore {
  private constructor(
    readonly dir: string,
    private readonly rules: Rule[],
  ) {}

  static read(file: string, dir: string): Gitignore | null {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return null;
    }
    const rules: Rule[] = [];
    for (const line of text.split("\n")) {
      const rule = parseRule(line);
      if (rule) rules.push(rule);
    }
    return new Gitignore(dir, rules);
  }

  /** `"ignore"`, `"white"` (brought back) or `null` (nothing said): the last rule that matches wins,
   * as in git. */
  match(abs: string, isDir: boolean): "ignore" | "white" | null {
    const inside = relative(this.dir, abs).split(sep).join("/");
    if (inside === "" || inside.startsWith("..")) return null;
    let said: "ignore" | "white" | null = null;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) continue;
      if (!rule.regex.test(inside)) continue;
      said = rule.negate ? "white" : "ignore";
    }
    return said;
  }
}

/** The patterns of one line; `null` for a comment or a blank. */
function parseRule(line: string): Rule | null {
  let text = line.replace(/\r$/, "");
  if (text === "" || text.startsWith("#")) return null;
  // A trailing space is not part of the pattern unless it was escaped.
  text = text.replace(/(?<!\\) +$/, "");
  if (text === "") return null;
  let negate = false;
  if (text.startsWith("!")) {
    negate = true;
    text = text.slice(1);
  }
  let dirOnly = false;
  if (text.endsWith("/")) {
    dirOnly = true;
    text = text.slice(0, -1);
  }
  if (text === "") return null;
  const anchored = text.startsWith("/") || text.slice(0, -1).includes("/");
  if (text.startsWith("/")) text = text.slice(1);
  const body = globToRegex(text);
  // A pattern with no separator in it matches at any depth; an anchored one only where it is.
  const regex = new RegExp(anchored ? `^${body}$` : `(^|/)${body}$`);
  return { regex, negate, dirOnly };
}

/** A gitignore glob as a regular expression over a `/`-separated path. */
function globToRegex(pattern: string): string {
  let out = "";
  for (let at = 0; at < pattern.length; at++) {
    const ch = pattern[at]!;
    if (ch === "\\" && at + 1 < pattern.length) {
      out += escapeRegex(pattern[++at]!);
      continue;
    }
    if (ch === "*") {
      if (pattern[at + 1] === "*") {
        const afterSlash = at === 0 || pattern[at - 1] === "/";
        const next = pattern[at + 2];
        if (afterSlash && next === "/") {
          // `**/`: no directory, or any number of them.
          out += "(?:.*/)?";
          at += 2;
          continue;
        }
        if (afterSlash && next === undefined) {
          // A trailing `**`: everything from here down.
          out += ".*";
          at += 1;
          continue;
        }
        out += ".*";
        at += 1;
        continue;
      }
      out += "[^/]*";
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if (ch === "[") {
      const end = pattern.indexOf("]", at + 1);
      if (end > at + 1) {
        let body = pattern.slice(at + 1, end);
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        out += `[${body.replaceAll("\\", "\\\\")}]`;
        at = end;
        continue;
      }
    }
    out += escapeRegex(ch);
  }
  return out;
}

function escapeRegex(ch: string): string {
  return ".+^$(){}|[]\\/*?".includes(ch) ? `\\${ch}` : ch;
}

/**
 * The ignore rules over a directory: its own `.gitignore` and every one above it, plus the
 * repository's `.git/info/exclude`. Innermost first, as git reads them.
 */
export class IgnoreStack {
  private constructor(private readonly files: Gitignore[]) {}

  static none(): IgnoreStack {
    return new IgnoreStack([]);
  }

  /** The stack for one more directory, `dir`, below the one `parent` was read for. */
  static child(parent: IgnoreStack, dir: string): IgnoreStack {
    const own = Gitignore.read(join(dir, ".gitignore"), dir);
    return own ? new IgnoreStack([own, ...parent.files]) : parent;
  }

  /** The stack a project root starts with: the repository's exclude file, then the root's own. */
  static root(root: string): IgnoreStack {
    const exclude = Gitignore.read(join(root, ".git/info/exclude"), root);
    return IgnoreStack.child(exclude ? new IgnoreStack([exclude]) : IgnoreStack.none(), root);
  }

  /** Whether `abs` is ignored, and the directory above it was not: an entry inside an ignored
   * directory is ignored with it, which the tree carries down itself. */
  isIgnored(abs: string, isDir: boolean): boolean {
    if (isDir && rel.fileName(abs) === ".git") return true;
    for (const file of this.files) {
      const said = file.match(abs, isDir);
      if (said === "ignore") return true;
      if (said === "white") return false;
    }
    return false;
  }
}
