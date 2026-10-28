// What a key does to the state: moving every caret (by character, word, line, page, line edge,
// document edge), extending the selection, deleting, typing. Each answers a transaction spec for
// `state.update`, or null when there is nothing to do. CodeMirror's own commands for these take a
// DOM view (they measure lines); on a monospace grid a column is all they need.
import { CharCategory, EditorSelection, findClusterBreak, getIndentUnit, type EditorState, type SelectionRange, type TransactionSpec } from "../codemirror.ts";
import { columnAt, offsetAt } from "./layout.ts";

export type Unit = "char" | "word" | "line" | "page" | "lineEdge" | "docEdge";

/** Grid facts the vertical moves need: rows on a page. */
export interface Grid {
  pageRows: number;
}

/** The position `head` reaches moving one character. */
function byChar(state: EditorState, head: number, forward: boolean): number {
  const line = state.doc.lineAt(head);
  if (forward) {
    if (head === line.to) return line.number < state.doc.lines ? head + 1 : head;
    return line.from + findClusterBreak(line.text, head - line.from, true);
  }
  if (head === line.from) return line.number > 1 ? head - 1 : head;
  return line.from + findClusterBreak(line.text, head - line.from, false);
}

/** The position `head` reaches moving one word: over spaces, then a run of one kind of character
 *  (a word, or punctuation); at a line's edge, to the next line's. */
function byWord(state: EditorState, head: number, forward: boolean): number {
  const line = state.doc.lineAt(head);
  const text = line.text;
  let at = head - line.from;
  if (forward ? at === text.length : at === 0) return byChar(state, head, forward);
  const kind = state.charCategorizer(head);
  const charAt = (i: number) => text.slice(i, findClusterBreak(text, i, true));
  const step = (i: number) => findClusterBreak(text, i, forward);
  const peek = (i: number) => (forward ? charAt(i) : charAt(findClusterBreak(text, i, false)));
  while (forward ? at < text.length : at > 0) {
    if (kind(peek(at)) !== CharCategory.Space) break;
    at = step(at);
  }
  if (forward ? at === text.length : at === 0) return line.from + at;
  const first = kind(peek(at));
  while (forward ? at < text.length : at > 0) {
    if (kind(peek(at)) !== first) break;
    at = step(at);
  }
  return line.from + at;
}

/** The column a vertical move aims for: the range's own, kept across short lines, else its head's. */
function goalOf(state: EditorState, range: SelectionRange): number {
  if (range.goalColumn !== undefined) return range.goalColumn;
  const line = state.doc.lineAt(range.head);
  return columnAt(line.text, range.head - line.from, state.tabSize);
}

/** Where `range`'s head reaches moving `rows` lines (negative: up), with the column it aims for. */
function byRows(state: EditorState, range: SelectionRange, rows: number): { head: number; goal?: number } {
  const goal = goalOf(state, range);
  const line = state.doc.lineAt(range.head);
  const target = line.number + rows;
  if (target < 1) return { head: 0 };
  if (target > state.doc.lines) return { head: state.doc.length };
  const to = state.doc.line(target);
  return { head: to.from + offsetAt(to.text, goal, state.tabSize), goal };
}

/** The line edge `head` reaches: the end, or (backward) the first non-blank, then the very start. */
function byLineEdge(state: EditorState, head: number, forward: boolean): number {
  const line = state.doc.lineAt(head);
  if (forward) return line.to;
  const indent = /^\s*/.exec(line.text)![0].length;
  return head === line.from + indent && indent > 0 ? line.from : line.from + indent;
}

function target(state: EditorState, range: SelectionRange, unit: Unit, forward: boolean, grid: Grid): { head: number; goal?: number } {
  switch (unit) {
    case "char":
      return { head: byChar(state, range.head, forward) };
    case "word":
      return { head: byWord(state, range.head, forward) };
    case "line":
      return byRows(state, range, forward ? 1 : -1);
    case "page":
      return byRows(state, range, (forward ? 1 : -1) * Math.max(1, grid.pageRows - 1));
    case "lineEdge":
      return { head: byLineEdge(state, range.head, forward) };
    case "docEdge":
      return { head: forward ? state.doc.length : 0 };
  }
}

/** Moves every caret by `unit`; `extend` keeps each anchor, so the selections grow. An unextended
 *  move by character from a selection collapses it to that side, as editors do. */
export function move(state: EditorState, unit: Unit, forward: boolean, extend: boolean, grid: Grid): TransactionSpec {
  const ranges = state.selection.ranges.map((range) => {
    if (!extend && !range.empty && unit === "char") return EditorSelection.cursor(forward ? range.to : range.from);
    const { head, goal } = target(state, range, unit, forward, grid);
    return extend ? EditorSelection.range(range.anchor, head, goal) : EditorSelection.cursor(head, 0, undefined, goal);
  });
  return { selection: EditorSelection.create(ranges, state.selection.mainIndex), scrollIntoView: true, userEvent: "select" };
}

/** Backspace in the indentation takes a whole indent unit back to the previous stop, as editors do. */
function backspaceTarget(state: EditorState, head: number): number {
  const line = state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  if (before.length > 0 && /^ +$/.test(before)) {
    const unit = Math.max(1, getIndentUnit(state));
    const column = before.length;
    const back = column % unit === 0 ? unit : column % unit;
    return head - Math.min(back, column);
  }
  return byChar(state, head, false);
}

