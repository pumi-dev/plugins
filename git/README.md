# git

The repository in the left sidebar — **Changes** and **History** — for whichever repository the tab
you are working in is in. It is the app's own git plugin as a package: the `git` binary does the
work, a watch of the work tree says when to look again.

```
  Changes (7)          │  History
  ────────────────────────────────
   ± View Diff   +12 −3  [filter]  [ Stage All ▾ ]
   ▾ Staged                     3   [▣]
     ▾ src                      2   [▣]
       M  main.ts       +2 −0       [x]
   ▾ Unstaged                   4   [ ]
     ▾ src/deep                 1   [ ]
       ?  walk.ts                  [ ]
     M  README.md       +1 −1       [ ]
   main                                 [ Push ▾ ]
  ┌──────────────────────────────────┐
  │ Create walk.ts                   │
  │                    ⌘↵ commits    │
  │                       [ Commit ▾ ]│
  └──────────────────────────────────┘
```

## The two pages

- **Changes** — the conflicts above the two groups (Staged, Unstaged), each as a path tree; the
  branch, the commit message box, `Stage All`, and every row's own actions.
- **History** — the commits, newest first: subject, tags, author, when it was, and an arrow on the
  ones the branch's upstream has not got. A click shows the commit's diff.

Both pages are pushed, not asked for: the worker posts the whole page whenever the repository
changes (`ui.post`, at most once a tick) and the window draws the last post it has the moment the
sidebar opens — nothing is read on the way in, and nothing says "loading".

`ctrl+shift+g` shows the two pages, and takes them away again. It is in the server's `root` key
table (a package cannot put a chord in the app's own keymap), so it works from a terminal; the same
thing is `pumi call amresyd.git.toggle`, and the palette has it as *Git: show the changes and the
history*.

## A row's actions

| | |
| --- | --- |
| checkbox | stage (Staged: unstage) the file, or everything under a directory |
| enter, space | the first of a row's actions: stage, unstage, take ours, take theirs |
| click | a file: its diff, in the diff tab; a directory or a group: fold it |
| double click | opens the file |
| right click | the rest: discard changes, ignore this file, take ours, take theirs |
| `j`/`k`, ↑/↓ | the cursor |
| `/` | filter the tree, every directory open |
| ⌘↵ / ctrl+↵, in the message box | commit |
| `esc` | clear the filter and the cursor |

A conflict's row says its sides under it — `UU · ours 950b81b · theirs b19a1e9`. `Stage All` and the
group checkboxes stage or unstage the whole repository. Everything that fails says why in the line
under the toolbar, in git's own words.

## The diff

A file's click shows its diff, `View Diff` the whole work tree (new files and all), and a commit in
History that commit — in a diff tab, in a view of its own, drawn by the app's native `<diff>`:
virtualised, syntax-highlighted, the changed words marked, and in the window's theme (the editor's
background, the theme's green and red), so a theme switch redraws it. Further diffs reuse that tab
while it is in the view you are in, and a change in the work tree redraws what it shows without
blanking it first.

The split button beside the branch, when the repository has a remote, publishes the branch, or (with
an upstream) says `Pull 2` / `Push 1` when it is behind or ahead; its menu offers fetch, pull, push
and publish.

## The options

| | |
| --- | --- |
| `date_format` | `relative` (3 days ago) or `absolute` (2025-10-09 08:53) |
| `show_author` | whether the history names each commit's author |

They are declared in `package.json`, so Settings shows them on its page, *git*.

## How it works

| file | |
| --- | --- |
| `src/main.ts` | the two pages, what is posted to the window, the diff tab, the trigger, the events |
| `src/panel.ts` | the repository of the current tab, its snapshot, the cursor, the draft, the actions |
| `src/git.ts` | the git work: `Bun.spawn`, porcelain, the history, the diff's patches, stage/unstage/discard/ignore/resolve/commit/sync |
| `src/tree.ts` | the changes as a path tree, and the group states its checkboxes read |
| `src/ui.tsx` | what the page draws: the tabs, the rows, the commit box, the history, a row's menu, and the diff tab |
| `src/time.ts` | "3 days ago", "2025-10-09 08:53" |
| `src/state.ts` | the folded directories, kept per repository |
| `src/watch.ts` | the watch on the work tree, and which of its paths matter |

`bun test` drives the git work against a real repository in a temporary directory: no pumi is
running.
