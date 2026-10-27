# queue

Commands that run **one at a time**, each after the tab it waits for is done — and a bar in
each tab's strip that has one, showing its jobs.

```
  ───────────────────────────────────────
   ▶ make deploy   +2   in %7 · 0:42   ✕ →
  ───────────────────────────────────────
        ...terminal...
```

## Add a job

```sh
pumi call amresyd.queue.queue.add '{"command":"cargo test","after":"%3"}'
pumi call amresyd.queue.queue.add '{"command":"make deploy","run":"shell"}'
pumi call amresyd.queue.queue.list
pumi call amresyd.queue.queue.cancel '{"id":3}'
pumi call amresyd.queue.queue.clear
```

The functions are `queue.add`, `queue.list`, `queue.cancel` and `queue.clear` under the package's
prefix (`amresyd.queue.` when it is linked from this repository), so the full names say `queue`
twice.

| Field | |
| --- | --- |
| `command` | what is run, as a shell reads it (required) |
| `after` | the tab it waits for: `"%3"`, `3`, or `{"pane":3,"on":"done"}`. Omitted: it runs as soon as the one before it is over |
| `on` | what "done" means there: `done` (default), `idle`, `exit` |
| `run` | where it runs: `new` (a terminal tab of its own, the default), `shell` (headless, in the app), or a tab id to type it into (`"pane:%7"`, `"%7"`) |
| `cwd` | its directory; by default the waited-for tab's, or the caller's |
| `name` | what the bar calls it; by default the command's first line |

The queue runs one job at a time, in the order they were added, skipping the ones whose tab is
not done yet.

## What "done" means

pumi already knows, and the queue only reads it:

- **`done`** — the tab's program reported it over (`@agent.status`, OSC 7501: an agent's turn,
  a tool that reports itself), **or** its shell has the terminal again
  (`tab_foreground_pgid == tab_pid`), which is what a plain `make test` looks like. A `blocked`
  program (one waiting for permission) is not done.
- **`idle`** — only the shell being back, and nothing reporting that it works.
- **`exit`** — the tab's program exited (`tab_dead`). This is what a job's own tab uses.

A tab typed into (`run: "%7"`) is armed when the keys go in: it is not "done" until it has been
seen busy, or 2 s have passed with it at rest (a command too quick to see, `true`, `echo hi`).

## The bar

One in each tab's strip that has work — the manifest's `contributes.slots["tab.strip"]` component,
which draws nothing for a tab the queue has no job for: the jobs waiting for that tab, the one running
in it, and a job that is over for ten seconds after. It is one line: the job that matters at the
moment, how many follow it, and how many are over. The line goes to the tab it is about — the one
it waits for, or the one it was added from — so a click focuses it; `✕` cancels a job that has not
started.

## Options

- `keep` — a finished job's own tab stays open with its output (default true). The tab is the
  job's record: `queue.clear` closes it.
- `notify` — say when a job is over, as the OS says it (default true).

Their full names start `amresyd.queue.`.

## How it runs

A TypeScript package: pumi's Bun host runs it in a worker of its own while the app is open, so the
queue is while the app is open too, and a worker that is restarted loses what it held (a job's tab
is its record). Waiting is event-driven — `tab.changed` on the tab's `@agent.status`,
`tab_foreground_pgid`, `tab_current_command` and `tab_dead`, `terminal.closed` and
`tab.closed` end a wait — and a bar looks at the tabs it waits for twice a second while it has
work, now and then when it has none, for the ones that never fired an event. A job that runs in the
app is `sh -c` through `Bun.spawn`; one in a tab of its own is a `terminal` tab opened with its
command; one typed into a terminal is `tab.call(tab, "input", …)`.

```sh
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit -p .   # the types
```

A shell that blocks has the CLI's own words: `pumi wait %3` waits until that tab's program ends
and exits with its status (`--for 10m` for its own limit), and `queue.add` with `{"after": "%3"}`
is the same wait for a tab's agent:
`pumi call amresyd.queue.queue.add '{"command":"./next","after":"%3"}'`.
