// csv: a delimited file in a tab, as a table — its manifest's `renderers.file` claims `*.csv`,
// `*.tsv`, `*.tab`, `*.psv` and `*.dsv`, so opening one anywhere (`pumi open data.csv`, the
// project tree, the palette) draws the table (`ui.tsx`, with TanStack Table) instead of text.
//
//   pumi open data.csv                       # a file tab on the right of this one, as a table
//   pumi call amresyd.csv.open                # the same, choosing the file in a picker
//   pumi call amresyd.csv.reload %7           # read the file tab %7 shows again
//
// This half holds the disk: it reads the file (the parsing itself is `parse.ts`, which knows
// nothing of pumi), watches it when the option says so, and says when it changed so the table's
// component reads it again. That component holds nothing but the table it draws.
import { readFileSync, statSync, unwatchFile, watchFile } from "node:fs";
import { ApiError, fn, fs, option, ui, workspace, type TabId } from "pumi";
import { buildTable, type DelimiterChoice, type HeaderChoice, type ParsedTable } from "./parse.ts";

/** A file bigger than this is not read: the table would hold it all, in a view that draws it. */
const LIMIT = 64 * 1024 * 1024;
/** The widest table read: a file of thousands of columns is a mistake, not something to show. */
const MAX_COLUMNS = 256;
/** How many files are watched at once, and how often each is looked at (ms). */
const WATCHERS = 32;
const EVERY = 700;
/** The channel the view hears: `{path}` of a file that changed or was asked to be read again. */
const TOPIC = "changed";

/** A file, read and parsed: what the view draws. */
export interface Loaded extends ParsedTable {
  path: string;
  /** The file's size in bytes, and when it last changed (ms since the epoch). */
  bytes: number;
  mtime: number;
  /** What is not shown, and why: rows past the limit, records of another width. */
  notes: string[];
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

/** A path a call was given, or the error saying what it should have been. */
function pathOf(what: unknown): string {
  if (typeof what !== "string" || what === "") throw new ApiError("invalid_params", "no file: give the path of one to read");
  return what;
}

/**
 * The file at `path`, parsed as the options say. Answers the table its tab's component draws, or
 * throws with what went wrong (missing, a folder, too big, not text).
 */
export async function read(path: string): Promise<Loaded> {
  let file = "";
  try {
    file = pathOf(path);
  } catch (err) {
    throw new ApiError("invalid_params", message(err));
  }
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
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const opts = await options();
  const table = buildTable(text, file, { header: opts.header, delimiter: opts.delimiter, maxRows: opts.maxRows, maxColumns: MAX_COLUMNS });
  const notes: string[] = [];
  if (table.leftOut > 0) notes.push(`the first ${table.rows.length.toLocaleString()} of ${(table.records - (table.hasHeader ? 1 : 0)).toLocaleString()} rows: “Rows at most” in Settings raises it`);
  if (table.ragged > 0) notes.push(`${table.ragged.toLocaleString()} ${table.ragged === 1 ? "record has" : "records have"} a different number of fields from the others, and were padded`);
  if (table.columns >= MAX_COLUMNS) notes.push(`only the first ${MAX_COLUMNS} columns`);
  return { ...table, path: file, bytes: info.size, mtime: info.mtimeMs, notes };
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
 * drawing cannot answer — in the plugin's log, where `pumi plugin logs csv` finds it. A worker's
 * `console` is that log.
 */
export async function note(line: string): Promise<null> {
  console.error(String(line));
  return null;
}
