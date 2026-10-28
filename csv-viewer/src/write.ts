// Writing a file back after edits: the worker reads it again whole (every row, every column, not
// only those the table shows), replays the edits on its records, and puts the text together again.
// A record no edit touched is written as it was, quotes and all, and so is everything between
// records (line breaks, blank lines), so a one-cell edit changes one line of the file. Pure, like
// `parse.ts`: `bun test` runs it.
import type { WireOp } from "./edit.ts";
import { records } from "./parse.ts";

/** A record of the file, and where it was in the text (`start` -1 for a new one). */
export interface Rec {
  fields: string[];
  start: number;
  end: number;
  /** What came after it up to the next record: its line break, and any blank lines. */
  gap: string;
  /** An edit changed it, so it is written from its fields. */
  touched: boolean;
}

/** Every record of `text`, with where each is. */
export function recordsOf(text: string, delimiter: string): Rec[] {
  const read = records(text, delimiter, { spans: true, maxColumns: Number.POSITIVE_INFINITY });
  return read.rows.map((fields, i) => {
    const end = read.ends[i]!;
    const next = read.starts[i + 1] ?? text.length;
    return { fields, start: read.starts[i]!, end, gap: text.slice(end, next), touched: false };
  });
}

/** The line break the file uses: its first one, or `\n` when it has none. */
export function eolOf(text: string): string {
  const at = text.indexOf("\n");
  return at > 0 && text[at - 1] === "\r" ? "\r\n" : "\n";
}

/** A value as a field: in quotes when it holds the separator, a quote or a line break. */
export function field(value: string, delimiter: string, quote = '"'): string {
  if (!value.includes(delimiter) && !value.includes(quote) && !value.includes("\n") && !value.includes("\r")) return value;
  return quote + value.replaceAll(quote, quote + quote) + quote;
}

/** Fields as one record's text. A record of one empty field is written `""`: an empty line is
 *  not a record. */
export function line(fields: string[], delimiter: string): string {
  if (fields.length === 1 && fields[0] === "") return '""';
  return fields.map((value) => field(value, delimiter)).join(delimiter);
}

/** A new record. */
const fresh = (fields: string[]): Rec => ({ fields, start: -1, end: -1, gap: "", touched: true });

