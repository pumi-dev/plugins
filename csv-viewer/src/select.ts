// What is picked in the table, worked out without drawing: a cell, or a block of them from the
// one pressed first (the anchor) to the one moved to (the focus), in the order the table shows its
// rows, sorted and searched. And what a copy of it puts on the clipboard. Pure: `bun test` runs it.
import { line } from "./write.ts";

/** A cell: its row in the file's order (the table's data, which a sort does not move), and its
 *  column's place. */
export interface Spot {
  row: number;
  column: number;
}

/** What is picked: one cell when the anchor is the focus. */
export interface Selection {
  anchor: Spot;
  focus: Spot;
}

/** A block of cells, by the places of its rows as shown (top, bottom) and its columns. */
export interface Block {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Where each of the file's rows is shown, by its place in the file: -1 for one a search hides. */
export function placesOf(order: number[], rows: number): Int32Array {
  const places = new Int32Array(rows).fill(-1);
  order.forEach((row, place) => {
    if (row >= 0 && row < rows) places[row] = place;
  });
  return places;
}

/** The block a selection covers, as shown; null when its focus is hidden or gone. An anchor that a
 *  search hid makes the block the focus alone. */
export function blockOf(selection: Selection | null, places: Int32Array, columns: number): Block | null {
  if (!selection || columns === 0) return null;
  const focus = places[selection.focus.row] ?? -1;
  if (focus < 0) return null;
  const anchor = places[selection.anchor.row] ?? -1;
  const from = anchor < 0 ? focus : anchor;
  const clamp = (c: number) => Math.max(0, Math.min(columns - 1, c));
  const a = clamp(anchor < 0 ? selection.focus.column : selection.anchor.column);
  const b = clamp(selection.focus.column);
  return { top: Math.min(from, focus), bottom: Math.max(from, focus), left: Math.min(a, b), right: Math.max(a, b) };
}

/** Whether a block is more than one cell. */
export const isRange = (block: Block | null): boolean => block !== null && (block.top !== block.bottom || block.left !== block.right);

/** The file's rows in a block, in the order shown. */
export function rowsOf(block: Block, order: number[]): number[] {
  return order.slice(block.top, block.bottom + 1);
}

/** A key that moves the focus, and how far: what the arrows, Tab, Page Up and Down, Home and End
 *  do. `edge` (⌘ held) goes to the first or last. */
export function moved(at: { place: number; column: number }, key: string, sizes: { rows: number; columns: number; page: number }, edge = false): { place: number; column: number } | null {
  const last = { place: Math.max(0, sizes.rows - 1), column: Math.max(0, sizes.columns - 1) };
  const to = (place: number, column: number) => ({ place: Math.max(0, Math.min(last.place, place)), column: Math.max(0, Math.min(last.column, column)) });
  switch (key) {
    case "up":
      return to(edge ? 0 : at.place - 1, at.column);
    case "down":
      return to(edge ? last.place : at.place + 1, at.column);
    case "left":
      return to(at.place, edge ? 0 : at.column - 1);
    case "right":
      return to(at.place, edge ? last.column : at.column + 1);
    case "pageup":
      return to(at.place - sizes.page, at.column);
    case "pagedown":
      return to(at.place + sizes.page, at.column);
    case "home":
      return to(edge ? 0 : at.place, 0);
    case "end":
      return to(edge ? last.place : at.place, last.column);
    default:
      return null;
  }
}

/** A cell as a spreadsheet pastes it: in quotes when it holds a tab, a line break or a quote. */
function tsvField(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Cells as tab-separated lines: what a block copies, and what a spreadsheet pastes as cells. */
export function tsv(rows: string[][]): string {
  return rows.map((row) => row.map(tsvField).join("\t")).join("\n");
}

/** Rows as the file writes them, quoted as it would: what “Copy rows” copies. */
export function delimited(rows: string[][], delimiter: string): string {
  return rows.map((row) => line(row, delimiter)).join("\n");
}

/** The text a copy of `block` puts on the clipboard: one cell's value as it is, more as TSV. */
export function copied(block: Block, order: number[], data: string[][]): string {
  const rows = rowsOf(block, order).map((row) => (data[row] ?? []).slice(block.left, block.right + 1).map((value) => value ?? ""));
  if (rows.length === 1 && rows[0]!.length === 1) return rows[0]![0]!;
  return tsv(rows);
}
