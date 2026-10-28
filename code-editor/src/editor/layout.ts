// Where text sits on a monospace grid: columns, tabs and wide characters. Everything the view
// measures goes through here, so the caret, the selection, a click and the drawn text agree.
import { findClusterBreak } from "../codemirror.ts";

/** Whether `code` draws two cells wide: East Asian wide and full-width forms, and emoji. */
export function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/** The cells the grapheme starting at `at` takes, from column `column` (a tab reaches the next stop). */
function cells(text: string, at: number, column: number, tabSize: number): number {
  const code = text.codePointAt(at)!;
  if (code === 9) return tabSize - (column % tabSize);
  return isWide(code) ? 2 : 1;
}

/** The column (in cells) offset `to` of `text` starts at. */
export function columnAt(text: string, to: number, tabSize: number): number {
  let column = 0;
  for (let at = 0; at < to && at < text.length; ) {
    column += cells(text, at, column, tabSize);
    at = findClusterBreak(text, at);
  }
  return column;
}

/** The offset in `text` nearest column `column`: a click past half a character lands after it. */
export function offsetAt(text: string, column: number, tabSize: number): number {
  let at = 0;
  let col = 0;
  while (at < text.length) {
    const width = cells(text, at, col, tabSize);
    if (col + width / 2 > column) return at;
    col += width;
    at = findClusterBreak(text, at);
  }
  return text.length;
}

/** `text` as drawn from column `column`: its tabs as the spaces they reach to. */
export function expandTabs(text: string, column: number, tabSize: number): string {
  if (!text.includes("\t")) return text;
  let out = "";
  let col = column;
  for (let at = 0; at < text.length; ) {
    const next = findClusterBreak(text, at);
    if (text.charCodeAt(at) === 9) {
      const width = tabSize - (col % tabSize);
      out += " ".repeat(width);
      col += width;
    } else {
      out += text.slice(at, next);
      col += cells(text, at, col, tabSize);
    }
    at = next;
  }
  return out;
}

/** How many columns `text` takes, drawn from column 0. */
export function widthOf(text: string, tabSize: number): number {
  return columnAt(text, text.length, tabSize);
}
