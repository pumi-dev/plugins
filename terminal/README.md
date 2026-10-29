# terminal

A shell in a tab. pumi itself runs terminals (the PTY, the program, its screen and scrollback,
and keeping them alive across a restart) for any block that asks for them; the terminal is this
plugin: the block a new tab opens, and what draws it.

```sh
pumi plugin add pumi-dev/plugins/terminal
```

Without it, a new tab opens the launcher, which lists what the installed plugins can open.

```sh
pumi call pumi_dev.terminal.open                                  # a shell beside this tab
pumi call pumi_dev.terminal.open '{"command":["make","test"]}'    # a program instead
pumi tab open pumi_dev.terminal.shell '{"cwd":"/src"}' --split right
```

## New tabs

On its first run the plugin sets pumi's `new_tab` option to its block, so a new tab, split, view
or session is a shell. It does this once, and only while `new_tab` is empty: set `new_tab` to
something else (or back to empty, for the launcher) and it stays. It is also in the `+` menu's
list as Terminal.

## The block

`pumi_dev.terminal.shell` declares `"engine": "terminal"`: pumi opens it with
`{command, cwd, env, keep}`, starts its program again when it comes back, and answers the
terminal's methods (`read`, `input`, `run`, `wait`, `respawn`, `signal`, `clear_history`,
`modes`, `attach`). pumi's terminal options (`default_shell`, `history_bytes`, `remain_on_exit`,
`restore_command`) apply to it. `ui.tsx` draws it with `<terminal tab autoFocus>`.

Any plugin can declare a block of its own on the engine the same way, and draw it however it
likes.

## Testing

```sh
bun test
```