const isIndex = (n: unknown, below: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < below;
const isText = (s: unknown): s is string => typeof s === "string";

/** `list` with `items` put in so that each sits at its `at` once in. */
function merged<T>(list: T[], at: number[], items: T[]): T[] {
  const out: T[] = [];
  let from = 0;
  let next = 0;
  const total = list.length + items.length;
  for (let i = 0; i < total; i++) {
    if (next < at.length && at[next] === i) out.push(items[next++]!);
    else out.push(list[from++]!);
  }
  return out;
}

/** An ascending list of places, each below `below` (and `below` grows by one per place, for an
 *  insert's), or what is wrong with it. */
function ascending(at: unknown, below: (i: number) => number): number[] {
  if (!Array.isArray(at) || at.length === 0) throw new Error("an edit names no rows");
  for (let i = 0; i < at.length; i++) {
    if (!isIndex(at[i], below(i)) || (i > 0 && at[i] <= at[i - 1])) throw new Error(`an edit names row ${String(at[i])}, which is not there`);
  }
  return at as number[];
}

/**
 * The records after `ops`, in order. Rows count from the first record after the header (when
 * there is one), as the table counts them. Throws when an edit names a row or a column that is
 * not there: the file is not what the table was read from.
 */
export function replay(recs: Rec[], ops: WireOp[], hasHeader: boolean): Rec[] {
  const off = hasHeader ? 1 : 0;
  let head = recs.slice(0, off);
  let rows = recs.slice(off);
  const touch = (rec: Rec, fields: string[]) => {
    rec.fields = fields;
    rec.touched = true;
  };
  for (const op of ops) {
    switch (op?.kind) {
      case "set":
        if (!Array.isArray(op.cells)) throw new Error("an edit sets no cells");
        for (const cell of op.cells) {
          const rec = rows[cell?.row];
          if (!isIndex(cell?.row, rows.length) || !rec || !isIndex(cell.column, Number.MAX_SAFE_INTEGER) || !isText(cell.value)) throw new Error(`an edit sets a cell that is not there (row ${String(cell?.row)})`);
          const fields = rec.fields.slice();
          while (fields.length <= cell.column) fields.push("");
          fields[cell.column] = cell.value;
          touch(rec, fields);
        }
        break;
      case "rename": {
        const rec = head[0];
        if (!rec || !isIndex(op.column, Number.MAX_SAFE_INTEGER) || !isText(op.name)) throw new Error("an edit renames a column of a file without names");
        const fields = rec.fields.slice();
        while (fields.length <= op.column) fields.push("");
        fields[op.column] = op.name;
        touch(rec, fields);
        break;
      }
      case "insertRows": {
        const at = ascending(op.at, (i) => rows.length + i + 1);
        if (!Array.isArray(op.rows) || op.rows.length !== at.length || !op.rows.every((row) => Array.isArray(row) && row.every(isText))) throw new Error("an edit puts in rows it does not give");
        rows = merged(rows, at, op.rows.map((row) => fresh(row.slice())));
        break;
      }
      case "deleteRows": {
        const at = new Set(ascending(op.at, () => rows.length));
        rows = rows.filter((_, i) => !at.has(i));
        break;
      }
      case "insertColumn": {
        if (!isIndex(op.at, Number.MAX_SAFE_INTEGER) || !isText(op.name)) throw new Error("an edit puts in a column it does not name");
        const all = [...head, ...rows];
        all.forEach((rec, r) => {
          const value = r < off ? op.name : String(op.values?.[r - off] ?? "");
          // A record too short to reach the place has nothing to move: an empty field there is
          // what it already reads as.
          if (rec.fields.length < op.at && value === "") return;
          const fields = rec.fields.slice();
          while (fields.length < op.at) fields.push("");
          fields.splice(op.at, 0, value);
          touch(rec, fields);
        });
        break;
      }
      case "deleteColumn": {
        if (!isIndex(op.at, Number.MAX_SAFE_INTEGER)) throw new Error("an edit takes out a column that is not there");
        for (const rec of [...head, ...rows]) {
          if (rec.fields.length <= op.at) continue;
          const fields = rec.fields.slice();
          fields.splice(op.at, 1);
          touch(rec, fields);
        }
        break;
      }
      default:
        throw new Error(`an edit of a kind the table does not make: ${String((op as { kind?: unknown })?.kind)}`);
    }
  }
  return [...head, ...rows];
}

/**
 * The file's text with `final` for its records: those not touched as they were in `text`, the
 * rest written from their fields. What came before the first record and after the last stays.
 */
export function joined(text: string, original: Rec[], final: Rec[], delimiter: string): string {
  const before = text.slice(0, original[0]?.start ?? text.length);
  if (final.length === 0) return before;
  const eol = eolOf(text);
  const after = original.at(-1)?.gap ?? eol;
  let out = before;
  final.forEach((rec, i) => {
    out += rec.touched || rec.start < 0 ? line(rec.fields, delimiter) : text.slice(rec.start, rec.end);
    if (i === final.length - 1) out += after;
    else out += /[\r\n]/.test(rec.gap) ? rec.gap : eol;
  });
  return out;
}

/** `text` with `ops` made: what saving writes. */
export function rewrite(text: string, ops: WireOp[], opts: { delimiter: string; hasHeader: boolean }): string {
  const original = recordsOf(text, opts.delimiter);
  // `replay` changes the records it touches: the original list keeps its own copies of them.
  const final = replay(
    original.map((rec) => ({ ...rec })),
    ops,
    opts.hasHeader,
  );
  return joined(text, original, final, opts.delimiter);
}
