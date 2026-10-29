# pi-session

Two buttons in a pi tab's strip, beside its split and close: **Fork** opens
`pi --fork <session>` in a tab beside it, in the same directory; **Copy** puts the session's id,
path and directory on the clipboard.

```text
  ● pi  src/pumi                     ⑂ ⧉ ◫ ⊟ ✕
```

They are the manifest's `contributes.slots["tab.toolbar"]` component (`ui.tsx`'s `Toolbar`), drawn
with `IconButton` from `pumi`, so the theme draws them as it draws the tab's own split and close
buttons. The component draws nothing for a tab that is not pi's.

A tab is pi's when its agent's hook said so: the Agents plugin's trait `pumi_dev.agents.agent` has
`pi` as its id and its `session` field set (`@pumi_dev.agents.agent`,
`@pumi_dev.agents.agent.session`) — what the Agents plugin's pi hooks write on the tab (Settings →
Agents). A tab that stops being pi's loses its
buttons, and one that becomes pi's gets them. The session is read from the tab each time a button is
pressed, so a fork or a copy is of the session the tab is in now, not the one it started in.

## What a session is

`@pumi_dev.agents.agent.session` is an id, or the path of a session file. An id is a UUID; a file's is its name's
(`<time>_<id>.jsonl`) or its first record's (`{"type": "session", "id": …}`). Copy writes:

```text
pi session 0198c3e2-7a51-7c62-9a53-3f1a2b4c5d6e
path: ~/.pi/sessions/2026-10-17T10-00-00_0198c3e2-….jsonl
cwd:  ~/src/pumi
```

The path is there when the hook reported one, the directory when the tab has one.

## Options

Its three options are under **Pi session** in Settings, and their full names start
`amresyd.pi_session.`:

- `side` — where the fork goes: `right` (default) or `down`.
- `command` — the program run with `--fork <session>` (default `pi`).
- `focused_only` — the buttons on the focused pi tab alone, not on every pi tab's strip (default
  off).

## What it touches

It reads the session file's first record when the hook gave a path rather than an id (`files`), and
opens a shell tab running the fork (`pumi_dev.terminal.shell`, the Terminal plugin's, `processes`).
It is a Bun package: it runs in a worker of its own, at startup (`activation: onStartup`), so the
buttons are there for the tabs an app restores with their sessions.

## Working on it

```sh
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit  # the types
```

`test/fake.ts` is the fake app with the panes there are and what each says of itself: a test puts a
pane in a scene, says what it reports, fires the event, and looks at what the package asked for.
