// What the diff's syntax colours take from CodeMirror 6: the Lezer parsers and their highlighting,
// and the editor state a parse is made from. The rest of the plugin imports CodeMirror from here only.
export { EditorState, type Extension } from "@codemirror/state";
export { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
export { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
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
