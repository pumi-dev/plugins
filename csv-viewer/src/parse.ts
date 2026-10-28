// A delimited file's text as a table: which character separates the fields, whether the first row
// is a header, the rows themselves, and what kind of value each column holds. Pure — no node, no
// `pumi` — so `bun test` runs it with nothing of the app running, and both halves of the plugin
// (the worker that reads the file, the view that sorts and searches it) share one answer.

/** What the `delimiter` option says: a character to use, or a guess. */
export type DelimiterChoice = "auto" | "comma" | "tab" | "semicolon" | "pipe";
/** What the `header` option says. */
export type HeaderChoice = "auto" | "first" | "none";
/** What a column holds, as far as sorting and alignment care. */
export type ColumnKind = "number" | "text";

/** The characters a guess weighs, and the name each is shown by. */
export const DELIMITERS: { name: Exclude<DelimiterChoice, "auto">; char: string }[] = [
  { name: "comma", char: "," },
  { name: "tab", char: "\t" },
  { name: "semicolon", char: ";" },
  { name: "pipe", char: "|" },
];

/** A file as a table. */
export interface ParsedTable {
  /** The column names, `Column 1`… where the file has no header. */
  headers: string[];
  /** Every row, padded to `headers.length`; a header row is not among them. */
  rows: string[][];
  /** What each column mostly holds, by index. */
  kinds: ColumnKind[];
  /** The separator used, as a character. */
  delimiter: string;
  /** What that character is called: `comma`, `tab`, `semicolon`, `pipe`. */
  delimiterName: Exclude<DelimiterChoice, "auto">;
  /** Whether the file's first record was taken as the names. */
  hasHeader: boolean;
  /** The file's record number of the first row drawn: 2 with a header, 1 without. */
  firstRow: number;
  /** How many records the file held, the header among them. */
  records: number;
  /** Rows left out for being past the row limit: `rows.length + this === records - (hasHeader ? 1 : 0)`. */
  leftOut: number;
  /** Rows whose field count was not the column count: padded, or cut. */
  ragged: number;
  /** Field count, after padding every row to the widest one. */
  columns: number;
}

export interface ParseOptions {
  delimiter?: DelimiterChoice;
  header?: HeaderChoice;
  quote?: string;
  maxRows?: number;
  maxColumns?: number;
}

const nameOf = (char: string): Exclude<DelimiterChoice, "auto"> => DELIMITERS.find((d) => d.char === char)?.name ?? "comma";
const charOf = (name: string): string | undefined => DELIMITERS.find((d) => d.name === name)?.char;

/** A file's extension as the separator it means, when the name says (`data.tsv` is tabs). */
export function byExtension(path: string): Exclude<DelimiterChoice, "auto"> | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = name.slice(name.lastIndexOf(".") + 1);
  if (ext === "tsv" || ext === "tab") return "tab";
  if (ext === "psv") return "pipe";
  if (ext === "csv" || ext === "dsv") return "comma";
  return undefined;
}

/** Whether `value` reads as a number: `42`, `-3.5`, `1,234.50`, `12%`, `$9.99`, `1e6`. */
export function isNumeric(value: string): boolean {
  const text = value.trim().replace(/^[$€£¥]\s?/, "");
  return text !== "" && /^[-+]?(\d[\d,_ ]*)(\.\d+)?([eE][-+]?\d+)?%?$/.test(text);
}

