# tmux

tmux's language on pumi: its commands (`split-window -h ; select-pane -L`), formats, targets,
hooks, paste buffers, `wait-for`, `run-shell`/`if-shell` and the environment drive pumi's
sessions, so a tmux configuration, scripts and habits keep working. It provides `pumi_cmd`,
`pumi_exec2`, `pumi_parse_cmd`, `pumi_get_commands`, user commands, buffers and the environment
to every caller (`pumi split-window`, scripts, agents), and while it runs it binds tmux's prefix
table (`C-b` then a key) and the Session menu (`tmux.default_keys` turns that off).

It is a wasm plugin (`ui/`), so it runs in the app: **only while the app is open**. With the
app closed, sessions and programs go on, and tmux's commands are not there until it opens again.
Lua is not tmux's: `lua` and `source-file x.lua` point at the app's scripts.

Build with the workspace (`cargo build --release` in `ui/`, wasm32-wasip2); it needs a pumi
checkout beside this repository (`pumi-api`, `pumi-lang`, `pumi-layout`).
