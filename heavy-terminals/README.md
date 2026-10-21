# heavy-terminals

Notice terminals whose processes eat the machine — and put them to sleep: the foreground job is
suspended as ctrl+z would suspend it, and woken with `fg`.

```text
  %3 is heavy: 320% cpu, 840 MB            a notice, and `@heavy` on the pane
  HeavySleep %3   →  ^Z                    the job stops where it was
  HeavyWake %3    →  fg ⏎                  and goes on
```

It draws nothing: every `interval` seconds it measures every terminal on a timer of its own, marks
a heavy one with the pane option `@heavy` and says so in a notice. It also provides two functions
to sleep and wake one, for a user command of tmux's, a script, or `pumi call`.

## How it measures

Each round it lists the machine's processes — `system.process.list`, so the server's, where the
panes run, not the app's — and adds up what each terminal's program costs together with everything
that program started. That total is compared with two bars: `cpu` (100 is one core) and `memory`.

A terminal has to be over a bar `sustain` checks in a row before anything is said, so a burst of
compiling does not cry wolf. Then it is marked `@heavy` (`"320% cpu, 840 MB"`) and a warning says
`%3 is heavy: 320% cpu, 840 MB`. It is said once: while it stays heavy nothing more is said, and
once it is under the bars again the count starts over.

## Sleep and wake

```sh
pumi call amresyd.heavy_terminals.sleep --pane '%3'
pumi call amresyd.heavy_terminals.wake  --pane '%3'
```

The pane goes as an id (`3`), a table (`{"pane":3}`), a user command's `"%3"`, or not at all, for
the current pane. `sleep` types ctrl+z into it, as a person would, and leaves `@heavy` = `asleep`;
`wake` types `fg` and Enter, and takes `@heavy` away. Sleeping is ctrl+z, not a kill: the job
stops where it was and gets no CPU, and `fg` puts it back in the foreground.

With `auto_sleep` on, a terminal found heavy is put to sleep straight away — a build that eats the
machine stops itself rather than waiting for you.

## Options

- `interval` — how often every terminal is measured, in seconds (default 5).
- `cpu` — a terminal using more CPU than this is heavy; 100 is one core (default 150).
- `memory` — a terminal holding more memory than this is heavy, in MB (default 4096).
- `sustain` — how many checks in a row it must be heavy for (default 3).
- `auto_sleep` — suspend its foreground job right away (default false).

The options are read every round, so a change takes effect on the next one, with no restart.

## Limits

`%cpu` is the API's: CPU over the process's life (a decaying average where the OS keeps one), not
a delta over the interval — a program that has been up for a long time and only now starts to
spin is seen later than one that just started. `sustain` and `interval` are the knobs.

It is a package of its own (TypeScript, run by pumi's Bun host): it measures while an app is open,
and stops with it. A pane that closes is forgotten, so a reopened one starts its checks afresh.
