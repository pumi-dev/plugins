# git

The repository in the left sidebar — **Changes** and **History** — for whichever repository the pane
you are working in is in. It is the app's own git plugin as a package: the `git` binary does the
work, a watch of the work tree says when to look again.

```
  Changes                            git
  ──────────────────────────────────────────
   View Diff                  +12 -3   [Stage All]
   ▾ Staged                    1        [x]
     ▾ src                     1        [x]
       M  main.ts              +2 -0    [x]
   ▾ Unstaged                  3        [ ]
     ▾ src/deep                1        [ ]
       ?  walk.ts                       [ ]
     M  README.md               +1 -1    [ ]
   main
  ┌──────────────────────────────────────────┐
  │ Create walk.ts              [ Commit ]   │
  └──────────────────────────────────────────┘
```

## The two pages

- **Changes** — the conflicts above the two groups (Staged, Unstaged), each as a path tree; the
  branch, the commit message box, `Stage All`, and every row's own actions.
- **History** — the commits, newest first: subject, tags, author, when it was, and an arrow on the
  ones the branch's upstream has not got.

`ctrl+shift+g` shows the two pages, and takes them away again. It is in the server's `root` key
table (a package cannot put a chord in the app's own keymap), so it works from a terminal; the same
thing is `pumi call amresyd.git.toggle`, and the palette has it as *Git: show the changes and the
history*.

## A row's actions

| | |
| --- | --- |
| checkbox | stage (Staged: unstage) the file, or everything under a directory |
| enter, space | the first of a row's actions: stage, unstage, take ours, take theirs |
| click | puts the cursor there; a double click opens the file |
| right click | the rest: discard changes, ignore this file, take ours, take theirs |
| `j`/`k`, ↑/↓, `g`/`G` | the cursor |
| `/` or `?` | filter the tree, every directory open |
| `c` | the commit message box |
| `esc` | clear the filter and the cursor |

A conflict's row says its sides under it — `UU · ours 950b81b · theirs b19a1e9`. `Stage All` and the
group checkboxes stage or unstage the whole repository. Everything that fails says why in the line
under the toolbar, in git's own words.

## The options

| | |
| --- | --- |
| `date_format` | `relative` (3 days ago) or `absolute` (2025-10-09 08:53) |
| `show_author` | whether the history names each commit's author |

They are declared in `package.json`, so Settings shows them under *Packages → git*.

## How it works

| file | |
| --- | --- |
| `src/main.ts` | the two views, where they go, the trigger, the events the panel follows |
| `src/panel.ts` | the repository of the current pane, its snapshot, the cursor, the draft, the actions |
| `src/git.ts` | the git work: `Bun.spawn`, porcelain, the history, stage/unstage/discard/ignore/resolve/commit |
| `src/tree.ts` | the changes as a path tree, and the group states its checkboxes read |
| `src/ui.tsx` | what the page draws: the groups, the rows, the commit box, the history, a row's menu |
| `src/time.ts` | "3 days ago", "2025-10-09 08:53" |
| `src/state.ts` | the folded directories, kept per repository |
| `src/watch.ts` | the watch on the work tree, and which of its paths matter |

`bun test` drives the git work against a real repository in a temporary directory: no pumi is
running.
