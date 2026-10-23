# queue

Commands that run **one at a time**, each after the pane it waits for is done — and a bar under
each pane that has one, showing its jobs.

```
  ───────────────────────────────────────
   ▶ make deploy   +2   in %7 · 0:42   ✕ →
  ───────────────────────────────────────
        ...terminal...
```

## Add a job

```sh
pumi call queue.add '{"command":"cargo test","after":"%3"}'
pumi call queue.add '{"command":"make deploy","run":"shell"}'
pumi call queue.list
pumi call queue.cancel '{"id":3}'
pumi call queue.clear
```

| Field | |
| --- | --- |
| `command` | what is run, as a shell reads it (required) |
| `after` | the pane it waits for: `"%3"`, `3`, or `{"pane":3,"on":"done"}`. Omitted: it runs as soon as the one before it is over |
| `on` | what "done" means there: `done` (default), `idle`, `exit` |
| `run` | where it runs: `new` (a pane of its own, the default), `shell` (headless, in the app), or a pane id (`"pane:%7"`, `"%7"`) |
| `cwd` | its directory; by default the waited-for pane's, or the caller's |
| `name` | what the bar calls it; by default the command's first line |

The queue runs one job at a time, in the order they were added, skipping the ones whose pane is
not done yet.

## What "done" means

pumi already knows, and the queue only reads it:

- **`done`** — the pane's program reported it over (`@agent_status`, OSC 7501: an agent's turn,
  a tool that reports itself), **or** its shell has the terminal again
  (`pane_foreground_pgid == pane_pid`), which is what a plain `make test` looks like. A `blocked`
  program (one waiting for permission) is not done.
- **`idle`** — only the shell being back, and nothing reporting that it works.
- **`exit`** — the pane's program exited (`pane_dead`). This is what a job's own pane uses.

A pane typed into (`run: "%7"`) is armed when the keys go in: it is not "done" until it has been
seen busy, or 2 s have passed with it at rest (a command too quick to see, `true`, `echo hi`).

## The bar

One under each pane that has work — the manifest's `contributes.slots["pane.strip"]` view, which
draws nothing for a pane the queue has no job for: the jobs waiting for that pane, the one running
in it, and a job that is over for ten seconds after. It is one line: the job that matters at the
moment, how many follow it, and how many are over. The line goes to the pane it is about — the one
it waits for, or the one it was added from — so a click focuses it; `✕` cancels a job that has not
started.

## Options

- `queue.keep` — a finished job's own pane stays open with its output (default true). The pane is
  the job's record: `queue.clear` closes it.
- `queue.notify` — say when a job is over, as the OS says it (default true).

## How it runs

A TypeScript package: pumi's Bun host runs it in a worker of its own while the app is open, so the
queue is while the app is open too, and a worker that is restarted loses what it held (a job's pane
is its record). Waiting is event-driven — `option.changed` on `@agent_status`,
`pane_foreground_pgid`, `pane_current_command` and `pane_dead`, `terminal.closed` and
`pane.closed` end a wait — and a bar looks at the panes it waits for twice a second while it has
work, now and then when it has none, for the ones that never fired an event. A job that runs in the
app is `sh -c` through `Bun.spawn`; one in a pane of its own is a `terminal` pane opened with its
command; one typed into a terminal is `pane.call(pane, "input", …)`.

```sh
bun test                       # the pure logic: no pumi running
bunx tsc --noEmit           # the types
```

`pumi wait-pane` (the tmux package) is the same idea on the command line, for a shell that can
block: `pumi wait-pane -t %3 --until '#{==:#{@agent_status},done}' && ./next`.
