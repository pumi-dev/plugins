// csv-viewer: a delimited file in a tab, as a table — its manifest's `renderers.file` claims `*.csv`,
// `*.tsv`, `*.tab`, `*.psv` and `*.dsv`, so opening one anywhere (`pumi open data.csv`, the
// project tree, the palette) draws the table (`ui.tsx`, with TanStack Table) instead of text.
//
//   pumi open data.csv                       # a file tab on the right of this one, as a table
//   pumi call pumi_dev.csv_viewer.open       # the same, choosing the file in a picker
//   pumi call pumi_dev.csv_viewer.reload %7  # read the file tab %7 shows again
//
// This half holds the disk: it reads the file (the parsing itself is `parse.ts`, which knows
// nothing of pumi), watches it when the option says so, says when it changed so the table's
// component reads it again, and writes it back when that component saves its edits (`save`,
// with `write.ts` putting the text together). The component holds the table it draws and the
// edits made to it.
import { readFileSync, statSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { ApiError, fn, fs, option, ui, workspace, type TabId } from "pumi";
import type { WireOp } from "./edit.ts";
import { DELIMITERS, buildTable, type DelimiterChoice, type HeaderChoice, type ParsedTable } from "./parse.ts";
import { rewrite } from "./write.ts";

/** A file bigger than this is not read: the table would hold it all, in a view that draws it. */
const LIMIT = 64 * 1024 * 1024;
/** The widest table read: a file of thousands of columns is a mistake, not something to show. */
const MAX_COLUMNS = 256;
/** How many files are watched at once, and how often each is looked at (ms). */
const WATCHERS = 32;
const EVERY = 700;
/** The channel the view hears: `{path, mtime}` of a file that changed, or `{path}` of one asked
 *  to be read again. */
const TOPIC = "changed";

/** A file, read and parsed: what the view draws. */
export interface Loaded extends ParsedTable {
  path: string;
  /** The file's size in bytes, and when it last changed (ms since the epoch). */
  bytes: number;
  mtime: number;
  /** What is not shown, and why: rows past the limit, records of another width. */
  notes: string[];
  /** Whether a save may write it: false for a file that is not UTF-8 throughout. */
  writable: boolean;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The options this plugin declares, as the manifest keeps them. */
interface Options {
  header: HeaderChoice;
  delimiter: DelimiterChoice;
  maxRows: number;
}

async function options(): Promise<Options> {
  const [header, delimiter, maxRows] = await Promise.all([option.get("header"), option.get("delimiter"), option.get("max_rows")]);
  return {
    header: header === "first" || header === "none" ? header : "auto",
    delimiter: delimiter === "comma" || delimiter === "tab" || delimiter === "semicolon" || delimiter === "pipe" ? delimiter : "auto",
    maxRows: typeof maxRows === "number" && Number.isFinite(maxRows) ? Math.max(1, Math.round(maxRows)) : 100_000,
  };
}

/** How the table read a file, as the options name it: what a tab that saved its edits keeps
 *  reading the file as, so its own edits do not change the guess (a column of numbers edited to
 *  words would make the header look like a row). */
export interface ReadAs {
  header: "first" | "none";
  delimiter: Exclude<DelimiterChoice, "auto">;
}

/** A file's text, as read. */
interface Text {
  text: string;
  /** It began with a byte order mark, which `text` does not hold and a save writes again. */
  bom: boolean;
  /** It was UTF-8 throughout: a file that was not is shown, but not written over, since the
   *  bytes that were not are shown as `�` and would be saved as that. */
  exact: boolean;
}

/** The text of the files read lately, by path and change time: what a save replays its edits on,
 *  and what "overwrite" writes over a file that changed since it was read. A few, and not too
 *  much text between them. */
const held = new Map<string, Text>();
const HELD = 4;
const HELD_CHARS = 64 * 1024 * 1024;
const heldKey = (path: string, mtime: number) => `${path}\0${mtime}`;

function hold(path: string, mtime: number, text: Text): void {
  const key = heldKey(path, mtime);
  held.delete(key);
  held.set(key, text);
  let chars = 0;
  for (const entry of held.values()) chars += entry.text.length;
  for (const [k, entry] of held) {
    if (held.size <= HELD && chars <= HELD_CHARS) break;
    if (k === key) continue;
    held.delete(k);
    chars -= entry.text.length;
  }
}

/** A path a call was given, or the error saying what it should have been. */
function pathOf(what: unknown): string {
  if (typeof what !== "string" || what === "") throw new ApiError("invalid_params", "no file: give the path of one to read");
  return what;
}

/** The text of the file at `path` now, and when it last changed; throws with what went wrong
 *  (missing, a folder, too big, not text). */
function textOf(file: string): Text & { mtime: number; size: number } {
  let info;
  try {
    info = statSync(file);
  } catch {
    throw new ApiError("not_found", `no such file: ${file}`);
  }
  if (info.isDirectory()) throw new ApiError("invalid_params", `${file} is a folder`);
  if (info.size > LIMIT) throw new ApiError("invalid_params", `${file} is ${Math.round(info.size / 1024 / 1024)} MB: the table reads files up to ${LIMIT / 1024 / 1024} MB`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(file));
  } catch (err) {
    throw new ApiError("exception", `${file}: ${message(err)}`);
  }
  // A NUL in the first page of a file is how a binary one looks; CSV is text all the way through.
  if (bytes.subarray(0, 8192).includes(0)) throw new ApiError("invalid_params", `${file} is not text`);
  let decoded: string;
  let exact = true;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    decoded = new TextDecoder().decode(bytes);
    exact = false;
  }
  const bom = decoded.startsWith("\uFEFF");
  return { text: bom ? decoded.slice(1) : decoded, bom, exact, mtime: info.mtimeMs, size: info.size };
}

