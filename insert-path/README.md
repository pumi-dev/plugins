# insert-path

Type `/` in a terminal and pick a file: a floating fuzzy picker over the tab types the path in,
quoted as one shell argument, so `vim `, `cd ` or `cat ` are a couple of keystrokes and a `/`.

```text
search  ~/code/pumi-plugins                        12
▸ main.rs        src
  format.py      src
  Cargo.toml
──────────────────────────────────────────────────────
Filter files…
```

The picker lists the directory the terminal is in, walked once when it opens: `node_modules`,
`.git`, `target`, `dist` and the other directories nothing is looked for in are not walked into,
symlinks are not followed, and the walk stops at 15 directories down and 60,000 entries. Each row
is the file's icon, its name, and the directory above it.

## What you type

The query is a case-insensitive subsequence of the file name, and the best match is the one under
the highlight: consecutive runs, word starts (`_`, `-`, `.`, `/`, a space), lowercase letters and
camel humps score higher, and an equal score goes to the shorter path. Once the query has a `/` in
it, it is matched against the whole relative path instead, so `src/ma` narrows to one directory.
At most 200 matches are kept.

| Key | |
| --- | --- |
| `Enter` | type the highlighted path into the terminal and close; a directory comes with its `/` |
| `Tab` | narrow to the highlighted directory |
| `↑` `↓`, `Ctrl-P` `Ctrl-N`, `Ctrl-K` `Ctrl-J` | move the highlight, around the ends |
| `PageUp` `PageDown` | eight rows at a time |
| `Escape`, `Backspace` on an empty query, a press outside | close without picking |

A bare trigger that was typed to open the picker is typed back when the picker is dismissed before
anything was typed — `/`, so the shell still gets it. A chord such as `<D-/>` was not typed, so
there is nothing to type back.

## Quoting

A path goes in bare when a shell would take it as it is (`src/main.rs`, `~/x/y`), and in single
quotes otherwise, with `'\''` for the quotes inside it: `src/my file.rs` becomes `'src/my file.rs'`.
Turn it off with `quote` to type the path as it is.

## Options

| Option | | |
| --- | --- | --- |
| `trigger` | `/` | the key that opens the picker in a terminal; a chord (`<D-/>`) or a sequence works too |
| `quote` | `true` | wrap a path in single quotes when the shell would split it |
| `height` | `18` | how many terminal rows tall the picker is |

The trigger is bound in the terminal's key table as it is set, and rebound when the option changes.

## From elsewhere

`pumi call <owner>.insert_path.open` (`local.insert_path.open` while it is linked from disk) opens
the picker over the current tab; give it `{ "pane": 12 }` to pick a path for that pane.

## How it is made

A pumi plugin in TypeScript, run by pumi's Bun host while the app is open. The picker is the block
`picker` (`<owner>.insert_path.picker`); `src/main.ts` reads the options, binds the trigger and
opens its float, `src/ui.tsx` draws it, `src/entries.ts` walks the directory, `src/match.ts` scores
and ranks the matches, and `src/path.ts` quotes a path and writes it with `~`. `icons/file.svg` is
the document a row draws when the file is not one it knows.

```sh
bun test                          # the pure logic: no pumi running
bunx tsc --noEmit                 # the types
pumi plugin dev .                 # links it into the running app and reloads it on every save
```
