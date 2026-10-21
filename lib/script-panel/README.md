# script-panel

What `npm-scripts` and `shell-scripts` share: a dock page listing a repository's runnable scripts,
grouped under headers that fold, each run in a terminal beside the current pane.

It is a **library**, not a page of its own: it declares no view, command or option, so pumi never
starts it. A package imports it, says what a directory holds (its `Finder`), declares the view in
its own manifest, and draws the page with it.

## In a package

```ts
// package.json: "dependencies": { "script-panel": "file:../lib/script-panel" }
import { readdirSync } from "node:fs";
import { option, pkg, view } from "pumi";
import { label, quote, scriptPanel, type Finder, type Group } from "script-panel";

/** Its own half: the `*.sh` files in a directory. */
async function read(): Promise<Finder> {
  return {
    depth: Number((await option.get("max_depth")) ?? 4),
    showDetail: (await option.get("show_command")) !== false,
    empty: "No shell scripts found",
    optionMatch: pkg.prefixed("*"),
    group(dir, root): Group | null {
      const names = readdirSync(dir).filter((name) => name.endsWith(".sh"));
      if (names.length === 0) return null;
      return {
        label: label(dir, root),
        dir,
        items: names.map((name) => ({ name, detail: `sh ${name}`, command: `sh ${quote(name)}` })),
      };
    },
  };
}

// Its page, in its manifest's `pumi.contributes.views`.
view("scripts", scriptPanel(read, "script"));
```

`read` is called for each pane (so each page has its own finder) and again when an option
`optionMatch` names changes — read them again there. The page rescans when the current pane or its
directory changes, and on **Rescan**.

The page counts what it lists: `"2 scripts · 1 place"` — `scriptPanel`'s second argument is what an
item is called, with the plural's `s` added.

## What it exports

| | |
| --- | --- |
| `scriptPanel(make, noun)` | the view class: `view("<id>", scriptPanel(make, noun))`. `make` is `() => Finder \| Promise<Finder>`. |
| `ScriptPanel` | the view itself: `new` with `(cx, make, noun)`, `scriptPanel` subclassing it. |
| `Finder`, `Group`, `Item` | what a package says of its scripts: `{ name, detail, command }` in a `{ label, dir, items }` under a header. |
| `groupScripts(finder, root)` | every `Group` below `root`, `depth` directories down, hidden, symlinked and `SKIP`ped directories left out, sorted by the finder (`sort(groups)`, else by label). |
| `repoRoot(cwd)` | the nearest directory with a `.git`, else `cwd`. |
| `label(dir, root)` | `dir` relative to `root`, `.` for the root. |
| `quote(word)` | the word as the shell reads it: as it is when plain, else single-quoted. |
| `SKIP` | the directories never walked into (`node_modules`, `.git`, `dist`, …). |

A `Finder` is `{ depth, showDetail, empty, optionMatch, group(dir, root), sort?(groups) }`:
`showDetail` draws an item's `command` beside its name, `empty` is said when nothing was found, and
`optionMatch` is the globs of the options whose change re-reads the finder (`pkg.prefixed("*")` for
the package's own).

Running one is the page's: it opens a `terminal` pane beside the current one in the group's `dir`
and types the item's `command` and `\r` there.

## Working on it

```sh
bun scripts/link.mjs     # at the repository's root: links the SDK, and this into its dependents
bun test                 # test/, against pumi/testing's fake app
./node_modules/.bin/tsc --noEmit
```

`test/runs.ts` is the finder the tests share; `test/panel-main.ts` is the view they open, the
`.run` files of a temporary repository as its scripts.
