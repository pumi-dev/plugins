# nudge

A notification from the OS the moment an agent stops to wait for you or finishes a turn, so a long
turn does not need the window watched.

An agent reports what it is doing as it goes (OSC 7501, which the Agents plugin's hooks install —
Settings → Agents), and the core keeps it on the tab as `@status`. This watches that word:

| State | The notice |
| --- | --- |
| `blocked` | **Claude is waiting for you** — a permission, a question, a plan to approve |
| `done` | **Claude is done** — the turn ended, and its result is waiting |
| `error` | **Claude failed** — off until you ask for it |

The body is the tab's own title (`π - Fixing the keymap - pumi`), else its folder. The tab's id is
the notice's group, so a second notice for the same tab replaces the first rather than stacking,
and the notice goes when the state does: answer the agent, or look at the result, and the banner is
taken back. `working` and `idle` are not news.

A state must hold for 300 ms before it is told (a result the app puts in front of you is not news),
and one tab is told at most once every 2 seconds (agents go through states as they work). A state
whose switch is off has no notice; one left over from before the switch was turned off goes.

## For scripts and plugins

Each notice is also the plugin's own event, `amresyd.nudge.said`, with `{ tab, status, agent,
title, body }`: what was said, and about which tab.

```ts
on("amresyd.nudge.said", { match: "blocked" }, (e) => console.log(`${e.data.title}: ${e.data.body}`));
```

## Options

| Option | Default | |
| --- | --- | --- |
| `amresyd.nudge.blocked` | `true` | Say so when an agent is waiting for you. |
| `amresyd.nudge.done` | `true` | Say so when an agent finishes a turn. |
| `amresyd.nudge.error` | `false` | Say so when an agent fails. |
| `amresyd.nudge.sound` | `default` | `default` for the system's sound, a sound's name (`Glass`), or empty for none. |

## Trying it

**Nudge: send a test notification** (`amresyd.nudge.test`, in the palette) posts one, so the first
permission prompt happens when you ask for it rather than when an agent needs you. macOS keeps the
answer in System Settings → Notifications → pumi, so try it once: with notifications off for pumi
nothing is shown, and posting one does not say so.

The notification is a request (`request.open`, `kind: "notification"`), so it shows wherever pumi does — the OS's
notification centre on macOS, Windows and Linux. A notice sent with a tab can be clicked to show
that tab where the app handles the click; the notice itself is posted either way.

## In the window

None: the package is logic only. It contributes no slot, opens no pane, and draws nothing.
