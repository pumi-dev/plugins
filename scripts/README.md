# scripts

One page in the left sidebar for everything a repository can run — the scripts of every
`package.json`, workspaces included, and its shell scripts — each run in a terminal beside the pane
you are in.

```text
4 scripts · 3 places                                        ↻
▾ ▣ package.json 2
    build        tsc -p .                          ▶
    test         bun test
▾ > . 1
    top.sh       sh top.sh
▾ > scripts 1
    deploy       zsh deploy
```

A click opens a terminal in that directory and types the script's line there, so the output is in a
pane of its own and the page stays where it is. A row shows a **start** glyph while the mouse is
over it; the groups carry the glyph of what they hold (a box for a `package.json`, a terminal for a
directory's shell scripts).

## The repository it lists

From the current pane's directory up to the nearest one with a `.git` (or the directory itself),
the page walks four directories down (`max_depth`) and lists what it finds. `node_modules`, `.git`,
`dist`, `build` and the other directories no one keeps scripts in are not walked into, nor are
hidden or symlinked ones. Each package is a group folding its scripts away, headed by the path of
its `package.json` in the repository (`package.json` for the root's); each directory with shell
scripts is a group headed by its path (`.` for the root's). Both are listed by name. A directory can
be both: a `package.json`'s scripts and its own shell scripts are two groups.

`npm_scripts` and `shell_scripts` say which of the two kinds is listed at all; both are on until
one is turned off.

## What a package's scripts run with

A script is run by the manager that owns its package:

1. the package's `packageManager` field — corepack's `"pnpm@9.1.0"` gives `pnpm`;
2. else the first lockfile from its directory up to the repository root (`pnpm-lock.yaml`,
   `yarn.lock`, `bun.lockb`, `bun.lock`, `package-lock.json`);
3. else `npm`.

So a workspace with no lockfile of its own gets the repository's, and one with a `yarn.lock` of its
own gets `yarn`. The line typed is `<manager> run <script>`, the name quoted when a shell would
read it differently (`"a b"` becomes `'a b'`).

## What a shell script is

A file is a shell script when

1. its extension is one of `extensions` (`sh`, `bash`, `zsh`, `ksh`, `fish` by default, either case,
   with or without the dot: `sh, .Bash` and `sh,bash` say the same); or
2. it has no extension and its first line — its first 160 bytes — is a `#!` naming one of the
   shells: `sh`, `bash`, `zsh`, `ksh`, `dash`, `ash`, `fish`. The line is read through `env` and
   its switches, so `#!/usr/bin/env -S zsh -e` is `zsh`; `#!/usr/bin/env python3` is no shell, and
   neither is a line that does not start with a `#!`. `shebang` turns this off, and then only the
   extensions count.

Files and directories starting with a `.` are left out, and so is anything that is not a file.

The line typed is the shell the `#!` names; else the one its extension names, when that extension
is a shell's; else `sh`. So `build.sh` with `#!/usr/bin/env bash` runs as `bash build.sh`, and one
with no `#!` as `sh build.sh`. The script is named **to its shell**, never run as `./build.sh`, so a
script without its executable bit still runs, and one with it runs the same. The name is quoted when
a shell would read it differently (`"a b.sh"` becomes `'a b.sh'`).

The page rescans when the current pane or its repository changes, when one of its options changes,
and on the ↻ button.

## Options

All of them are under **Scripts** in Settings.

- `npm_scripts` — list the scripts of every `package.json` (default on).
- `shell_scripts` — list the shell scripts (default on).
- `show_command` — show what each script runs, beside its name (default on).
- `sort` — order the groups by `path` (default) or the ones with `scripts` the most first.
- `max_depth` — how many directories below the repository root to look in, 1 to 10 (default 4).
- `extensions` — which file extensions are shell scripts, separated by commas (default `sh, bash,
  zsh, ksh, fish`).
- `shebang` — also list files with no extension whose first line names a shell (default on).

## What it touches

It reads the repository's files (`files`), and opens a terminal pane to run a script in
(`processes`). It is a Bun package: it runs in a worker of its own, at startup
(`activation: onStartup`), and puts its page in the sidebar — below the files page, titled
**Scripts** — unless one is there already.

The page itself is [`script-panel`](../lib/script-panel): this package is the finder that says what
a directory holds (`src/packages.ts` and `src/shells.ts`, joined in `src/read.ts`), and the export
the manifest's `contributes.slots.panel` names.

## Working on it

```sh
bun test                          # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit  # the types
```

`test/files.ts` writes the tests' temporary repositories. `test/packages.test.ts` is the package
half (the managers, the groups, the walk), `test/shells.test.ts` the shell half (what a script is,
the shell it runs with), `test/read.test.ts` both at once (which kinds, the order, what the page
says when there is nothing), and `test/manifest.test.ts` what its `package.json` contributes
without running.
