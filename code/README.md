# code

A code editor for file tabs, written in TSX and drawn by pumi's own renderer: no web page. The
text, selections, undo, syntax trees and indentation are CodeMirror 6's state (bundled in
`src/vendor/codemirror.js`, so it needs no install); what you see is `<div>`s and `<text>`s, and
the keyboard and the platform's typing (dead keys, accents, input methods) come in through
`<text-input>`.

```sh
pumi plugin add ~/Kitchen/pumi-plugins/code
pumi open src/main.rs                 # files with a language below open here
pumi call amresyd.code.save %7        # tab 7's file, to disk (⌘S in the editor)
```

## What it does

- Highlighting and indentation for JavaScript/TypeScript (JSX), JSON, Rust, Python, Go, C/C++,
  Java, CSS, HTML, Markdown and YAML, coloured from the terminals' palette.
- Several carets (`⌥`-click, `⌥⌘↑/↓`, `⌘D`), word, line and document moves, drag selection
  (double-press by words, triple by lines), bracket matching, auto-closed brackets, comment
  toggling (`⌘/`), moving and copying lines (`⌥↑/↓`, `⇧⌥↑/↓`), undo and redo.
- Only the lines in view are drawn, and a line redraws only when its text or colours change.
- `dirty` (`amresyd.code.dirty`) on the tab while its file has unsaved changes, shown in the tab's
  toolbar.

## Options

`tab_size` and `insert_spaces` apply to a file whose own indentation says nothing; a file's
existing indentation wins.

## Working on it

```sh
bun test                  # the editing, geometry and highlighting modules
bun scripts/vendor.ts     # rebuild src/vendor/codemirror.js after changing a CodeMirror version
```
