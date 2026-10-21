# queue

Commands that run **one at a time**, each after the pane it waits for is done — and a bar under
each pane that has one, showing its jobs.

```
  %3  pi  ───────────────────────────────
        ...terminal...
  ───────────────────────────────────────
   queue   1 running · 2 waiting
   ▶ make deploy      in %7 · 0:42
   · cargo test       after %3 · done
   · ./notarize.sh    next
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

One under each pane that has work, in its `winbar.bottom`: the jobs waiting for that pane, the
one running in it, and a job that is over for ten seconds after. A row goes to the pane it is
about — the one it waits for, or the one it was added from — so a click focuses it; `✕` cancels
a job that has not started.

The bar is as many rows as it has jobs (`queue.rows` at most), because the app gives a winbar the
height the views in it ask for (`@rows`, one row by default). On an app older than that, the bar
is one row and draws the queue as a single line — it still works.

## Options

- `queue.rows` — the most rows a bar takes (default 4).
- `queue.keep` — a finished job's own pane stays open with its output (default true). The pane is
  the job's record: `queue.clear` closes it.
- `queue.notify` — say when a job is over, as the OS says it (default true).

## Limits

The queue lives in the app (a package's component, 23), so it is while the app is open; a
component that traps and restarts loses what it held. Waiting is event-driven: a plugin's
`api::call` blocks its only thread, so there is no `await` here — `OptionSet`, `TermClose` and
`PaneClosed` end a wait, and a half-second look covers the rest while there is work.

`pumi wait-pane` (the tmux package) is the same idea on the command line, for a shell that can
block: `pumi wait-pane -t %3 --until '#{==:#{@agent_status},done}' && ./next`.
