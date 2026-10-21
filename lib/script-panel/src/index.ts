// `script-panel`: what `npm-scripts` and `shell-scripts` share — a dock page of a repository's
// runnable scripts, grouped and folded, each run in a terminal. A library: it contributes nothing
// of its own (no view, no command, no option). A package names its `Finder`, declares the view, and
// registers `scriptPanel(() => …, "script")`; see README.md.
export { ScriptPanel, scriptPanel } from "./panel.ts";
export { SKIP, groupScripts, label, quote, repoRoot } from "./finder.ts";
export type { Finder, Group, Item } from "./finder.ts";
