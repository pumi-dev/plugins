# script-panel

What `npm-scripts` and `shell-scripts` share: a dock page listing a repository's runnable scripts,
grouped under headers that fold, each run in a terminal beside the current pane.

It is a **library**, not a page of its own: it declares nothing, so pumi never starts it. A package
imports it, says what a directory holds (its `Finder`), names `ScriptPage` in its own manifest's
`contributes.slots.panel`, and draws the page with it.

## In a package

```ts
// package.json: "dependencies": { "script-panel": "file:../lib/script-panel" }
import { readdirSync } from "node:fs";
import { option } from "pumi";
import { label, quote, type Finder, type Group } from "script-panel";

/** Its own half: the `*.sh` files in a directory. */
async function read(): Promise<Finder> {
  return {
    depth: Number((await option.get("max_depth")) ?? 4),
    showDetail: (await option.get("show_command")) !== false,
    empty: "No shell scripts found",
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

// Its page, in its manifest's `pumi.contributes.slots.panel`.
// src/main.ts
export function load(cwd: string): Promise<Page> {
  return page(read, cwd);
}

// src/ui.tsx
export function Scripts() {
  return <ScriptPage load={load} options={["show_command", "max_depth"]} noun="script" />;
}
```

`read` is called each time the page is read, so it reads the options as they are now; `ScriptPage`'s
`options` are the keys it reads again on: it hears `option.changed` for them, by the names the app
gives the package's options (`amresyd.npm_scripts.show_command`). The page rescans when the pane in
front moves, and on **Rescan**.

The page counts what it lists: `"2 scripts · 1 place"` — `noun` is what an item is called, with the
plural's `s` added.

## What it exports

| | |
| --- | --- |
| `page(make, cwd)` | the page of `cwd`, in the worker: `make` is `() => Finder \| Promise<Finder>`. |
| `ScriptPage` | the page itself, in the window: `<ScriptPage load={load} options={[…]} noun="script" />`. |
| `run(dir, command)` | opens a `terminal` pane in `dir` and types `command` into it. |
| `Page` | what `page` answers: `{ root, groups, empty, showDetail }`. |
| `Finder`, `Group`, `Item` | what a package says of its scripts: `{ name, detail, command }` in a `{ label, dir, items }` under a header. |
| `groupScripts(finder, root)` | every `Group` below `root`, `depth` directories down, hidden, symlinked and `SKIP`ped directories left out, sorted by the finder (`sort(groups)`, else by label). |
| `repoRoot(cwd)` | the nearest directory with a `.git`, else `cwd`. |
| `label(dir, root)` | `dir` relative to `root`, `.` for the root. |
| `quote(word)` | the word as the shell reads it: as it is when plain, else single-quoted. |
| `SKIP` | the directories never walked into (`node_modules`, `.git`, `dist`, …). |

A `Finder` is `{ depth, showDetail, empty, group(dir, root), sort?(groups) }`: `showDetail` draws an
item's `command` beside its name, and `empty` is said when nothing was found.

Running one is the page's: it opens a `terminal` pane beside the current one in the group's `dir`
and types the item's `command` and `\r` there.

## Working on it

```sh
bun scripts/link.mjs     # at the repository's root: links the SDK, and this into its dependents
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit
```

`test/runs.ts` is the finder the tests share; `test/finder.test.ts` is the walk, the ordering and the
labels over the `.run` files of a temporary repository.
