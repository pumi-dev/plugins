# palette

The command palette: `cmd+shift+p` for every command there is, `cmd+p` for every file in the
project, one fuzzy search over both.

```
 ⌘⇧P
┌──────────────────────────────────────────────────────────────┐
│ > spl                                                        │
│   Split Down                                         split    │
│   Split Right                                        split    │
│   …                                                          │
│ enter Run                                              2 rows │
└──────────────────────────────────────────────────────────────┘
```

It is the core plugin ported as a package: the same two modes and the way between them, the same
scoring, the same history and recent files.

## The keys

| Key | |
| --- | --- |
| `cmd+shift+p` | the commands; pressed again while the palette is up, it goes away |
| `cmd+p` | the files; with the palette already up in commands mode it turns it to the files, and in files mode it steps a row down |
| `>` typed on an empty files query | the commands (`>query` is a command search, as `>zoo` finds `Zoom Pane`) |
| `Backspace` on an empty commands query | back to the files — deleting the `>` |
| `↑` `↓`, `ctrl+p` `ctrl+n` | the next or previous row, around the ends; at the top with nothing typed, back through the queries that ran |
| `Enter` | run the command, or open the file |
| `Tab` | complete the query to the row: a command's name, or a file's directory |
| `Escape`, a press outside | close |

Both keys are the package's own commands (`go_to_file`, `toggle`), declared in its manifest, so they
work before its worker has ever run: `pumi call amresyd.palette.toggle` opens it too.

## What it lists

The commands are what the app publishes about itself, read when the palette opens and again whenever
they change:

- `menu.list("")` — every menu the app and the packages put up: the header's buttons, a pane's strip,
  the menu bar's menus. A leaf is a row; it runs with `menu.exec`, or opens the block it names.
- `key.list("")` — every key table: the host's prefix keys, a package's own table, the `root` table
  a manifest's `keys` land in. A binding whose right-hand side is a function is a row; it runs by
  calling that function. The tables have no noun of their own in the SDK, so it is a `call`.

A key bound while the palette is open is not listed until it is opened again: the tables are read
when it opens, and `menu.changed` re-reads them, but `key.changed` is gone, so a new key mapping no
longer refreshes a palette that is up.

The core plugin is handed the app's entire action list instead, which a package cannot have — see
`docs/plan/ports/palette.md` in the pumi checkout for what that leaves out.

The files are the directories under the project around the current pane's directory — the nearest
`.git` above it — walked once when files mode opens, `.gitignore` and `.ignore` respected and `.git`
skipped, and searched as they arrive.

A chosen file opens as `pumi open` opens one (`file.open`): in a file pane on the right of the
current pane, drawn by the enabled plugin that fits it (the `monaco` editor, say). An image, a PDF,
a video or an archive goes to the desktop instead, unless a viewer of its own kind is enabled.

## What it remembers

Its own storage, kept by the server, three fields: how often each command ran (so a command you
reach for often comes first among equals), the queries that ran (what `↑` brings back, fifty of
them), and the files opened lately (what an empty files search leads with, a hundred of them).

## Layout

| | |
| --- | --- |
| `src/main.ts` | what registers: the two commands, the block, and where the float goes |
| `src/palette.ts` | the palette itself: its modes, its keys, its rows |
| `src/score.ts` | the fuzzy matcher and the palette's own arithmetic |
| `src/files.ts` | the file index and the search over it |
| `src/walk.ts` | the walk, and the `.gitignore` rules it obeys |
| `src/vocabulary.ts` | the commands, from the menu tree and the key tables |
| `src/store.ts` | what it remembers between runs |
| `src/open.ts` | how a chosen file is opened |
