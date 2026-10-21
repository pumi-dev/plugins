# shell-scripts

A page in the left sidebar of every shell script in the current pane's repository — the `*.sh`
files and the extension-less ones whose `#!` names a shell — each run in a terminal beside the pane
you are in.

```text
3 scripts · 2 places                           Rescan
▾ . 1
   top.sh       sh top.sh                     › sh top.sh
▾ scripts 2
   build.sh     bash build.sh                 › bash build.sh
   deploy       zsh deploy                    › zsh deploy
```

A click opens a terminal in that directory and types the script's line there, so the output is in a
pane of its own and the page stays where it is.

## The repository it lists

From the current pane's directory up to the nearest one with a `.git` (or the directory itself),
the page walks four directories down (`max_depth`) and lists the shell scripts it finds.
`node_modules`, `.git`, `dist`, `build` and the other directories no one keeps scripts in are not
walked into, nor are hidden or symlinked ones. Each directory is a group folding its scripts away,
headed by its path in the repository (`.` for the root's), with a count of the scripts under it. A
directory's scripts are listed by name.

## What is a script

A file is a script when

1. its extension is one of `extensions` (`sh`, `bash`, `zsh`, `ksh`, `fish` by default, either case,
   with or without the dot: `sh, .Bash` and `sh,bash` say the same); or
2. it has no extension and its first line — its first 160 bytes — is a `#!` naming one of the
   shells: `sh`, `bash`, `zsh`, `ksh`, `dash`, `ash`, `fish`. The line is read through `env` and
   its switches, so `#!/usr/bin/env -S zsh -e` is `zsh`; `#!/usr/bin/env python3` is no shell, and
   neither is a line that does not start with a `#!`. `shebang` turns this off, and then only the
   extensions count.

Files and directories starting with a `.` are left out, and so is anything that is not a file.

## How it runs them

The line typed is the shell the `#!` names; else the one its extension names, when that extension
is a shell's; else `sh`. So `build.sh` with `#!/usr/bin/env bash` runs as `bash build.sh`, and one
with no `#!` as `sh build.sh`. The script is named **to its shell**, never run as `./build.sh`, so a
script without its executable bit still runs, and one with it runs the same. The name is quoted when
a shell would read it differently (`"a b.sh"` becomes `'a b.sh'`).

The page rescans when the current pane or its repository changes, when one of its options changes,
and on **Rescan**.

## Options

All four are under **Shell Scripts** in Settings.

- `show_command` — show how each script runs, beside its name (default on).
- `max_depth` — how many directories below the repository root to look in, 1 to 10 (default 4).
- `extensions` — which file extensions are scripts, separated by commas (default `sh, bash, zsh, ksh,
  fish`).
- `shebang` — also list files with no extension whose first line names a shell (default on).

## What it touches

It reads the repository's files (`files`), and opens a terminal pane to run a script in
(`processes`). It is a Bun package: it runs in a worker of its own, at startup
(`activation: onStartup`), and puts its page in the sidebar — below the files page, titled **Shell
Scripts** — unless one is there already.

The page itself is [`script-panel`](../lib/script-panel): this package is the finder that says what
a directory holds, its view, and its place in the sidebar.

## Working on it

```sh
bun test                          # the package against pumi/testing's fake app
./node_modules/.bin/tsc --noEmit  # the types
```

`test/scripts.test.ts` is the finder (what a script is, the shell it runs with, the walk and the
options), `test/page.test.ts` the page itself, its groups and a script run from it,
`test/place.test.ts` its sidebar page, and `test/manifest.test.ts` what its `package.json`
contributes without running.
