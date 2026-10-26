# monaco

A code editor for file panes: [Monaco](https://microsoft.github.io/monaco-editor/), VS Code's
editor, in a page of the plugin's own, themed by the window. One page per pane holds a model per
file it has opened, so going back to a file keeps its undo, its scroll and its unsaved edits.

```sh
pumi plugin add ~/Kitchen/pumi-plugins/monaco     # or: pumi plugin dev ~/Kitchen/pumi-plugins/monaco
```

It has no block of its own: it draws the core's `file` block (`renderers.file`, matching `*`), so
every file opened in a pane is drawn here unless an enabled viewer fits it better (`*.md` beats
`*`), or the pane's `@pane_renderer` names another plugin.

## Open one

```sh
pumi open src/main.rs                        # on the right of this pane; -v below, --tab, --float
pumi open --line 42 src/main.rs              # at line 42
pumi open --with amresyd/monaco notes.md     # this editor, whatever else fits it
pumi call amresyd.monaco.save 7              # pane 7's file, to disk
```

`pumi open` is `pane.open` of a `file` block (see `pumi api show pane.open`): it shows the file in a file pane of
the tab already showing it, else a new one. The pane's `path` option is the file (setting it
opens that one there, and a pane comes back with it); `dirty` (`amresyd.monaco.dirty`) says the
file has unsaved changes. `pane.call(pane, "read")` answers the file's text, and `"selection"`
what is selected in it.

## What it does

- **Themed by the window**: the page makes Monaco's theme from `pumi.theme`'s tokens and follows
  `pumi.onTheme`. The editor's background is clear, so the pane shows through; its widgets (find,
  hover, suggestions, the command palette) sit on `surface` and `border`, the cursor and the
  matches are `accent`, the selection `selected`. The font is the theme's monospace one. The syntax
  colours are Monaco's own `vs-dark` or `vs`, by how light the theme's `editor` is.
- **The app's menu**: a right-click opens the app's menu over the page (`pumi.menu`): Go to
  Definition, Go to References, Peek, Rename, Change All Occurrences, Format, Cut, Copy, Paste and
  the Command Palette. Monaco's own menu is off.
- **The app's clipboard**: `cmd+c`, `cmd+x`, `cmd+v` in the text go through `clipboard.get`/`set`,
  so they work whatever menu the app has. With nothing selected they take the line, as VS Code does.
- **Keys**: `cmd+s` saves (the plugin's key, rebindable in Settings → Keybindings; in the page
  Monaco takes it itself). Monaco keeps its chords the app also binds while it has the keyboard:
  `cmd+d`, `cmd+k …`, `cmd+/`, `cmd+[`, `cmd+]`, `cmd+enter`, `cmd+alt+up`/`down`. `cmd+f`,
  `ctrl+g` and `F1` are Monaco's.
- **Drops**: a file dragged from the project tree, or a `file://` URL, opens in the pane (its
  `path` follows). Several open together, the last one shown. A pane dragged over it still
  splits as usual.
- **Saving**: through `main.ts`, which writes the file (making its folder if it has to). The title
  bar's dot (`pane.toolbar`) says the file is unsaved, and saves it when pressed.
- **The disk**: a file that changed on disk is read again when the page gets the focus or the file
  is shown again, unless it has unsaved edits here; the reload is one undo step.

## Options

`font_size` (0 is the theme's), `tab_size` (for a file whose indentation says nothing: Monaco
detects it), `word_wrap` and `minimap`. **Editor: toggle word wrap** and **Editor: toggle the
minimap** flip the last two in settings.json.

## Build

The page is `page/` (TypeScript and `index.html`), built into `web/`, which is committed: a
plugin is installed from its source and nothing builds it then, as `marmaide` commits its vendored
Pele. Rebuild after changing `page/` or bumping `monaco-editor` (pinned in `package.json`):

```sh
bun install                 # in the workspace: monaco-editor
bun run build               # bun scripts/build.ts: web/
bun run check               # tsc for main.ts/ui.tsx, and for page/
```

`web/` is Monaco's core with every editor contribution (`editor.js` and its chunks, about 4 MB),
`editor.css` and the codicon font, a chunk per language's tokenizer (loaded when a file of it
opens), and the editor's and JSON's workers whole in `web/workers/`, which the page starts from a
blob. Nothing comes from the network at run time.

## Limits

- **Languages**: highlighting, brackets, comments and indentation for about 35 (`page/languages.ts`);
  a language service (diagnostics, completion, go to definition, formatting) only for JSON. The
  TypeScript, CSS and HTML services are left out for size: their workers are megabytes.
- **One file shown per pane**: there are no tabs inside the pane. Another file opened there keeps
  the first one's edits in the page, and `dirty` says only what the file shown is. Closing the pane
  drops unsaved edits without asking: the app has no way for a block to hold a close.
- Text files up to 16 MB, read as UTF-8; a byte-order mark is not written back. A file with a NUL
  byte in its first 8 KB is not opened.
- macOS: web pages are drawn there only.
