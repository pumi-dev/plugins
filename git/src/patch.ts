// A unified patch, read: its files (as `git diff` writes them, or one bare `---`/`+++` pair), each
// with its numbered lines and what it adds up to, and the flat list of rows a view draws. One pass
// over the text, so a patch of a million lines reads in a moment. No `import … from "pumi"` here.

/** One line of a file's patch, with the numbers it has on each side. */
export interface DiffRow {
  kind: "add" | "del" | "context" | "hunk" | "note";
  text: string;
  old?: number;
  new?: number;
  /** Its text was cut to `MAX_LINE` characters; this many more were left out. */
  cut?: number;
}

export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "binary";

export interface FileDiff {
  /** Its path now (the old one for a deleted file). */
  path: string;
  /** Its path before, when it was renamed. */
  from?: string;
  status: FileStatus;
  added: number;
  removed: number;
  rows: DiffRow[];
}

/** The most of a line drawn; a minified file's one line is cut here. */
export const MAX_LINE = 2000;

/** The files of a patch. Text before the first file's header, and a bare patch, is one file. */
export function parsePatch(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let old = 0;
  let neu = 0;
  /** Inside a hunk: `-`/`+` lines are its, not a file's `---`/`+++` header. */
  let inHunk = false;
  /** The lines the hunk has still to come on each side, as its head says (`-3,2 +3,3`). */
  let leftOld = 0;
  let leftNew = 0;
  const start = (path: string): FileDiff => {
    file = { path, status: "modified", added: 0, removed: 0, rows: [] };
    files.push(file);
    inHunk = false;
    return file;
  };
  /** A line outside a hunk: a file's or a hunk's header. */
  const header = (line: string) => {
    if (line.startsWith("diff --git ")) {
      const b = line.lastIndexOf(" b/");
      start(b >= 0 ? line.slice(b + 3) : line.slice(11));
      return;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (hunk) {
      const f = file ?? start("");
      old = Number(hunk[1]);
      neu = Number(hunk[3]);
      leftOld = hunk[2] === undefined ? 1 : Number(hunk[2]);
      leftNew = hunk[4] === undefined ? 1 : Number(hunk[4]);
      inHunk = leftOld + leftNew > 0;
      f.rows.push({ kind: "hunk", text: hunk[5]! });
      return;
    }
    if (line.startsWith("--- ")) {
      // A bare patch's next file starts at its `---`; git's has said `diff --git` already.
      const f = file && file.rows.length === 0 ? file : start(pathOf(line.slice(4)));
      if (line.slice(4).trim() === "/dev/null") f.status = "added";
      return;
    }
    if (line.startsWith("+++ ")) {
      const f = file ?? start(pathOf(line.slice(4)));
      const to = line.slice(4).trim();
      if (to === "/dev/null") f.status = "deleted";
      else if (f.path === "") f.path = pathOf(to);
      return;
    }
    if (!file) return;
    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from ")) {
      file.from = line.slice(12);
      file.status = "renamed";
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      file.status = "binary";
      file.rows.push({ kind: "note", text: "Binary file" });
    }
  };
  const text = patch.endsWith("\n") ? patch.slice(0, -1) : patch;
  if (text === "") return [];
  let at = 0;
  while (at <= text.length) {
    let end = text.indexOf("\n", at);
    if (end < 0) end = text.length;
    const line = text.slice(at, end);
    at = end + 1;
    if (!inHunk || !file) {
      header(line);
      continue;
    }
    const mark = line.charCodeAt(0);
    if (mark === 43 /* + */ && leftNew > 0) {
      file.rows.push(cut({ kind: "add", text: line.slice(1), new: neu++ }));
      file.added++;
      leftNew--;
    } else if (mark === 45 /* - */ && leftOld > 0) {
      file.rows.push(cut({ kind: "del", text: line.slice(1), old: old++ }));
      file.removed++;
      leftOld--;
    } else if ((mark === 32 /* space */ || line === "") && leftOld > 0 && leftNew > 0) {
      file.rows.push(cut({ kind: "context", text: line.slice(1), old: old++, new: neu++ }));
      leftOld--;
      leftNew--;
    } else if (mark === 92 /* \ */) file.rows.push({ kind: "note", text: line.slice(1).trim() });
    else {
      // Not a hunk's line: the next hunk, or the next file's header.
      inHunk = false;
      header(line);
      continue;
    }
    // The hunk is over once its lines are in; a `\ No newline` note may still follow.
    if (leftOld === 0 && leftNew === 0) inHunk = text.charCodeAt(at) === 92;
  }
  return files.filter((each) => each.path !== "" || each.rows.length > 0);
}

