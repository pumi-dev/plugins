# pi-session

Two buttons at the end of a [pi](https://github.com/) pane's strip, past its dot and title: **Fork**
opens `pi --fork <session>` in a pane beside it, in the same directory; **Copy** puts the session's
id, path and directory on the clipboard.

```text
  ● pi  src/pumi                           ⌥ ⌘ ✕
                                   ⑂  ⧉
```

They are drawn in the pane's own `PaneStrip` slot, at the row's end, so they ride the strip the pane
already has rather than a bar of its own: they show with the pane's own split and close buttons.

A pane is pi's when its agent's hook said so: `@agent` is `pi` and `@agent_session` is set — what
`pumi skill setup pi` writes. A pane that stops being pi's loses its buttons, and one that becomes
pi's gets them. The session is read from the pane each time a button is pressed, so a fork or a copy
is of the session the pane is in now, not the one it started in.

## What a session is

`@agent_session` is an id, or the path of a session file. An id is a UUID; a file's is its name's
(`<time>_<id>.jsonl`) or its first record's (`{"type": "session", "id": …}`). Copy writes:

```text
pi session 0198c3e2-7a51-7c62-9a53-3f1a2b4c5d6e
path: ~/.pi/sessions/2026-10-17T10-00-00_0198c3e2-….jsonl
cwd:  ~/src/pumi
```

The path is there when the hook reported one, the directory when the pane has one.

## Options

- `pi_session.side` — where the fork goes: `right` (default) or `down`.
- `pi_session.command` — the program run with `--fork <session>` (default `pi`).
- `pi_session.focused_only` — the buttons on the focused pi pane alone, not on every pi pane's strip
  (default off; they are drawn with the pane's own strip buttons, so on a pane they show on the
  focused or hovered one and hide with it).

All three are under **Pi session** in Settings.

## What it touches

It reads the session file's first record when the hook gave a path rather than an id (`files`), and
opens a terminal pane running the fork (`processes`). It is a Bun package: it runs in a worker of its
own, at startup (`activation: onStartup`), so the buttons are there for the panes an app restores
with their sessions.

## Working on it

```sh
bun test                          # the package against pumi/testing's fake app
./node_modules/.bin/tsc --noEmit  # the types
```

`test/fake.ts` is the fake app with the panes there are and what each says of itself: a test puts a
pane in a scene, says what it reports, fires the event, and looks at what the package asked for.