/** `value` as a number, or null when it is not one (`isNumeric` says). */
export function numberOf(value: string): number | null {
  if (!isNumeric(value)) return null;
  const text = value
    .trim()
    .replace(/^[$€£¥]\s?/, "")
    .replace(/[,_ ]/g, "")
    .replace(/%$/, "");
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Two cells in the order a table shows them: as numbers when the column holds numbers, else by a
 *  collator that reads `item 2` before `item 10`. Empty cells sort first. */
export function compareCells(a: string, b: string, kind: ColumnKind): number {
  if (a === b) return 0;
  if (a === "") return -1;
  if (b === "") return 1;
  if (kind === "number") {
    const x = numberOf(a);
    const y = numberOf(b);
    if (x !== null && y !== null) return x - y;
  }
  return collator.compare(a, b);
}

/** Whether a row holds every word of `query`, in any cell: what the search box asks. */
export function matchesRow(row: string[], query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  for (const term of terms) {
    let found = false;
    for (const cell of row) {
      if (cell.toLowerCase().includes(term)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * The records of `text`, split on `delimiter`: quoted fields keep their separators and line
 * breaks, `""` inside quotes is one quote, and a blank line is not a record. Stops keeping records
 * after `maxRows` (still counting them), and cuts each to `maxColumns` fields. With `spans`, says
 * where each kept record is in `text` too: from its first character to its line break (or the
 * end), which is what writing the file back keeps of the records an edit did not touch.
 */
export function records(
  text: string,
  delimiter: string,
  opts: { quote?: string; maxRows?: number; maxColumns?: number; spans?: boolean } = {},
): { rows: string[][]; total: number; dropped: number; ragged: number; starts: number[]; ends: number[] } {
  const quote = opts.quote ?? '"';
  const maxRows = opts.maxRows ?? Number.POSITIVE_INFINITY;
  const maxColumns = opts.maxColumns ?? 512;
  const spans = opts.spans === true;
  const rows: string[][] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let total = 0;
  let dropped = 0;
  let ragged = 0;
  let field = "";
  let row: string[] = [];
  let quoted = false;
  /** Where the record being read began. */
  let begun = 0;
  const keep = (end: number) => {
    row.push(field);
    field = "";
    // A line with nothing on it is not a record: a trailing newline makes one, and blank lines
    // between records are common.
    if (!(row.length === 1 && row[0] === "")) {
      total++;
      if (rows.length < maxRows) {
        if (row.length > maxColumns) {
          row.length = maxColumns;
          ragged++;
        }
        rows.push(row);
        if (spans) {
          starts.push(begun);
          ends.push(end);
        }
      } else dropped++;
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== quote) {
        field += c;
        continue;
      }
      if (text[i + 1] === quote) {
        field += quote;
        i++;
        continue;
      }
      quoted = false;
      continue;
    }
    // A quote only opens a field: `5" pipe` is a value with a quote in it.
    if (c === quote && field === "") {
      quoted = true;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      const end = i;
      if (c === "\r" && text[i + 1] === "\n") i++;
      keep(end);
      begun = i + 1;
      continue;
    }
    field += c;
  }
  if (field !== "" || row.length > 0) keep(text.length);
  return { rows, total, dropped, ragged, starts, ends };
}

/** The first `lines` records' worth of `text`, and no more than `limit` characters. */
function head(text: string, lines = 50, limit = 1 << 16): string {
  const end = Math.min(text.length, limit);
  let seen = 0;
  for (let i = 0; i < end; i++) {
    if (text[i] !== "\n") continue;
    if (++seen >= lines) return text.slice(0, i + 1);
  }
  return text.slice(0, end);
}

/** The value that shows up most among `counts` (the larger, on a tie). */
function mode(counts: number[]): number {
  const seen = new Map<number, number>();
  let best = 0;
  let bestN = 0;
  for (const n of counts) {
    const now = (seen.get(n) ?? 0) + 1;
    seen.set(n, now);
    if (now > bestN || (now === bestN && n > best)) {
      best = n;
      bestN = now;
    }
  }
  return best;
}

/**
 * The separator a file uses: for each candidate, the first records' field counts, scored by how
 * often they agree (a separator that splits rows the same way is the one) and how many fields
 * they make. `hint` (from the file's extension) wins a tie, so a one-row `a,b,c.tsv` is tabs.
 */
export function sniffDelimiter(text: string, hint?: Exclude<DelimiterChoice, "auto">): Exclude<DelimiterChoice, "auto"> {
  const sample = head(text);
  const candidates = hint ? [DELIMITERS.find((d) => d.name === hint)!, ...DELIMITERS.filter((d) => d.name !== hint)] : DELIMITERS;
  let best: { name: Exclude<DelimiterChoice, "auto">; score: number } | null = null;
  for (const { name, char } of candidates) {
    const counts = records(sample, char, { maxRows: 50 }).rows.map((row) => row.length);
    const modal = mode(counts);
    // A separator that leaves a record whole is not the one the file uses.
    if (modal < 2) continue;
    // What agrees counts for more than what is wide: text with commas in it splits unevenly.
    const agree = counts.filter((n) => n === modal).length / counts.length;
    const score = agree * 100 + Math.min(modal, 50);
    if (best === null || score > best.score) best = { name, score };
  }
  return best?.name ?? hint ?? "comma";
}

/** Whether `rows[0]` reads as column names: every cell filled, none repeated, and no numbers in it
 *  while the rows under it hold them. A file with no numbers at all is taken to have a header too,
 *  which a list of plain values is not — the `header` option settles it either way. */
export function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  const first = rows[0]!;
  if (first.length === 0) return false;
  if (first.some((value) => value.trim() === "")) return false;
  const seen = new Set<string>();
  for (const value of first) {
    const name = value.trim().toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
  }
  const below = rows.slice(1, 51);
  if (below.length === 0) return true;
  const numericFirst = first.filter(isNumeric).length;
  if (numericFirst > 0) return false;
  let numericColumn = false;
  for (let column = 0; column < first.length && !numericColumn; column++) {
    let numbers = 0;
    let filled = 0;
    for (const row of below) {
      const value = row[column] ?? "";
      if (value.trim() === "") continue;
      filled++;
      if (isNumeric(value)) numbers++;
    }
    if (filled > 0 && numbers / filled >= 0.6) numericColumn = true;
  }
  return numericColumn || below.every((row) => row.every((value) => !isNumeric(value)));
}

/** What each column mostly holds: a number, or text. */
export function columnKinds(rows: string[][], columns: number): ColumnKind[] {
  const kinds: ColumnKind[] = [];
  for (let column = 0; column < columns; column++) {
    let numbers = 0;
    let filled = 0;
    for (let i = 0; i < rows.length && filled < 200; i++) {
      const value = rows[i]![column] ?? "";
      if (value.trim() === "") continue;
      filled++;
      if (isNumeric(value)) numbers++;
    }
    kinds.push(filled > 0 && numbers / filled >= 0.8 ? "number" : "text");
  }
  return kinds;
}

/** Pads every row to `columns` fields, so a cell is always there to read. */
function pad(rows: string[][], columns: number): void {
  for (const row of rows) while (row.length < columns) row.push("");
}

/** How many fields the table has: the widest record, the header included. */
function widest(rows: string[][]): number {
  let columns = 0;
  for (const row of rows) if (row.length > columns) columns = row.length;
  return columns;
}

/**
 * `text` as a table, by the options the manifest gives and the file's name (`path`), which says
 * what the extension means. The header is the first record unless the file looks headless or the
 * option says it has none; a file without one gets `Column 1`… for names.
 */
export function buildTable(text: string, path: string, opts: ParseOptions = {}): ParsedTable {
  const headerChoice = opts.header ?? "auto";
  const wanted = opts.delimiter ?? "auto";
  const hint = byExtension(path);
  const delimiterName = wanted === "auto" ? sniffDelimiter(text, hint) : (wanted as Exclude<DelimiterChoice, "auto">);
  const delimiter = charOf(delimiterName) ?? ",";
  const parsed = records(text, delimiter, {
    quote: opts.quote,
    // One more than the rows it will show: with a header, the rows wanted are the records less it.
    maxRows: (opts.maxRows ?? 100_000) + 1,
    maxColumns: opts.maxColumns,
  });
  const all = parsed.rows;
  const hasHeader = headerChoice === "first" ? all.length > 0 : headerChoice === "none" ? false : looksLikeHeader(all);
  const head = hasHeader ? (all[0] ?? []) : [];
  const rows = hasHeader ? all.slice(1) : all;
  const columns = Math.max(head.length, widest(rows));
  // A record shorter than the table (or longer: the header sets the width) is filled, and said.
  let ragged = 0;
  for (const row of rows) if (row.length !== columns) ragged++;
  if (hasHeader && head.length !== columns) ragged++;
  const headers: string[] = [];
  for (let column = 0; column < columns; column++) {
    const name = head[column];
    headers.push(name !== undefined && name !== "" ? name : `Column ${column + 1}`);
  }
  pad(rows, columns);
  return {
    headers,
    rows,
    kinds: columnKinds(rows, columns),
    delimiter,
    delimiterName,
    hasHeader,
    firstRow: hasHeader ? 2 : 1,
    records: Math.max(parsed.total, all.length),
    leftOut: Math.max(0, parsed.total - (hasHeader ? 1 : 0) - rows.length),
    ragged,
    columns,
  };
}