/** Deletes each selection, or, where one is empty, from its caret by `unit`. */
export function remove(state: EditorState, unit: "char" | "word" | "lineEdge", forward: boolean): TransactionSpec | null {
  if (state.readOnly) return null;
  let changed = false;
  const spec = state.changeByRange((range) => {
    let { from, to } = range;
    if (range.empty) {
      let end: number;
      if (unit === "lineEdge") {
        const line = state.doc.lineAt(range.head);
        if (forward) end = range.head === line.to ? byChar(state, range.head, true) : line.to;
        else end = range.head === line.from ? byChar(state, range.head, false) : line.from;
      } else if (unit === "word") {
        end = byWord(state, range.head, forward);
      } else {
        end = forward ? byChar(state, range.head, true) : backspaceTarget(state, range.head);
      }
      from = Math.min(range.head, end);
      to = Math.max(range.head, end);
    }
    if (from === to) return { range };
    changed = true;
    return { changes: { from, to }, range: EditorSelection.cursor(from) };
  });
  if (!changed) return null;
  return { ...spec, scrollIntoView: true, userEvent: forward ? "delete.forward" : "delete.backward" };
}

/** Types `text` over every selection. */
export function insert(state: EditorState, text: string): TransactionSpec | null {
  if (state.readOnly) return null;
  return { ...state.replaceSelection(text), scrollIntoView: true, userEvent: "input.type" };
}

/** The word around the main caret selected, or, with a selection, the next match of the main one
 *  added (`cmd-d`). */
export function selectNextOccurrence(state: EditorState): TransactionSpec | null {
  const { main, ranges } = state.selection;
  if (main.empty) {
    const word = state.wordAt(main.head);
    if (!word) return null;
    return { selection: state.selection.replaceRange(word), scrollIntoView: true };
  }
  const query = state.sliceDoc(main.from, main.to);
  const text = state.doc.toString();
  const taken = (at: number) => ranges.some((r) => r.from === at);
  const last = Math.max(...ranges.map((r) => r.to));
  let found = text.indexOf(query, last);
  if (found < 0 || taken(found)) found = text.indexOf(query);
  while (found >= 0 && taken(found)) found = text.indexOf(query, found + 1);
  if (found < 0) return null;
  return { selection: state.selection.addRange(EditorSelection.range(found, found + query.length)), scrollIntoView: true };
}

/** A caret added a line above or below the outermost one (`alt-cmd-up/down`). */
export function addCursorVertical(state: EditorState, down: boolean): TransactionSpec | null {
  const ranges = state.selection.ranges;
  const edge = ranges.reduce((a, b) => ((down ? b.head > a.head : b.head < a.head) ? b : a));
  const { head, goal } = byRows(state, edge, down ? 1 : -1);
  if (state.doc.lineAt(head).number === state.doc.lineAt(edge.head).number) return null;
  return { selection: state.selection.addRange(EditorSelection.cursor(head, 0, undefined, goal)), scrollIntoView: true };
}

/** The text the selections hold, joined by line breaks; with every selection empty, their lines
 *  whole (with their breaks), as editors copy. */
export function copied(state: EditorState): { text: string; lines: boolean } {
  const ranges = state.selection.ranges;
  if (ranges.every((r) => r.empty)) {
    const seen = new Set<number>();
    let text = "";
    for (const r of ranges) {
      const line = state.doc.lineAt(r.head);
      if (seen.has(line.number)) continue;
      seen.add(line.number);
      text += `${line.text}\n`;
    }
    return { text, lines: true };
  }
  return { text: ranges.filter((r) => !r.empty).map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak), lines: false };
}

/** What a cut removes: the selections, or with all of them empty, their whole lines. */
export function cut(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null;
  const ranges = state.selection.ranges;
  if (!ranges.every((r) => r.empty)) return { ...state.replaceSelection(""), scrollIntoView: true, userEvent: "delete.cut" };
  const changes = ranges.map((r) => {
    const line = state.doc.lineAt(r.head);
    return line.number < state.doc.lines ? { from: line.from, to: line.to + 1 } : { from: Math.max(0, line.from - 1), to: line.to };
  });
  return { changes, scrollIntoView: true, userEvent: "delete.cut" };
}

/** Pastes `text`: one line of it per caret when the counts agree, else all of it at each. */
export function paste(state: EditorState, text: string): TransactionSpec | null {
  if (state.readOnly) return null;
  const ranges = state.selection.ranges;
  const parts = text.split(/\r\n?|\n/);
  if (ranges.length > 1 && parts.length === ranges.length) {
    let i = 0;
    const spec = state.changeByRange((range) => {
      const insert = parts[i++];
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
    });
    return { ...spec, scrollIntoView: true, userEvent: "input.paste" };
  }
  return { ...state.replaceSelection(text), scrollIntoView: true, userEvent: "input.paste" };
}

/** The word (`clicks` 2) or line (3) around `pos`, else the position itself. */
export function unitAt(state: EditorState, pos: number, clicks: number): SelectionRange {
  if (clicks >= 3) {
    const line = state.doc.lineAt(pos);
    return EditorSelection.range(line.from, Math.min(line.to + 1, state.doc.length));
  }
  if (clicks === 2) return state.wordAt(pos) ?? EditorSelection.cursor(pos);
  return EditorSelection.cursor(pos);
}

/** The selection a drag from `start` (a word or line when it began with a double or triple press)
 *  to `pos` makes: the units at both ends, and everything between. */
export function dragRange(state: EditorState, start: SelectionRange, pos: number, clicks: number): SelectionRange {
  const end = unitAt(state, pos, clicks);
  if (pos < start.from) return EditorSelection.range(start.to, end.from);
  return EditorSelection.range(start.from, Math.max(end.to, start.to));
}
