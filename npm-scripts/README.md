# npm-scripts

A page in the left sidebar of every `package.json` script in the current pane's repository —
workspaces included — each run in a terminal beside the pane you are in.

```text
2 scripts · 1 place                            Rescan
▾ packages/ui/package.json 2
   build        tsc -p .                      › npm run build
   test:unit    vitest                        › bun run test:unit
```

A click opens a terminal in that `package.json`'s directory and types the script's line there, so
the output is in a pane of its own and the page stays where it is.

## The repository it lists

From the current pane's directory up to the nearest one with a `.git` (or the directory itself),
the page walks four directories down (`max_depth`) and lists every `package.json` with scripts.
`node_modules`, `.git`, `dist`, `build` and the other directories no one keeps scripts in are not
walked into, nor are hidden or symlinked ones. Each package is a group folding its scripts away,
headed by the path of its `package.json` in the repository (`package.json` for the root's), with
a count of the scripts under it. A package's scripts are listed by name.

## The manager it runs them with

A script is run by the manager that owns its package:

1. the package's `packageManager` field — corepack's `"pnpm@9.1.0"` gives `pnpm`;
2. else the first lockfile from its directory up to the repository root (`pnpm-lock.yaml`,
   `yarn.lock`, `bun.lockb`, `bun.lock`, `package-lock.json`);
3. else `npm`.

So a workspace with no lockfile of its own gets the repository's, and one with a `yarn.lock` of its
own gets `yarn`. The line typed is `<manager> run <script>`, the name quoted when a shell would
read it differently (`"a b"` becomes `'a b'`).

The page rescans when the current pane or its repository changes, when one of its options changes,
and on **Rescan**.

## Options

All three are under **NPM Scripts** in Settings.

- `show_command` — show what each script runs, beside its name (default on).
- `sort` — order the packages by `path` (default) or by which has `scripts` the most first.
- `max_depth` — how many directories below the repository root to look in, 1 to 10 (default 4).

## What it touches

It reads the repository's `package.json` and lockfiles (`files`), and opens a terminal pane to run
a script in (`processes`). It is a Bun package: it runs in a worker of its own, at startup
(`activation: onStartup`), and puts its page in the sidebar — below the files page, titled **NPM
Scripts** — unless one is there already.

The page itself is [`script-panel`](../lib/script-panel): this package is the finder that says what
a directory holds, and the export the manifest's `contributes.slots.panel` names.

## Working on it

```sh
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit  # the types
```

`test/files.ts` writes the tests' temporary repositories; `test/packages.test.ts` is the finder
(the managers, the groups, the walk and the options), and `test/manifest.test.ts` what its
`package.json` contributes without running.
