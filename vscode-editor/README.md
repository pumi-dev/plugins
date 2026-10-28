# VSCode Editor

[Monaco](https://microsoft.github.io/monaco-editor/), the editor inside VS Code, for file tabs. It
uses the terminals' colours and font, and the app's menus and clipboard.

```sh
pumi plugin add pumi-dev/plugins/vscode-editor
pumi open src/main.rs            # on the right of this tab
pumi open --line 42 src/main.rs  # at line 42
```

It draws every file a viewer that fits it better does not: `pumi open`, the File Tree, the
palette and agents all open files here.

- **Highlighting** for about 35 languages, and JSON's validation, formatting and folding.
- **Multiple cursors**, column selection, find and replace, go to line, and Monaco's command
  palette (`F1`).
- **Coloured like your terminals**: the palette's background, foreground, cursor, selection and
  sixteen colours; the font from Settings → Appearance.
- **Each file keeps its undo**, scroll and unsaved edits while another file shows in the same tab.
- **Saving**: `cmd+s`, or the dot in the tab's toolbar while the file has unsaved changes. A file
  that changed on disk is read again when the tab comes back, unless it has unsaved edits.
- **Drop a file** from the File Tree or Finder to open it.

The palette has *VSCode Editor: find*, *go to line*, *show the editor's commands*, *toggle word
wrap* and *toggle the minimap*.

## Options

| | |
| --- | --- |
| `tab_size` | columns per tab, for a file whose indentation says nothing (Monaco detects it) |
| `word_wrap` | wrap long lines (on) |
| `minimap` | the file in miniature on the right (off) |

## Limits

- Language services (completion, go to definition, diagnostics) only for JSON. TypeScript's, CSS's
  and HTML's workers are several megabytes each and are left out.
- Closing a tab drops its unsaved edits without asking.
- Text files up to 16 MB, read as UTF-8.
- macOS only for now: it draws in a web view.

## Development

```sh
pumi plugin dev vscode-editor   # link it, reload on save
bun test                        # the theme and the page's helpers
bun run build                   # build web/ now (the plugin does it itself the first time it runs)
```

`monaco-editor` is an npm dependency. The first time the plugin runs it bundles the page in `page/`
with Monaco into `web/`, which takes under a second, and again whenever either changes. Nothing
built is kept in git.