/** `a/src/x.ts` as `src/x.ts`; a tab and what follows (a time stamp) left off. */
function pathOf(raw: string): string {
  const path = raw.split("\t")[0]!.trim();
  if (path === "/dev/null") return "";
  return /^[ab]\//.test(path) ? path.slice(2) : path;
}

function cut(row: DiffRow): DiffRow {
  if (row.text.length <= MAX_LINE) return row;
  return { ...row, text: row.text.slice(0, MAX_LINE), cut: row.text.length - MAX_LINE };
}

/** A one-file patch's rows (every file's, one after another). */
export function diffRows(patch: string): DiffRow[] {
  return parsePatch(patch).flatMap((file) => file.rows);
}

/** How many lines a patch adds and takes away. */
export function diffStats(patch: string): { added: number; removed: number } {
  return parsePatch(patch).reduce((sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }), { added: 0, removed: 0 });
}

/** One row of a whole patch as a list draws it: a file's head, or one of its lines. */
export type PatchItem = { type: "file"; file: FileDiff; index: number; folded: boolean } | { type: "row"; file: number; at: number; row: DiffRow };

/** The rows a patch view draws, with the folded files' lines left out. */
export function patchItems(files: FileDiff[], folded: ReadonlySet<string>): PatchItem[] {
  const items: PatchItem[] = [];
  files.forEach((file, index) => {
    const isFolded = folded.has(file.path);
    items.push({ type: "file", file, index, folded: isFolded });
    if (!isFolded) file.rows.forEach((row, at) => items.push({ type: "row", file: index, at, row }));
  });
  return items;
}

/** Lines past which a file starts folded, and the files that are generated (a lock file) start folded whatever their size. */
export const FOLD_LINES = 3000;
const GENERATED = /(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum|[^/]+\.min\.(js|css)|[^/]+\.map)$/;

/** The files a view folds at first: generated ones, and those too long to read through. */
export function foldedAtFirst(files: FileDiff[]): Set<string> {
  return new Set(files.filter((file) => files.length > 1 && (GENERATED.test(file.path) || file.rows.length > FOLD_LINES)).map((file) => file.path));
}

/** The widest line number a set of files has: how wide the gutter is. */
export function widestNumber(files: FileDiff[]): number {
  let most = 0;
  for (const file of files) {
    for (let at = file.rows.length - 1; at >= 0; at--) {
      const row = file.rows[at]!;
      const n = Math.max(row.old ?? 0, row.new ?? 0);
      if (n > 0) {
        most = Math.max(most, n);
        break;
      }
    }
  }
  return most;
}

/** A theme colour's `#rgb`, `#rrggbb` or `#rrggbbaa` as red, green, blue and alpha; nothing for anything else. */
function rgba(color: string | undefined): [number, number, number, number] | undefined {
  if (!color) return undefined;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
  if (full.length !== 6 && full.length !== 8) return undefined;
  const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [at(0), at(2), at(4), full.length === 8 ? at(6) : 255];
}

/** A theme colour (`#rgb`, `#rrggbb`, `#rrggbbaa`) at `alpha` of its own opacity: for washes. */
export function tint(color: string | undefined, alpha: number): string | undefined {
  if (!color) return undefined;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())?.[1];
  if (!hex) return color;
  const full = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
  const rgb = full.slice(0, 6);
  const base = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  const a = Math.round(Math.max(0, Math.min(1, alpha * base)) * 255);
  return `#${rgb}${a.toString(16).padStart(2, "0")}`;
}

/**
 * Two theme colours mixed: `color` `amount` (0–1) of the way toward `toward`, with `color`'s own
 * opacity kept — a block a step off the page it sits on, which a wash cannot make.
 */
export function blend(color: string | undefined, toward: string | undefined, amount: number): string | undefined {
  const from = rgba(color);
  const to = rgba(toward);
  if (!from || !to) return color;
  const k = Math.max(0, Math.min(1, amount));
  const at = (i: number) => Math.max(0, Math.min(255, Math.round(from[i]! + (to[i]! - from[i]!) * k)));
  const rgb = [at(0), at(1), at(2)].map((n) => n.toString(16).padStart(2, "0")).join("");
  return at(3) === 255 ? `#${rgb}` : `#${rgb}${at(3).toString(16).padStart(2, "0")}`;
}
