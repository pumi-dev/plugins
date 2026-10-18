# pumi-plugins

Community packages for [pumi](../pumi). Each directory is one package (pumi's docs/v2/07): its
wasm UI plugin (`ui/`, gpui compiled to `wasm32-wasip2`) that the app runs, and its data. The
server runs no package code (pumi's docs/v2/23): a package declares its options, places its
panes and registers its autocmds from its plugin's `init`.

| Package | What it does | What it draws |
| --- | --- | --- |
| `attention` | Says so when an agent is blocked and you are looking elsewhere; `@attention` counts them | nothing: `@attention` and a notice |
| `heavy-terminals` | Finds terminals using too much CPU or memory and suspends their job (`HeavyWake` resumes it) | nothing: `@heavy`, a notice, `HeavySleep`/`HeavyWake` |
| `npm-scripts` | A sidebar page of every `package.json` script in the current repository; click to run | a page in the left sidebar |
| `shell-scripts` | A sidebar page of every shell script in the current repository; click to run | a page in the left sidebar |
| `pi-session` | A bar on every pi pane: Fork opens `pi --fork <session>` beside it, Copy copies the session | a bar (a `winbar`) on pi panes |
| `pumi-dog` | A little dog walking along the status bar | a dog in the status bar |
| `insert-path` | Type `/` in a terminal and pick a file: a floating fuzzy picker types the path in | a floating picker over the tab |

`lib/script-panel` is what the two script pages share: the walk, the grouped list, running a
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
pumi pack add ~/Kitchen/pumi-plugins/npm-scripts      # links it; the app runs its component, which declares its options
pumi plugin reload                                    # the app picks up a rebuilt component
```

Options are in Settings under each package's name (`npm_scripts.max_depth`,
`pi_session.side`, …). `pi-session` needs pi's hook (`pumi skill setup pi`), which records
`@agent` and `@agent_session` on the pane.

## Test

Each package's logic is tested natively, with the build above:

```sh
cargo test --target aarch64-apple-darwin --workspace
```

The headless Lua specs are gone with the server's Lua (docs/v2/23 §4): what a package does with
the API is only exercised in the app.
