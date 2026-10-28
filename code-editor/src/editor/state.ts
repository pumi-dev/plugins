// The editor's state: a CodeMirror `EditorState` for a file (its language, history, brackets,
// indentation), and what each key action makes of it. Pure: the view dispatches what this answers.
import {
  EditorSelection,
  EditorState,
  closeBrackets,
  copyLineDown,
  copyLineUp,
  cursorMatchingBracket,
  deleteBracketPair,
  history,
  indentLess,
  indentMore,
  indentOnInput,
  indentUnit,
  insertBlankLine,
  insertBracket,
  insertNewlineAndIndent,
  moveLineDown,
  moveLineUp,
  redo,
  selectAll,
  selectLine,
  selectParentSyntax,
  simplifySelection,
  toggleComment,
  undo,
  type StateCommand,
  type Transaction,
  type TransactionSpec,
} from "../codemirror.ts";
import { addCursorVertical, cut, insert, move, remove, selectNextOccurrence, type Grid } from "./commands.ts";
import type { Action } from "./keys.ts";
import { languageFor } from "./languages.ts";

export interface Config {
  tabSize: number;
  /** Indent with spaces (`tabSize` of them), else with a tab. */
  spaces: boolean;
}

/** The indentation a file already uses, guessed from its first indented lines: a tab, or how many
 *  spaces a level is. Null when it has none to go by. */
export function detectIndent(text: string): { spaces: boolean; size: number } | null {
  let tabs = 0;
  const widths = new Map<number, number>();
  let previous = 0;
  let seen = 0;
  for (const line of text.split("\n", 2000)) {
    const indent = /^[ \t]*/.exec(line)![0];
    if (indent.length === line.length) continue;
    seen++;
    if (indent.startsWith("\t")) tabs++;
    else {
      const delta = Math.abs(indent.length - previous);
      if (delta > 1 && delta <= 8) widths.set(delta, (widths.get(delta) ?? 0) + 1);
      previous = indent.length;
    }
  }
  if (seen === 0) return null;
  const spaced = [...widths.values()].reduce((a, b) => a + b, 0);
  if (tabs > spaced) return { spaces: false, size: 0 };
  if (spaced === 0) return null;
  const size = [...widths].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return { spaces: true, size };
}

/** A state for `doc`, the text of the file at `path`. */
export function createState(doc: string, path: string, config: Config, readOnly = false): EditorState {
  const found = detectIndent(doc);
  const spaces = found ? found.spaces : config.spaces;
  const size = found?.spaces ? found.size : config.tabSize;
  return EditorState.create({
    doc,
    extensions: [
      history(),
      closeBrackets(),
      indentOnInput(),
      EditorState.allowMultipleSelections.of(true),
      EditorState.tabSize.of(found && !found.spaces ? config.tabSize : size),
      indentUnit.of(spaces ? " ".repeat(size) : "\t"),
      EditorState.readOnly.of(readOnly),
      languageFor(path),
    ],
  });
}

/** Runs a CodeMirror command against `state`, catching the transaction it dispatches. */
function run(state: EditorState, command: StateCommand): Transaction | null {
  let out: Transaction | null = null;
  command({ state, dispatch: (tr) => (out = tr) });
  return out;
}

/** Text typed at the carets: a bracket or quote closes itself (and steps over its own close), and
 *  the line re-indents when the text says so (`indentOnInput`, which the state applies). */
export function typeText(state: EditorState, text: string): Transaction | TransactionSpec | null {
  if (text.length === 1) {
    const bracket = insertBracket(state, text);
    if (bracket) return bracket;
  }
  return insert(state, text);
}

/** What `action` makes of `state`: a transaction (or its spec) to dispatch, or null when it does
 *  nothing. Clipboard and save actions are the view's: they answer null here. */
export function perform(state: EditorState, action: Action, grid: Grid): Transaction | TransactionSpec | null {
  switch (action.t) {
    case "move":
      return move(state, action.unit, action.forward, action.extend, grid);
    case "delete": {
      if (action.unit === "char" && !action.forward) {
        const pair = run(state, deleteBracketPair);
        if (pair) return pair;
      }
      return remove(state, action.unit, action.forward);
    }
    case "newline":
      return run(state, insertNewlineAndIndent);
    case "blankLine":
      return run(state, insertBlankLine);
    case "indent":
      // A tab with every selection empty indents from the caret; with a selection, its lines.
      if (state.selection.ranges.every((r) => r.empty)) return insert(state, state.facet(indentUnit));
      return run(state, indentMore);
    case "outdent":
      return run(state, indentLess);
    case "undo":
      return run(state, undo);
    case "redo":
      return run(state, redo);
    case "selectAll":
      return run(state, selectAll);
    case "selectLine":
      return run(state, selectLine);
    case "selectNext":
      return selectNextOccurrence(state);
    case "selectParent":
      return run(state, selectParentSyntax);
    case "cursorUp":
      return addCursorVertical(state, false);
    case "cursorDown":
      return addCursorVertical(state, true);
    case "toggleComment":
      return run(state, toggleComment);
    case "moveLineUp":
      return run(state, moveLineUp);
    case "moveLineDown":
      return run(state, moveLineDown);
    case "copyLineUp":
      return run(state, copyLineUp);
    case "copyLineDown":
      return run(state, copyLineDown);
    case "deleteLine": {
      if (state.readOnly) return null;
      const changes = state.selection.ranges.map((r) => {
        const from = state.doc.lineAt(r.from);
        const to = state.doc.lineAt(r.to);
        return to.number < state.doc.lines ? { from: from.from, to: to.to + 1 } : { from: Math.max(0, from.from - 1), to: to.to };
      });
      return { changes, scrollIntoView: true, userEvent: "delete.line" };
    }
    case "matchingBracket":
      return run(state, cursorMatchingBracket);
    case "escape":
      return run(state, simplifySelection);
    case "cut":
      return cut(state);
    case "copy":
    case "paste":
    case "save":
      return null;
  }
}

export { EditorSelection };
