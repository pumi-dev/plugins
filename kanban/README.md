# Kanban

A board of **cards** for pumi, over the window: a brief you write, an agent that takes it in a tab
of its own, and a board that follows the card from Queued to In progress to Needs you to Done —
without you moving a thing. It shows **every agent pumi is running**, not just the ones it started:
an agent in a terminal of yours is a card too, in the lane its own status puts it in.

Open it from the icon at the side bar's foot — next to the sessions, agents and git buttons — with
`pumi call amresyd.kanban.open`, from the palette, or a chord you bind in Settings. It is drawn
over the whole window, above the views and the side bar: not a tab, not a split, not a side bar panel.
Escape or a click outside it takes it away. **Click a card and you are at that agent**: the board
closes on the way there.

Where a task board asks you to move cards to keep it honest, Kanban reads the lane off the agent:
`@agent.status` says working, so the card is *in progress*; blocked, failed or done with its turn,
so the card *needs you* — which is exactly when a person is wanted. Drag a card and the lanes show
the verb they would give it (Start, Park, Finish, Start again); let go and it happens.

```text
Queued ──drop──▶ In progress ──agent works──▶ Needs you ──drop──▶ Done
   ▲                  │                          │
   └────── Park ◀─────┘                          └── Go to agent, finish it, message it
```

## What it does

- **Add a card** with `n`, or **New card**. The brief is the agent's first message, so write the
  whole ask in it. The folder and the agent's command line are per card; the defaults are options.
- **Drop it on In progress** (or double-click it) and the agent opens *beside the board* — the board
  stays in view while the agent works — and the brief is handed over: queued through the agent's
  hooks when it takes queued messages, typed into the tab when it does not.
- **Needs you is the inbox that matters**: blocked, a failure, or a finished turn. A card says why,
  for how long, how many turns it has taken, what is queued for it, and what the agent last said.
- **Park** stops the agent and puts the card back in Queued with its brief and its last words.
  Starting it again opens a fresh tab and tells the agent where the last attempt stopped.
- **Finish** closes the agent, files the card as done, and keeps the last `keep_landed` done cards.
  Done cards still have a `Start again` and a `Reopen`.
- **Message a card's agent** without typing into its TUI, from a shell: `pumi call
  amresyd.kanban.message %4 "run the tests again"` queues it for the end of the agent's turn.
- A notification when an agent blocks, fails or finishes its turn (turn it off with `notify`).
- Everything survives a restart: `paths.state/flights.json`. Tabs that are gone are let go, and the
  cards go back to Queued rather than pretending.

## The cool parts

- **The lanes are verbs while you drag.** Each lane lights up with what dropping there would do, and
  a card you cannot do anything with on that lane refuses the drop. No hidden rules.
- **The drag ghost** follows the pointer, so a drag is never a guess.
- **A working card is marked the app's way**: the spinner where its status mark sits, in the
  agent's status colour, and the stopwatch in the corner.
- **A lane is never a lie**: the board reads the agents, it does not bookkeep them.
- **The board is an overlay, not a tab**: nothing is split, no view is made, and the side bar's own
  button is where it is opened from.
- **The composer**: `n`, a brief, `⌘↵`. The agent is already opening next to you.

## Keys

| | |
| --- | --- |
| `n` | add a card |
| `/` | search the board |
| `esc` | close the composer, else the board |
| `⌘↵` | in the composer: add the card and start it |
| click a card | go to its agent (a card with no agent starts one first) |

Bind a chord to the board with the `key` option, in Settings under **Kanban** (`<M-f>`, say).

## Options

| Option | By default | |
| --- | --- | --- |
| `agent` | `pi` | The command line a card's agent starts with, when the card has none. |
| `open` | `beside` | `beside` opens the agent's tab on the right of the tab you are in; `tab` gives it a view of its own. |
| `close_on_land` | `true` | Finishing a card closes the agent's tab. |
| `notify` | `true` | A notification when an agent blocks, fails or finishes a turn. |
| `keep_landed` | `24` | How many finished cards the board keeps. |
| `key` | empty | A chord that opens the board from anywhere. |

## From a shell

```sh
pumi call amresyd.kanban.new                       # the board, with the composer up
pumi call amresyd.kanban.create "Fix the flaky test" --launch
pumi call amresyd.kanban.list
pumi call amresyd.kanban.land f3
pumi call amresyd.kanban.message f3 "also update the changelog"
```

Functions: `open`, `go`, `hide`, `new`, `list`, `create`, `launch`, `land`, `park`, `revive`,
`message`, `remove`, `close`, `clear`. Every one is also an export the board's own view calls. The overlay's own option
is `shown` (in the plugin's store); `pumi call amresyd.kanban.hide` takes the board away from a
script.

## How it is put together

```text
package.json      the manifest: the commands, the options, the overlay and the side bar's button
src/flight.ts     what a card is and the rules — lanes, drops, prompts, the disk's shape (no pumi)
src/ui/view.ts    what a lane says, how cards are grouped and searched (no pumi)
src/main.ts       the worker: the board on disk, the agents' tabs, the verbs, the notifications
src/ui.tsx        the board: header, lanes, drops, the drag ghost, the composer; the window overlay
src/ui/card.tsx   a card, and the ghost a drag carries
src/ui/panels.tsx the composer
src/ui/kit.tsx    the theme's colours at an alpha, the marks, the chips
test/             the rules, without pumi: `bun test`
```

A card's chrome is the window's own: `t.surface` for a card on its lane, `t.editor` for the lane,
`t.border` for both, the theme's radii and font sizes, and the app's `status_spinner` — turning once
a second, in the agent's status colour — for a working card.

An agent is only in its lane if pumi knows what it is doing: `pumi skill add` installs the status
hooks for your agents. Without them, `deliver` still gets the brief in by typing it into the tab, but
the board has nothing to read and the card will sit in Needs you after the warm-up rather than telling
you what happened.
