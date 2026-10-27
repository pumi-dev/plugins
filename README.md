# pumi-plugins

Community packages for [pumi](../pumi). Each directory is one package
([pumi.dev/docs/packages](https://pumi.dev/docs/packages/)): TypeScript on Bun, whose
`package.json`'s `pumi` key is its manifest — what it contributes, without running it. Its
`src/main.ts` runs in a worker (the logic: functions, events, options), and its `src/ui.tsx`
draws in the window; both `import … from "pumi"`.

| Package | What it does | What it draws |
| --- | --- | --- |
| `tab-rename` | Names each tab after what its agents are working on, with Apple's on-device model | nothing: the tabs' names |
| `attention` | Says so when an agent is blocked and you are looking elsewhere; `@attention` counts them | nothing: `@attention` and a notice (no `ui.tsx`) |
| `nudge` | A notification from the OS when an agent is blocked or done, and gone when it stops being either | nothing: the notice (no `ui.tsx`) |
| `heavy-terminals` | Finds terminals using too much CPU or memory and suspends their job (`HeavyWake` resumes it) | nothing: `@heavy`, a notice, `HeavySleep`/`HeavyWake` |
| `scripts` | Every `package.json` script in the current repository, workspaces included, and every shell script beside them; click to run. Which kinds are listed is an option, both on by default | a section of the side bar (`panel`) |
| `pi-session` | Buttons on every pi pane's strip: Fork opens `pi --fork <session>` beside it, Copy copies the session | buttons in the strip (`pane.strip`) on pi panes |
| `pumi-dog` | A little dog walking along its track | a section of the side bar (`panel`) |
| `insert-path` | Type `/` in a terminal and pick a file: a floating fuzzy picker types the path in | a float over the tab (its own block) |
| `pane-switcher` | Alt-Tab for panes: a row of cards showing what each pane holds, to pick one | a float over the window (its own block) |
| `agent-overview` | Every agent in this pumi in one place: who is working, who is blocked, and where; click a row to go to its pane | a tab of its own |
| `queue` | Commands that run one at a time, each after the pane it waits for is done; one bar under each pane with its jobs | a bar (`pane.strip`) on the panes that have work |
| `perf` | How the app is doing: CPU, memory, frames, core plugins and the busiest threads, from `app.perf` (Cmd-Alt-P) | a float over the whole window, in a corner |
| `win98` | A UI theme: Windows 98, with a window for each tab and a Start menu of your plugins | the whole window (`themes/win98`) |
| `win7` | A UI theme: Windows 7, with Aero glass around a window for each tab, a Superbar with the Start orb, and a Start menu with its search box | the whole window (`themes/win7`) |
| `office` | A UI theme: a pixel office with a desk for each tab; drag desks around, and they stay | the whole window (`themes/office`) |

`lib/script-panel` is what the `scripts` page is built on: the walk, the grouped list, running a
script in a terminal.

## Install

This repository sits beside a pumi checkout (`../pumi`), whose `runtime/app` is the SDK. Link
it into every package's `node_modules` first:

```sh
bun tools/link.mjs                     # the SDK's types as @pumid/types, once and after adding a package
bun install                            # a package's own npm dependencies
```

Then, in the pumi checkout, a package is added by its directory: `pumi plugin add` links it and
the app starts it; `pumi plugin dev` runs it as you edit it; `pumi plugin update` picks up a
change; and `pumi plugin logs <name>` shows its output.

```sh
pumi plugin add ./scripts              # links it; the app runs its worker and draws its slots
pumi plugin dev ./scripts              # or: reload it on every save, while you work on it
```

Its options are in Settings under each package's name (`npm_scripts.max_depth`,
`pi_session.side`, …), or as `pumi option set`. `pi-session` needs pi's hook
(`pumi skill add pi`), which records `@agent` and `@agent.session` on the pane.

## Test

Each package's logic is tested on its own, with no pumi running:

```sh
bun test                               # every package's (bun tools/all.mjs)
cd <pkg> && bun test                   # one package's
cd <pkg> && ./node_modules/.bin/tsc --noEmit -p .   # its types
```

What a package does with the API itself is exercised in the app, with
`pumi plugin dev`.

## License

GPL-3.0-or-later; see [LICENSE](LICENSE). `palette/src/nucleo.ts` is MPL-2.0. Third-party code, including Zed's, is listed in [NOTICE](NOTICE).
