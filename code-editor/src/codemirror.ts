// What the editor takes from CodeMirror 6: its document, selections, transactions and history, the
// Lezer parsers and their highlighting, indentation, brackets and the commands that need no DOM.
// The rest of the plugin imports CodeMirror from here only.
export {
  ChangeSet,
  CharCategory,
  EditorSelection,
  EditorState,
  SelectionRange,
  Text,
  Transaction,
  countColumn,
  findClusterBreak,
  type ChangeSpec,
  type Extension,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
export {
  ensureSyntaxTree,
  getIndentUnit,
  getIndentation,
  indentOnInput,
  indentString,
  indentUnit,
  matchBrackets,
  syntaxTree,
  type Language,
  type LanguageSupport,
} from "@codemirror/language";
export {
  copyLineDown,
  copyLineUp,
  cursorMatchingBracket,
  history,
  indentLess,
  indentMore,
  insertBlankLine,
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
} from "@codemirror/commands";
export { closeBrackets, deleteBracketPair, insertBracket } from "@codemirror/autocomplete";
export { highlightTree, tagHighlighter, tags, type Highlighter } from "@lezer/highlight";
export type { Tree } from "@lezer/common";
export { cpp } from "@codemirror/lang-cpp";
export { css } from "@codemirror/lang-css";
export { go } from "@codemirror/lang-go";
export { html } from "@codemirror/lang-html";
export { java } from "@codemirror/lang-java";
export { javascript } from "@codemirror/lang-javascript";
export { json } from "@codemirror/lang-json";
export { markdown } from "@codemirror/lang-markdown";
export { python } from "@codemirror/lang-python";
export { rust } from "@codemirror/lang-rust";
export { yaml } from "@codemirror/lang-yaml";
