// Where things are on the editor's surface: which lines are in view, the boxes of the carets and
// selections, the position under a point, and the scroll that shows the caret. Pure numbers, so
// the view only draws them.
import { matchBrackets, type EditorState } from "../codemirror.ts";
import { columnAt, offsetAt } from "./layout.ts";

export interface Metrics {
  lineHeight: number;
  charWidth: number;
  /** Space left of the text, inside the surface. */
  padding: number;
}

/** The surface's scroll and size, in px. */
export interface Viewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lines drawn past either edge of the view, so a small scroll shows no gap before it redraws. */
const OVERSCAN = 4;

/** The 1-based lines `first`..`last` the view shows (and a few either side). */
export function visibleLines(state: EditorState, vp: Viewport, m: Metrics): { first: number; last: number } {
  const first = Math.max(1, Math.floor(vp.top / m.lineHeight) + 1 - OVERSCAN);
  const last = Math.min(state.doc.lines, Math.ceil((vp.top + Math.max(vp.height, m.lineHeight)) / m.lineHeight) + OVERSCAN);
  return { first, last: Math.max(first, last) };
}

/** The furthest the view scrolls down: the last line at the top, as editors allow. */
export function maxTop(state: EditorState, m: Metrics): number {
  return Math.max(0, (state.doc.lines - 1) * m.lineHeight);
}

/** The document position at surface point `(x, y)` (relative to the surface's top left). */
export function posAt(state: EditorState, x: number, y: number, vp: Viewport, m: Metrics): number {
  const doc = state.doc;
  const row = Math.floor((y + vp.top) / m.lineHeight) + 1;
  if (row < 1) return 0;
  if (row > doc.lines) return doc.length;
  const line = doc.line(row);
  const column = Math.max(0, (x + vp.left - m.padding) / m.charWidth);
  return line.from + offsetAt(line.text, column, state.tabSize);
}

/** The x of position `pos` in content coordinates (0 at the text's left edge). */
function xOf(state: EditorState, pos: number, m: Metrics): number {
  const line = state.doc.lineAt(pos);
  return columnAt(line.text, pos - line.from, state.tabSize) * m.charWidth;
}

/** Each caret in lines `first`..`last`, in content coordinates (y 0 at line `first`'s top). */
export function caretBoxes(state: EditorState, first: number, last: number, m: Metrics, width = 2): (Box & { main: boolean })[] {
  const out: (Box & { main: boolean })[] = [];
  const main = state.selection.main;
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head).number;
    if (line < first || line > last) continue;
    out.push({ x: xOf(state, range.head, m), y: (line - first) * m.lineHeight, width, height: m.lineHeight, main: range === main });
  }
  return out;
}

/** The selected parts of lines `first`..`last`: one box per line a selection covers, reaching a
 *  character past a line it runs off the end of (its line break). */
export function selectionBoxes(state: EditorState, first: number, last: number, m: Metrics): Box[] {
  const out: Box[] = [];
  const doc = state.doc;
  const from = doc.line(first).from;
  const to = doc.line(last).to;
  for (const range of state.selection.ranges) {
    if (range.empty || range.to < from || range.from > to) continue;
    const startLine = Math.max(first, doc.lineAt(range.from).number);
    const endLine = Math.min(last, doc.lineAt(range.to).number);
    for (let n = startLine; n <= endLine; n++) {
      const line = doc.line(n);
      const start = Math.max(range.from, line.from);
      const end = Math.min(range.to, line.to);
      const x0 = columnAt(line.text, start - line.from, state.tabSize) * m.charWidth;
      let x1 = columnAt(line.text, end - line.from, state.tabSize) * m.charWidth;
      if (range.to > line.to) x1 += m.charWidth;
      if (x1 > x0) out.push({ x: x0, y: (n - first) * m.lineHeight, width: x1 - x0, height: m.lineHeight });
    }
  }
  return out;
}

/** The bracket the main caret is next to and its match, as boxes in lines `first`..`last`. */
export function bracketBoxes(state: EditorState, first: number, last: number, m: Metrics): Box[] {
  const main = state.selection.main;
  if (!main.empty) return [];
  const match = matchBrackets(state, main.head, -1) ?? matchBrackets(state, main.head, 1);
  if (!match || !match.matched || !match.end) return [];
  const boxes: Box[] = [];
  for (const span of [match.start, match.end]) {
    const line = state.doc.lineAt(span.from);
    if (line.number < first || line.number > last) continue;
    const x0 = columnAt(line.text, span.from - line.from, state.tabSize) * m.charWidth;
    const x1 = columnAt(line.text, span.to - line.from, state.tabSize) * m.charWidth;
    boxes.push({ x: x0, y: (line.number - first) * m.lineHeight, width: Math.max(x1 - x0, m.charWidth), height: m.lineHeight });
  }
  return boxes;
}

/** The scroll that shows the main caret with a margin around it, moving no more than it must. */
export function reveal(state: EditorState, vp: Viewport, m: Metrics): Viewport {
  // Not laid out yet: nothing to show it in. The first layout reveals it.
  if (vp.height <= 0 || vp.width <= 0) return vp;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const y = (line.number - 1) * m.lineHeight;
  const margin = Math.min(2 * m.lineHeight, Math.max(0, (vp.height - m.lineHeight) / 2));
  let top = vp.top;
  if (y - margin < top) top = y - margin;
  else if (y + m.lineHeight + margin > top + vp.height) top = y + m.lineHeight + margin - vp.height;
  const x = m.padding + columnAt(line.text, head - line.from, state.tabSize) * m.charWidth;
  const marginX = Math.min(4 * m.charWidth, vp.width / 3);
  let left = vp.left;
  if (x - marginX < left + m.padding) left = Math.max(0, x - marginX - m.padding);
  else if (x + marginX > left + vp.width) left = x + marginX - vp.width;
  return { ...vp, top: Math.min(Math.max(0, top), maxTop(state, m)), left: Math.max(0, left) };
}
