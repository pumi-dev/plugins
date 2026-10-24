# files — the project tree in the sidebar

The project panel of pumi's Files plugin, as a package: the side bar's Project section, which shows
the project the current pane's directory is in — its folders and files, folder by folder, with each
file's icon and git's marks on every row — and what the user does to it: open, rename, make, copy,
cut, paste, trash, delete, drag out, drop in, add to `.gitignore`, filter, expand and collapse.

It is the manifest's `contributes.slots["panel"]` view (`ui.tsx`'s `Tree`); `cmd+shift+e` shows the
side bar it is in, as it does in the app, and `cmd+f` opens its filter box.

```sh
pumi plugin add ~/Kitchen/pumi-plugins/files     # or: pumi plugin dev .
```

## What it does

- **The project is the repository's.** The tree starts at the work tree's root of the pane in front
  (`git rev-parse --show-toplevel`), and at that pane's directory when it is in no repository — the
  core panel's own root. It follows the pane: `pane_current_path` changing, `cwd.changed`, another
  tab or pane coming forward — and, because a package is pushed nothing, it looks again every two
  seconds for the changes nobody announces.
- **Directories are read when they are opened**, not before, and sorted the panel's way: folders
  first, names naturally (`file2.rs` before `file10.rs`). A folder that holds one folder is drawn as
  one row — `a/b/c` — and opens a level at a time, as the core panel folds such chains.
- **`.gitignore` is read as git reads it**: every `.gitignore` down the way, plus `.git/info/exclude`,
  innermost first, with `!` bringing an entry back. `hide_gitignore` and `hide_hidden` leave the
  ignored and the dotfiles out; with them off the rows are drawn dimmed instead.
- **git's state is on every row**, from `git status --porcelain`: a modified folder is tinted as much
  as the file inside it, a new file is green, a deleted one red, a conflict yellow — in the theme's
  own `status.*` tokens. `git_status` turns it off.
- **Icons by name and extension**, from the core plugin's own icon set, vendored in
  `icons/file_icons/` (Lucide, ISC): a file is named by its file name first (`Dockerfile`), then
  every suffix after a dot (`auth.module.js` is a JavaScript file), then its several extensions, then
  its extension. `file_icons` and `folder_icons` turn them off.
- **The disk is watched**, so a save or a `git checkout` shows up as it does in the core plugin — and
  a burst of writes inside a folder the tree leaves out (a build in `target/`) does not redraw it at
  all.
- **The keyboard**: `↓`/`↑` and `ctrl+n`/`ctrl+p`, `home`/`end` and the page keys, `→`/`←` to open
  and close a folder (a folded chain opens a level at a time with `→`, closes with `←`), `cmd+→`/
  `cmd+←` for everything, `space` to open, `enter`/`f2` to rename, `backspace` to trash, `delete` to
  delete, `cmd+c`/`cmd+x`/`cmd+v` to copy, cut and paste, `escape` to drop the cursor. The tree takes
  the keyboard when it is pressed; `pane_current_path` and the keys of the tree come from the key
  context `amresyd.files.tree`.
- **A right-click on a row** opens the core panel's own menu, in its order: New File, New Folder,
  Reveal in Finder, Open in Default App, Cut, Copy, Duplicate, Copy Path, Copy Relative Path, Add to
  .gitignore, Add to .git/info/exclude, Rename, Trash, Delete, and — for a folder — Expand All and
  Collapse All. A package draws that menu itself, in a popover over the row: the app's own context
  menu cannot be given items by a package.
- **Renaming and making** are typed in the row itself, in the app's own text field; escape cancels,
  enter commits, a name that is taken is refused and the field stays, and a name ending in `/` makes
  a folder.
- **Dropping**: a row carries its path and any row takes a dropped path — moved within the project,
  copied in from outside it, never over something that is there (`main copy.rs`).
- **The filter** (`Files: filter the project tree`, or `cmd+shift+e` then the command) narrows the
  project to the paths that match, flat; picking one shows it in the tree with its folders open.

## Options

Every one of the core plugin's settings, by its name, plus two for the one thing a package must
decide itself:

| option | default | |
| --- | --- | --- |
| `hide_gitignore` | `false` | leave out what `.gitignore` hides |
| `hide_hidden` | `false` | leave out what starts with a dot |
| `file_icons` | `true` | each file's icon |
| `folder_icons` | `true` | each folder's icon, open or closed |
| `git_status` | `true` | tint a row by git's state of it |
| `auto_fold_dirs` | `true` | a folder that holds one folder is one row |
| `indent_size` | `20` | pixels a level takes |
| `open_with` | `pane` | what a click on a file does: `pane` (a file pane), `editor` (a terminal pane) or `system` (its app) |
| `editor` | `$EDITOR` | the editor a file opens in with `open_with = "editor"`, empty for `$EDITOR` |

## Opening a file

A click on a file opens it with `file.open`, as `pumi open` does: in a **file pane** (the core's
`file` block) split on the right of the pane whose directory the tree follows, or the file pane in
that tab showing it already. Which plugin draws it is the app's choice — the enabled viewer whose
`renderers.file.match` fits the file best, such as `monaco` — and with none the pane says so and
offers the system's app. `open_with = "editor"` opens a **terminal pane running your editor**
instead (`$EDITOR`, or the `editor` option: `code -w`, `nvim`, `hx`), and `open_with = "system"`
whatever app owns the file.

## Layout

| | |
| --- | --- |
| `src/main.ts` | what registers: the view, the commands, the option reads, the events that move the tree |
| `src/ui.tsx` | the page: rows, disclosure, indent guides, the filter, the row menu |
| `src/panel.ts` | the core plugin's `ProjectPanel`: the cursor, the open folders, the clipboard, the row being typed into |
| `src/tree.ts` | the tree: lazy listing, ignore stacks, folded chains, the visible rows |
| `src/intent.ts` | what a gesture comes to, and doing it: files on disk, the clipboard, opening a file |
| `src/ops.ts` | the file operations |
| `src/git.ts` | `git status` and the colour a row takes from it |
| `src/icons.ts` | which icon a name gets |
| `src/paths.ts` | the panel's sort |
| `src/relpath.ts` | paths inside the project |
| `src/ignore.ts` | `.gitignore`, read as git reads it |
| `src/row.ts` | a row, and the key it is known by |
| `src/edit.ts` | a name being typed |
| `src/menu.ts` | what a row's menu offers |
| `src/watch.ts` | the watch on the project |

`bun test` runs the tests in `test/`: the core plugin's own `tree.rs`, `paths.rs`, `git.rs`,
`file_icons.rs` and `ops.rs` tests, ported — on the panel's own model, with no app running.
