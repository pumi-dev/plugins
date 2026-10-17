# pumi-plugins

Community packages for [pumi](../pumi): Lua that runs in the server, and where a package
draws, a UI plugin (`ui/`, gpui compiled to `wasm32-wasip2`) that the app runs. Each
directory is one package (pumi's docs/v2/07).

| Package | What it does | Halves |
| --- | --- | --- |
| `attention` | Says so when an agent is blocked and you are looking elsewhere; `@attention` counts them | Lua |
| `heavy-terminals` | Finds terminals using too much CPU or memory and suspends their job (`HeavyWake` resumes it) | Lua |
| `npm-scripts` | A sidebar page of every `package.json` script in the current repository; click to run | Lua + UI |
| `shell-scripts` | A sidebar page of every shell script in the current repository; click to run | Lua + UI |
| `pi-session` | A bar on every pi pane: Fork opens `pi --fork <session>` beside it, Copy copies the session | Lua + UI |
| `pumi-dog` | A little dog walking along the status bar | Lua + UI |

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
pumi pack add ~/Kitchen/pumi-plugins/npm-scripts      # links it, runs its Lua, declares its options
pumi plugin reload                                    # the app picks up a rebuilt component
```

Options are in Settings under each package's name (`npm_scripts.max_depth`,
`pi_session.side`, …). `pi-session` needs pi's hook (`pumi skill setup pi`), which records
`@agent` and `@agent_session` on the pane.

## Test

The Lua halves have headless specs:

```sh
pumi --headless --clean -l attention/test/attention_spec.lua
pumi --headless --clean -l heavy-terminals/test/heavy_spec.lua
pumi --headless --clean -l pi-session/test/pi_session_spec.lua
```
