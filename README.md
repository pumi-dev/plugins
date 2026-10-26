# pumi-plugins

Community packages for [pumi](../pumi). Each directory is one package ([pumi.dev/docs/packages](https://pumi.dev/docs/packages/)): its
wasm UI plugin (`ui/`, gpui compiled to `wasm32-wasip2`) that the app runs, and its data. The
server runs no package code: a package declares its options, places its
panes and registers its autocmds from its plugin's `init`.

| Package | What it does | What it draws |
| --- | --- | --- |
| `tab-rename` | Names each tab after what its agents are working on, with Apple's on-device model | nothing: the tabs' names |
| `attention` | Says so when an agent is blocked and you are looking elsewhere; `@attention` counts them | nothing: `@attention` and a notice (no `ui.tsx`) |
| `nudge` | A notification from the OS when an agent is blocked or done, and gone when it stops being either | nothing: the notice (no `ui.tsx`) |
| `heavy-terminals` | Finds terminals using too much CPU or memory and suspends their job (`HeavyWake` resumes it) | nothing: `@heavy`, a notice, `HeavySleep`/`HeavyWake` |
| `scripts` | Every `package.json` script in the current repository, workspaces included, and every shell script beside them; click to run. Which kinds are listed is an option, both on by default | a section of the side bar (`panel`) |
| `pi-session` | Buttons on every pi pane's strip: Fork opens `pi --fork <session>` beside it, Copy copies the session | buttons in the strip (`pane.strip`) on pi panes |
| `pumi-dog` | A little dog walking along the status bar | a dog in the status bar (`status`) |
| `insert-path` | Type `/` in a terminal and pick a file: a floating fuzzy picker types the path in | a float over the tab (a `views` pane) |
| `pane-switcher` | Alt-Tab for panes: a row of cards showing what each pane holds, to pick one | a float over the window (a `views` pane) |
| `agent-overview` | Every agent in this pumi in one place: who is working, who is blocked, and where; click a row to go to its pane | a tab of its own |
| `queue` | Commands that run one at a time, each after the pane it waits for is done; one bar under each pane with its jobs | a bar (`pane.strip`) on the panes that have work |
| `perf` | How the app is doing: CPU, memory, frames, core plugins and the busiest threads, from `app.perf` (Cmd-Alt-P) | a float over the whole window, in a corner |
| `win98` | A UI theme: Windows 98, with a window for each tab and a Start menu of your plugins | the whole window (`themes/win98`) |
| `win7` | A UI theme: Windows 7, with Aero glass around a window for each tab, a Superbar with the Start orb, and a Start menu with its search box | the whole window (`themes/win7`) |
| `office` | A UI theme: a pixel office with a desk for each tab; drag desks around, and they stay | the whole window (`themes/office`) |

`lib/script-panel` is what the `scripts` page is built on: the walk, the grouped list, running a
script in a terminal.

## Build

This repository sits beside a pumi checkout (`../pumi`), whose `crates/pumi-plugin` is the
SDK. The toolchain and the `wasm32-wasip2` target are pinned (`rust-toolchain.toml`,
`.cargo/config.toml`), so building is:

```sh
cargo build --release                                  # every package's ui/ component
cargo test --target aarch64-apple-darwin --workspace   # their logic, natively
```

The components land in `target/wasm32-wasip2/release/<crate>.wasm`; the app finds a
package's component there, through the link `pumi pack add` makes.

## Install

```sh
pumi pack add ~/Kitchen/pumi-plugins/scripts           # links it; the app runs its component, which declares its options
pumi plugin reload                                    # the app picks up a rebuilt component
```

Options are in Settings under each package's name (`npm_scripts.max_depth`,
`pi_session.side`, …). `pi-session` needs pi's hook (`pumi skill add pi`), which records
`@agent` and `@agent.session` on the pane.

## Test

Each package's logic is tested natively, with the build above:

```sh
cargo test --target aarch64-apple-darwin --workspace
```

The headless Lua specs are gone with the server's Lua: what a package does with
the API is only exercised in the app.
