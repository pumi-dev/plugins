# script-panel

What the `scripts` package draws: a dock page listing a repository's runnable scripts, grouped
under headers that fold, each run in a terminal beside the current pane.

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
    groups(dir, root): Group[] {
      const names = readdirSync(dir).filter((name) => name.endsWith(".sh"));
      if (names.length === 0) return [];
      return [
        {
          label: label(dir, root),
          dir,
          items: names.map((name) => ({ name, detail: `sh ${name}`, command: `sh ${quote(name)}` })),
        },
      ];
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
  return <ScriptPage load={load} run={run} options={["show_command", "max_depth"]} noun="script" />;
}
```

`read` is called each time the page is read, so it reads the options as they are now; `ScriptPage`'s
`options` are the keys it reads again on: it hears `option.changed` for them, by the names the app
gives the package's options (`amresyd.scripts.show_command`). The page rescans when the pane in
front moves, and on the ↻ button.

The page counts what it lists: `"2 scripts · 1 place"` — `noun` is what an item is called, with the
plural's `s` added.

## What it exports

| | |
| --- | --- |
| `page(make, cwd)` | the page of `cwd`, in the worker: `make` is `() => Finder \| Promise<Finder>`. |
| `ScriptPage` | the page itself, in the window: `<ScriptPage load={load} run={run} options={[…]} noun="script" />`. |
| `run(dir, command)` | opens a `terminal` pane in `dir` and types `command` into it. |
| `Page` | what `page` answers: `{ root, groups, empty, showDetail }`. |
| `Finder`, `Group`, `Item` | what a package says of its scripts: `{ name, detail, command }` in a `{ label, dir, icon?, items }` under a header. |
| `groupScripts(finder, root)` | every `Group` below `root`, `depth` directories down, hidden, symlinked and `SKIP`ped directories left out, sorted by the finder (`sort(groups)`, else by label). |
| `repoRoot(cwd)` | the nearest directory with a `.git`, else `cwd`. |
| `label(dir, root)` | `dir` relative to `root`, `.` for the root. |
| `quote(word)` | the word as the shell reads it: as it is when plain, else single-quoted. |
| `SKIP` | the directories never walked into (`node_modules`, `.git`, `dist`, …). |

A `Finder` is `{ depth, showDetail, empty, groups(dir, root), sort?(groups) }`: `groups` is a list, so
a directory can hold more than one kind of script (a `package.json`'s and its own), `icon` is the
glyph a group's header leads with, `showDetail` draws an item's `command` beside its name, and
`empty` is said when nothing was found.

Running one is the page's, through the `run` it is given: it opens a `terminal` pane beside the
current one in the group's `dir` and types the item's `command` and `\r` there. A library's
`main.ts` is not a page of its own — the window does not reach it — so both `load` and `run` are the
package's own `main.ts` exports, which `ui.tsx` hands to `ScriptPage`:

```ts
// src/main.ts: the library's run, as this package's export (a call in the worker)
import { page, run as open, type Page } from "script-panel/main.ts";

export function run(dir: string, command: string): Promise<void> {
  return open(dir, command);
}
```

## Working on it

```sh
bun tools/link.mjs     # at the repository's root: links the SDK, and this into its dependents
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit
```

`test/runs.ts` is the finder the tests share; `test/finder.test.ts` is the walk, the ordering and the
labels over the `.run` files of a temporary repository.
