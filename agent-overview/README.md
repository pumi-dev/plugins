# agent-overview

Every agent in this pumi in one pane: who is working, who is blocked, and where. The rail on the
left narrows the list by state and by name; a row picks an agent, and a second press goes to its
pane.

```text
┌ Agent overview ─────────────┬ Agents › Overview ─────────────────── updated 4s ago  Refresh ┐
│ ▤ Overview             3    │ Agent overview                                                │
│ ⚠ Needs you            2    │ 3 of 3 agents · 2 sessions · 2 need you                        │
│ ◌ Working              0    │ ┌─ WORKING 0 ──┐ ┌─ NEEDS YOU 2 ─┐ ┌─ DONE 0 ─┐ ┌─ IDLE 1 ─┐    │
│ ◎ Idle                 1    │ │ running now  │ │ blocked …    │ │ finished │ │ waiting  │    │
│ [ Filter agents          ]  │ └──────────────┘ └──────────────┘ └──────────┘ └──────────┘    │
│ MAIN                    2   │ AGENT     STATUS        SESSION   DIRECTORY     PROGRAM        │
│   ● claude  pumi  you       │ ● claude  needs perm…   main › a… ~/Kitchen/p…   claude         │
│   ● make    pumi            │ ● make    failed        main › b… ~/Kitchen/p…   make           │
│ WORK                    1   │ ● pi      Idle          work › r… ~/Other        pi             │
│   ● pi      other           │                                                               │
│ 3 agents · 2 sessions       │                                                               │
└─────────────────────────────┴───────────────────────────────────────────────────────────────┘
```

## Where it reads it

It reads nothing on its own. An agent says what it is doing itself, over OSC 7501, and the host
keeps that on the tab: `@program_status` for its records, `@status` for the most demanding of
them, and the Agents plugin's trait (`@pumi_dev.agents.agent`, `.session`) for who it is and which
conversation it is in — what
`pumi skill add` writes. The dashboard is the window's own state: it draws the app's panes, tabs
and sessions as they are (`usePanes`, `useTabs`, `useSessions`), so it moves when they do, without
reading anything on a clock.

Only panes placed in a tab are agents: a float, a slot and a detached pane are not, whichever block
they hold. A shell nobody has reported on is not one either; a program that said what it is doing
is, even when it never named itself. The table sorts what wants the user first — blocked, failed,
working, done, idle — then by session and tab.

## Options

Its four options are under **Agent overview** in Settings, and their full names start
`amresyd.agent_overview.`:

- `poll_secs` — how often it reads the model again (default 15, between 2 and 600).
- `hide_idle` — leave out agents that are only waiting for a prompt, except the pane you are in
  (default off).
- `rail_width` — how wide the rail is (default 248, between 180 and 380).
- `key` — a chord that opens the overview from anywhere, in the root key table (default none,
  `<M-a>` written as a chord). It is bound at startup and rebound when the option changes; empty
  binds nothing.

## What opens it

- Its command **Open the agent overview** in the palette, and its menu item under **View › Agent
  Overview**: a tab of its own named `agents`, or, when one is already open, the pane it is in.
- `pumi call amresyd.agent_overview.open` — the same, as a function.
- `pumi call amresyd.agent_overview.list` — every agent and what it is doing, for a script:
  `{agents, counts, sessions}`, each agent's `pane`, `agent`, `status` and `why`.
- The `key` option's chord, when it has one.

In the dashboard: `↓`/`ctrl+n`/`ctrl+j` and `↑`/`ctrl+p`/`ctrl+k` step the highlight, `enter` goes
to the highlighted agent's pane (or the first one the rail shows), `escape` lets the highlight go,
and a press on a row picks it — twice goes to its pane.

## Working on it

```sh
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit  # the types
```

`test/window.ts` is the fake window: two sessions, three agents, and the panes that are not agents
(a shell that reports nothing, a float). `test/overview.test.ts` is the model — which panes are
agents, what each is doing, the order and the filters; `test/status.test.ts` the states and the
rail's four filters; `test/manifest.test.ts` what the package contributes without running.