/**
 * The file at `path`, parsed as the options say, or as `as` says (a tab that saved its edits
 * reads the file as it did before). Answers the table its tab's component draws, or throws with
 * what went wrong (missing, a folder, too big, not text).
 */
export async function read(path: string, as?: ReadAs | null): Promise<Loaded> {
  const file = pathOf(path);
  const now = textOf(file);
  hold(file, now.mtime, now);
  const opts = await options();
  const header = as?.header === "first" || as?.header === "none" ? as.header : opts.header;
  const delimiter = as && DELIMITERS.some((d) => d.name === as.delimiter) ? as.delimiter : opts.delimiter;
  const table = buildTable(now.text, file, { header, delimiter, maxRows: opts.maxRows, maxColumns: MAX_COLUMNS });
  const notes: string[] = [];
  if (table.leftOut > 0) notes.push(`the first ${table.rows.length.toLocaleString()} of ${(table.records - (table.hasHeader ? 1 : 0)).toLocaleString()} rows: “Rows at most” in Settings raises it`);
  if (table.ragged > 0) notes.push(`${table.ragged.toLocaleString()} ${table.ragged === 1 ? "record has" : "records have"} a different number of fields from the others, and were padded`);
  if (table.columns >= MAX_COLUMNS) notes.push(`only the first ${MAX_COLUMNS} columns`);
  if (!now.exact) notes.push("not UTF-8: shown, but not saved");
  return { ...table, path: file, bytes: now.size, mtime: now.mtime, notes, writable: now.exact };
}

// ---- writing the file back

/** What the table's component asks a save to do. */
export interface SaveRequest {
  path: string;
  /** When the file it edited last changed, as `read` said: a file changed since is not written
   *  over unless `force` says so. */
  mtime: number;
  /** The separator, and whether the first record is the names, as the table read the file. */
  delimiter: string;
  hasHeader: boolean;
  /** The edits, oldest first. */
  ops: WireOp[];
  force?: boolean;
  /** Who saves (a tab id): every other tab showing the file is told it changed, and this one is
   *  not, since it reads the file again itself. */
  from?: string;
}

/** What a save did: wrote the file (and when it now changed), or did not, because the file
 *  changed since it was read (`changed`), or because the text it was read as is no longer held
 *  to write the edits over (`lost`, for a forced save). */
export type Saved = { ok: true; mtime: number; bytes: number } | { ok: false; why: "changed" | "lost" };

/**
 * Write the table's edits into the file: replayed on every record of the text it was read from,
 * so rows past the row limit and columns past the table's width are kept, and records no edit
 * touched are written as they were.
 */
export async function save(request: SaveRequest): Promise<Saved> {
  const file = pathOf(request?.path);
  if (!Array.isArray(request.ops)) throw new ApiError("invalid_params", "no edits to save");
  if (!DELIMITERS.some((d) => d.char === request.delimiter)) throw new ApiError("invalid_params", `not a separator the table reads: ${JSON.stringify(request.delimiter)}`);
  const now = textOf(file);
  const changed = now.mtime !== request.mtime;
  if (changed && request.force !== true) return { ok: false, why: "changed" };
  // The text the edits were made on: what was read then (held), or the file as it is when it has
  // not changed since.
  const base = held.get(heldKey(file, request.mtime)) ?? (changed ? null : now);
  if (base === null) return { ok: false, why: "lost" };
  if (!base.exact) throw new ApiError("invalid_params", `${file} is not UTF-8 throughout: saving it would change the bytes that are not`);
  let out: string;
  try {
    out = rewrite(base.text, request.ops, { delimiter: request.delimiter, hasHeader: request.hasHeader === true });
  } catch (err) {
    throw new ApiError("invalid_params", `${file}: ${message(err)}`);
  }
  try {
    writeFileSync(file, base.bom ? `\uFEFF${out}` : out);
  } catch (err) {
    throw new ApiError("exception", `${file}: ${message(err)}`);
  }
  const info = statSync(file);
  // The watcher does not say this write changed the file (it is said here, once, with who made
  // it), and the text written is what the next save starts from.
  const watched = watching.get(file);
  if (watched) watched.mtime = info.mtimeMs;
  hold(file, info.mtimeMs, { text: out, bom: base.bom, exact: true });
  ui.post(TOPIC, { path: file, mtime: info.mtimeMs, from: typeof request.from === "string" ? request.from : null });
  return { ok: true, mtime: info.mtimeMs, bytes: info.size };
}

