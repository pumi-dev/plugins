// What an edit to the table is, as data: cells set, a column renamed, rows or a column put in or
// taken out. The view applies one to the table it holds and keeps it, so ⌘Z can apply its
// inverse; saving sends the edits kept (`wire`) to the worker, which replays them on the whole
// file (`write.ts`), rows past the row limit included. Pure, like `parse.ts`: `bun test` runs it.
import type { ColumnKind } from "./parse.ts";

/** The table the view draws and edits. */
export interface Sheet {
  headers: string[];
  rows: string[][];
  kinds: ColumnKind[];
  /** Each column's id. A column put in or taken out moves the others' places, not their ids, so a
   *  sort keeps following the column it was on. */
  keys: number[];
  /** Whether the names are the file's first record. Without one they are made up (`Column 1`…),
   *  and are made again when a column comes or goes. */
  named: boolean;
}

/** One cell's new value, and the one it had, so the change can be undone. */
export interface CellChange {
  row: number;
  column: number;
  value: string;
  was: string;
}

/**
 * An edit. Rows are counted in the file's order (the table's data, not the order a sort shows);
 * `at` of rows is ascending, and says where each row is once they are in (for `insertRows`) or
 * where it was before they went (for `deleteRows`), so one undoes the other with the same list.
 */
export type Op =
  | { kind: "set"; cells: CellChange[] }
  | { kind: "rename"; column: number; name: string; was: string }
  | { kind: "insertRows"; at: number[]; rows: string[][] }
  | { kind: "deleteRows"; at: number[]; rows: string[][] }
  | { kind: "insertColumn"; at: number; name: string; key: number; type: ColumnKind; values: string[] }
  | { kind: "deleteColumn"; at: number; name: string; key: number; type: ColumnKind; values: string[] };

/** An edit as the worker replays it: without what only an undo needs. */
export type WireOp =
  | { kind: "set"; cells: { row: number; column: number; value: string }[] }
  | { kind: "rename"; column: number; name: string }
  | { kind: "insertRows"; at: number[]; rows: string[][] }
  | { kind: "deleteRows"; at: number[] }
  | { kind: "insertColumn"; at: number; name: string; values?: string[] }
  | { kind: "deleteColumn"; at: number };

/** The table a file was read as, ready to edit. */
export function sheetOf(headers: string[], rows: string[][], kinds: ColumnKind[], named: boolean): Sheet {
  return { headers, rows, kinds, keys: headers.map((_, i) => i), named };
}

