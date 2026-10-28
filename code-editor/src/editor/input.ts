// What `<text-input>` is given and what its events mean: the window of the document around the main
// selection that the platform reads (`text`, `selection`), and a typed text or a composition, whose
// ranges are in that window, as a change to the state.
//
// The element hears the platform before the view answers, and keeps its copy of `text` as each
// `textInput` left it. So the window is kept in place, mapped through each change, and moves only
// when the main selection leaves it: then the element's copy and the view's agree on what an index
// means, even for text typed before the view drew again.
import { EditorSelection, type ChangeSet, type EditorState, type Transaction, type TransactionSpec } from "../codemirror.ts";
import { typeText } from "./state.ts";

/** How much text either side of the main selection the platform may read, past which a long line
 *  is cut. */
const CONTEXT = 2048;
/** A selection longer than this is given as its head alone: typing replaces it all the same. */
const MAX_SELECTION = 16 * 1024;

/** The window last given to the element, and its selection, as document positions. */
export interface InputWindow {
  from: number;
  to: number;
  anchor: number;
  head: number;
}

/** What `<text-input>` is given: `text` and `selection` in it. */
export function inputProps(state: EditorState, w: InputWindow): { text: string; selection: [number, number] } {
  return { text: state.sliceDoc(w.from, w.to), selection: [w.anchor - w.from, w.head - w.from] };
}

/** A position not inside a surrogate pair: `at`, or one unit toward `dir`. */
function whole(state: EditorState, at: number, dir: -1 | 1): number {
  if (at <= 0 || at >= state.doc.length) return at;
  const code = state.sliceDoc(at, at + 1).charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff ? at + dir : at;
}

/** The window for `state`: `prev` while it still holds the main selection, else the lines the
 *  selection is on, cut to `CONTEXT` either side of it. */
export function windowFor(state: EditorState, prev: InputWindow | null): InputWindow {
  const main = state.selection.main;
  const big = main.to - main.from > MAX_SELECTION;
  const anchor = big ? main.head : main.anchor;
  const head = main.head;
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  if (prev && from >= prev.from && to <= prev.to && prev.to - prev.from <= to - from + 4 * CONTEXT) return { ...prev, anchor, head };
  const start = whole(state, Math.max(state.doc.lineAt(from).from, from - CONTEXT), -1);
  const end = whole(state, Math.min(state.doc.lineAt(to).to, to + CONTEXT), 1);
  return { from: start, to: end, anchor, head };
}

/** `w` after `changes`: text typed at either end of it is in it. */
export function mapWindow(w: InputWindow, changes: ChangeSet): InputWindow {
  return { from: changes.mapPos(w.from, -1), to: changes.mapPos(w.to, 1), anchor: changes.mapPos(w.anchor, 1), head: changes.mapPos(w.head, 1) };
}

/** An event's range in the window as document positions, clamped to the window. */
export function rangeOf(w: InputWindow, start: number | undefined, end: number | undefined): { from: number; to: number } {
  const sel = { from: Math.min(w.anchor, w.head), to: Math.max(w.anchor, w.head) };
  const clamp = (n: number) => Math.min(w.to, Math.max(w.from, w.from + n));
  const from = start == null ? sel.from : clamp(start);
  const to = end == null ? sel.to : clamp(end);
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/**
 * Text typed over `range` (document positions). Over the selection the element was given, it is
 * typed at every caret, closing brackets as typing does. Around the selection (an accent for the
 * letter just typed), the same reach around every caret is replaced. Anywhere else (a word
 * autocorrect fixed), that range alone.
 */
export function typedSpec(state: EditorState, w: InputWindow, range: { from: number; to: number }, text: string): Transaction | TransactionSpec | null {
  if (state.readOnly) return null;
  const sel = { from: Math.min(w.anchor, w.head), to: Math.max(w.anchor, w.head) };
  if (range.from === sel.from && range.to === sel.to) return typeText(state, text);
  if (range.from <= sel.from && range.to >= sel.to) return replaceAround(state, sel.from - range.from, range.to - sel.to, text);
  return { changes: { from: range.from, to: range.to, insert: text }, scrollIntoView: true, userEvent: "input.type" };
}

/** `text` in place of each selection and `before` units before it and `after` after it, on its
 *  line: an accent for the letter just typed at every caret. */
export function replaceAround(state: EditorState, before: number, after: number, text: string): TransactionSpec | null {
  if (state.readOnly) return null;
  const spec = state.changeByRange((range) => {
    const from = Math.max(state.doc.lineAt(range.from).from, range.from - before);
    const to = Math.min(state.doc.lineAt(range.to).to, range.to + after);
    return { changes: { from, to, insert: text }, range: EditorSelection.cursor(from + text.length) };
  });
  return { ...spec, scrollIntoView: true, userEvent: "input.type" };
}