// ---- watching the file

interface Watch {
  count: number;
  /** The change time last said, so one write is said once. */
  mtime: number;
}

const watching = new Map<string, Watch>();

/**
 * Say, on the `changed` channel, when the file at `path` changes: a script that regenerates it is
 * what this is for. A tab's component asks for this when it draws the file, and stops it when it
 * is closed; a path is watched while any tab shows it. `async` so the component may await it: a
 * worker export is a promise on the other side.
 */
export async function watch(path: string): Promise<null> {
  const file = pathOf(path);
  const had = watching.get(file);
  if (had) {
    had.count += 1;
    return null;
  }
  if (watching.size >= WATCHERS) return null;
  let seen = 0;
  try {
    seen = statSync(file).mtimeMs;
  } catch {
    // A file that is gone is not watched: reading it said so already.
    return null;
  }
  watching.set(file, { count: 1, mtime: seen });
  watchFile(file, { interval: EVERY, persistent: false }, (now) => {
    const entry = watching.get(file);
    // One write is said once, however many times it is looked at.
    if (!entry || now.mtimeMs === entry.mtime) return;
    entry.mtime = now.mtimeMs;
    ui.post(TOPIC, { path: file });
  });
  return null;
}

/** Stop watching the file at `path` for one tab: it changes nothing once no tab shows it. */
export async function unwatch(path: string): Promise<null> {
  if (typeof path !== "string" || path === "") return null;
  const entry = watching.get(path);
  if (!entry) return null;
  entry.count -= 1;
  if (entry.count > 0) return null;
  watching.delete(path);
  unwatchFile(path);
  return null;
}

/** Read every open tab showing `path` again, now: what `reload` asks of them. */
function again(path: string): void {
  ui.post(TOPIC, { path });
}

// ---- what the app reaches

/** A tab a call names: `"%7"`, `{ tab: "%7" }`, or `7`. */
function tabOf(what: unknown): TabId | undefined {
  const named = typeof what === "object" && what !== null ? (what as { tab?: unknown }).tab : what;
  if (named === undefined || named === null) return undefined;
  const id = typeof named === "number" ? `%${named}` : named;
  if (typeof id !== "string" || !/^(?:[A-Za-z0-9._-]+\/)?%[1-9][0-9]*$/.test(id)) return undefined;
  return id as TabId;
}

/** The file a file tab shows, by the core's `path` option of it. */
async function pathIn(tab: TabId): Promise<string | null> {
  const path = await option.get("path", { scope: "tab", id: tab }).catch(() => null);
  return typeof path === "string" && path !== "" ? path : null;
}

/**
 * The manifest's `reload` command: read the file of the tab it was pressed in (or the one it
 * names) again, which is what a script's rewrite needs when `Follow the file` is off.
 */
export async function reload(what?: unknown): Promise<null> {
  await workspace.ready.catch(() => undefined);
  const tab = tabOf(what) ?? workspace.currentTab?.id;
  if (tab === undefined) return null;
  const path = await pathIn(tab);
  if (path === null) return null;
  again(path);
  return null;
}

fn.set(
  "reload",
  {
    desc: "Read the file a CSV tab shows again.",
    effect: "read",
    parameters: [["string", "tab"]],
    examples: [{ args: [], desc: "The current tab, if it shows a CSV file." }, { args: ["%7"] }, { args: [{ tab: "%7" }] }],
    returns: "Nothing.",
  },
  (what?: unknown) => reload(what),
);

/**
 * The manifest's `open` command: choose a file and show it as a table, in a view of its own — the
 * way into the viewer that does not start at a file already open somewhere.
 */
async function open(): Promise<TabId | null> {
  const picked = await fs.pick({ kind: "file", title: "Open a CSV file" }).catch(() => null);
  const first = Array.isArray(picked) ? picked[0] : picked;
  if (typeof first !== "string" || first === "") return null;
  const tab = await workspace.openTab("file", { path: first }, { kind: "view" });
  return (tab?.id ?? null) as TabId | null;
}

fn.set(
  "open",
  {
    desc: "Choose a CSV file and show it as a table, in a view.",
    effect: "write",
    examples: [{ args: [], desc: "A native file picker." }],
    returns: "The tab it opened, or null when nothing was chosen.",
  },
  () => open(),
);

/**
 * What its `ui.tsx` says about itself when something goes wrong there — a throw the table's
 * drawing cannot answer — in the plugin's log, where `pumi plugin logs pumi_dev/csv-viewer` finds
 * it. A worker's `console` is that log.
 */
export async function note(line: string): Promise<null> {
  console.error(String(line));
  return null;
}