/** The names a file without a header row shows. */
function madeUp(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Column ${i + 1}`);
}

/** `list` with `items` put in so that each sits at its `at` once in (`at` ascending). */
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

/** `list` without the places in `at` (ascending). */
function without<T>(list: T[], at: number[]): T[] {
  const out: T[] = [];
  let next = 0;
  for (let i = 0; i < list.length; i++) {
    if (next < at.length && at[next] === i) next++;
    else out.push(list[i]!);
  }
  return out;
}

const spliced = <T>(list: T[], at: number, remove: number, ...items: T[]): T[] => {
  const copy = list.slice();
  copy.splice(at, remove, ...items);
  return copy;
};

/** The sheet after `op`. The sheet given is not changed: an undo needs it as it was. */
export function apply(sheet: Sheet, op: Op): Sheet {
  switch (op.kind) {
    case "set": {
      const rows = sheet.rows.slice();
      const copied = new Set<number>();
      for (const cell of op.cells) {
        if (!copied.has(cell.row)) {
          rows[cell.row] = rows[cell.row]!.slice();
          copied.add(cell.row);
        }
        rows[cell.row]![cell.column] = cell.value;
      }
      return { ...sheet, rows };
    }
    case "rename":
      return { ...sheet, headers: spliced(sheet.headers, op.column, 1, op.name) };
    case "insertRows":
      return { ...sheet, rows: merged(sheet.rows, op.at, op.rows) };
    case "deleteRows":
      return { ...sheet, rows: without(sheet.rows, op.at) };
    case "insertColumn": {
      const headers = spliced(sheet.headers, op.at, 0, op.name);
      return {
        ...sheet,
        headers: sheet.named ? headers : madeUp(headers.length),
        rows: sheet.rows.map((row, i) => spliced(row, op.at, 0, op.values[i] ?? "")),
        kinds: spliced(sheet.kinds, op.at, 0, op.type),
        keys: spliced(sheet.keys, op.at, 0, op.key),
      };
    }
    case "deleteColumn": {
      const headers = spliced(sheet.headers, op.at, 1);
      return {
        ...sheet,
        headers: sheet.named ? headers : madeUp(headers.length),
        rows: sheet.rows.map((row) => spliced(row, op.at, 1)),
        kinds: spliced(sheet.kinds, op.at, 1),
        keys: spliced(sheet.keys, op.at, 1),
      };
    }
  }
}

/** What undoes `op`. */
export function inverse(op: Op): Op {
  switch (op.kind) {
    case "set":
      return { kind: "set", cells: op.cells.map((cell) => ({ ...cell, value: cell.was, was: cell.value })) };
    case "rename":
      return { ...op, name: op.was, was: op.name };
    case "insertRows":
      return { ...op, kind: "deleteRows" };
    case "deleteRows":
      return { ...op, kind: "insertRows" };
    case "insertColumn":
      return { ...op, kind: "deleteColumn" };
    case "deleteColumn":
      return { ...op, kind: "insertColumn" };
  }
}

/** `op` as the worker is sent it. */
export function wire(op: Op): WireOp {
  switch (op.kind) {
    case "set":
      return { kind: "set", cells: op.cells.map(({ row, column, value }) => ({ row, column, value })) };
    case "rename":
      return { kind: "rename", column: op.column, name: op.name };
    case "insertRows":
      return { kind: "insertRows", at: op.at, rows: op.rows };
    case "deleteRows":
      return { kind: "deleteRows", at: op.at };
    case "insertColumn":
      return op.values.some((value) => value !== "") ? { kind: "insertColumn", at: op.at, name: op.name, values: op.values } : { kind: "insertColumn", at: op.at, name: op.name };
    case "deleteColumn":
      return { kind: "deleteColumn", at: op.at };
  }
}

// ---- the edits the view makes, from the sheet as it is

/** Cells set to new values; null when none of them changes. */
export function setCells(sheet: Sheet, cells: { row: number; column: number; value: string }[]): Op | null {
  const changes: CellChange[] = [];
  for (const { row, column, value } of cells) {
    const was = sheet.rows[row]?.[column];
    if (was === undefined || was === value) continue;
    changes.push({ row, column, value, was });
  }
  return changes.length > 0 ? { kind: "set", cells: changes } : null;
}

/** A column given a new name; null when it already has it, or the file has no names to change. */
export function renameColumn(sheet: Sheet, column: number, name: string): Op | null {
  const was = sheet.headers[column];
  if (!sheet.named || was === undefined || was === name) return null;
  return { kind: "rename", column, name, was };
}

/** `count` empty rows, from row `at` on. */
export function insertRows(sheet: Sheet, at: number, count = 1): Op {
  const from = Math.max(0, Math.min(at, sheet.rows.length));
  const width = sheet.headers.length;
  return {
    kind: "insertRows",
    at: Array.from({ length: count }, (_, i) => from + i),
    rows: Array.from({ length: count }, () => Array.from({ length: width }, () => "")),
  };
}

/** The rows `rows` taken out; null when none of them is there. */
export function deleteRows(sheet: Sheet, rows: number[]): Op | null {
  const at = [...new Set(rows)].filter((row) => row >= 0 && row < sheet.rows.length).sort((a, b) => a - b);
  if (at.length === 0) return null;
  return { kind: "deleteRows", at, rows: at.map((row) => sheet.rows[row]!) };
}

/** A name no column has yet: `Column 4`, or the next free number. */
export function freeName(headers: string[]): string {
  const taken = new Set(headers.map((name) => name.trim().toLowerCase()));
  for (let n = headers.length + 1; ; n++) if (!taken.has(`column ${n}`)) return `Column ${n}`;
}

/** An empty column, put in at place `at`. */
export function insertColumn(sheet: Sheet, at: number): Op {
  const place = Math.max(0, Math.min(at, sheet.headers.length));
  const key = sheet.keys.reduce((a, b) => Math.max(a, b), -1) + 1;
  return { kind: "insertColumn", at: place, name: freeName(sheet.headers), key, type: "text", values: sheet.rows.map(() => "") };
}

/** The column at `at` taken out; null when there is none, or it is the last one. */
export function deleteColumn(sheet: Sheet, at: number): Op | null {
  if (at < 0 || at >= sheet.headers.length || sheet.headers.length <= 1) return null;
  return {
    kind: "deleteColumn",
    at,
    name: sheet.headers[at]!,
    key: sheet.keys[at]!,
    type: sheet.kinds[at] ?? "text",
    values: sheet.rows.map((row) => row[at] ?? ""),
  };
}
