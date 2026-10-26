# herdr

herdr's API on pumi. The package serves `herdr.sock` and `herdr-client.sock`, so herdr's clients
— its CLI, its mobile apps — drive pumi's panes and show them live: a session is a workspace, a
tab is a tab, a pane is a pane.

The protocol is herdr's own (v0.9.x, newline-delimited JSON, protocol 22); `ping`, `pane.read`
and `events.subscribe` are the parts worth knowing. herdr's public ids come from pumi's:
session `$5` is `w5`, its tab `@7` is `w5:t7`, its pane `%9` is `w5:p9`, terminal `term_9`.

Nothing here keeps a screen: `pane.read` is the core's own text (`pane.call`'s `read`), keys are
`{"keys": […]}` on the same call, and what an agent is doing is the pane's
`@agent`/`@agent.status` (OSC 7501). Methods herdr serves from its own TUI, plugins or remotes
answer `unsupported`.

The sockets are in pumi's data directory — `$PUMI_DATA_DIR`, else
`~/Library/Application Support/pumi` (macOS) or `~/.local/share/pumi` — and, as herdr keeps a
named session, in `~/.config/herdr/sessions/<session>/` (`session` is `pumi` by default; empty
turns it off). So pumi is one of herdr's sessions: `herdr session list` shows it,
`herdr --session pumi …` reaches it, and a herdr mobile app (Heeler) reaches it with the Host's
session name set to `pumi`. herdr's own `~/.config/herdr/herdr.sock` is left alone, so a real
herdr runs beside it.

`session = default` serves herdr's own default session (`~/.config/herdr`) instead, so a Host
with no session name reaches pumi — but a herdr server already running there owns that socket,
and only one process can: pumi then says so in its log and serves nothing there.

**herdr's "session" is a server, and a pumi session is one of its workspaces.** herdr keeps
several servers side by side (`default`, `pumi`, …); Heeler's session picker lists those, not
pumi's sessions. Inside the `pumi` server, pumi's sessions are the workspaces, its tabs are the
tabs, and its panes are the panes — a herdr server that is already running is a separate one, and
the two cannot share state.

## What it answers

| Method | |
| --- | --- |
| `ping` | herdr 0.9.4, protocol 22, and what it can do (`live_handoff`, `health_check`) |
| `server.stop` | stops pumi's core (`server.kill`) |
| `notification.show` | a notice: `request.open` |
| `session.snapshot` | workspaces, tabs, panes, agents, and who has the focus |
| `workspace.list`, `.get`, `.focus`, `.rename`, `.create`, `.close` | pumi's sessions (`session.*`) |
| `tab.list`, `.get`, `.focus`, `.rename`, `.create`, `.close` | pumi's tabs (`tab.*`) |
| `pane.list`, `.current`, `.get`, `.focus`, `.rename`, `.zoom`, `.clear`, `.split`, `.process_info`, `.close` | pumi's panes (`pane.*`) |
| `pane.read`, `agent.read` | the core's text, with `source`, `format` (`ansi` keeps colours) and `truncated: false` |
| `pane.send_text`, `.send_keys`, `.send_input`, `agent.send_keys` | typing, as `{"text": …}`, or keys by name |
| `pane.report_agent` | the pane's `@agent`, and its program status (OSC 7501) as the program would report it |
| `agent.list`, `.get`, `.focus` | panes with an `@agent` |
| `events.subscribe` | `subscription_started`, then herdr's event envelopes on the same connection |
| `pumi.server.restart` | pumi's live handoff |

Everything else in herdr's method list answers `unsupported` too: with its reason for herdr's TUI
(`command.invoke`, `popup.close`, the copy mode), its plugins (`plugin.*`), its remotes
(`server.ssh_agent.register`) and its agent manifests; and `… is not implemented by pumi yet` for
what pumi has no call for — the worktrees, layouts and moves, `agent.prompt`, `events.wait`,
`server.reload_config`, and pumi's own `pumi.*` methods.

## Live terminals

Beside each `herdr.sock` is `herdr-client.sock`, where herdr's own client attaches to a terminal:
`herdr agent attach <pane>` and `herdr terminal attach <terminal>`, which is how Heeler shows a
pane live (it runs the command in a PTY over SSH). herdr's server draws a pane from a screen it
keeps; pumi keeps none, and needs none here: an attach is a client of pumi's grid socket for that
pane, as the app's own panes are. Its snapshot and output go to herdr's client as herdr's
terminal frames (the snapshot without the queries in it, which the far terminal would otherwise
answer into the program), and what herdr's client sends comes back as typing, pastes, resizes and
mouse reports (a wheel on the alternate screen is arrow keys, as terminals do).

An attach controls the pane as herdr's does: the pane takes its size while it lasts, and the app
takes control back when someone types there. `C-b q` detaches. Only the direct attach is served;
herdr's TUI (`herdr` with no command, a client-owned shell) needs herdr's server.

Reaching the Mac is SSH's business: Heeler needs the Mac's own sshd (Remote Login), at its LAN or
its system Tailscale address. pumi's in-process Tailscale node listens for nothing SSH speaks.

## Keys

herdr's default keys come with it: while it runs, the prefix table (`C-b`, then the key) is
herdr's — `v` and `-` split, `h` `j` `k` `l` move between panes, `H` `J` `K` `L` resize, `c`
`n` `p` `X` and `1`–`9` for tabs, `N` `D` `[` `]` for workspaces, `x` and `z` for the pane.
`default_keys` off leaves the prefix table as it was. herdr's keys for its own TUI (help,
settings, detach, the agent list) have no counterpart in the API and are not bound.

## Options

- `session` (a string, `pumi`): the herdr session pumi answers as, as above.
- `default_keys` (a boolean, on): herdr's keys in the prefix table.

A package's own options go by their key; to anyone else they are `amresyd.herdr.session` and
`amresyd.herdr.default_keys`.

## How it is built

It is TypeScript on Bun, with no view of its own. `src/main.ts` reads the options, serves both
sockets and follows `session`; `src/api.ts` is herdr's methods over the API and `src/server.ts`
herdr's JSON socket; `src/client.ts` is the attach; `src/view.ts` reads pumi's sessions, tabs and
panes as herdr's.

Two wire formats are written by hand, because herdr's clients are herdr's own: `src/wire.ts` is
bincode 2 (herdr's client socket) and `src/grid.ts` is postcard (pumi's grid socket). Both agree
with the Rust they came from byte for byte, and their tests say so with vectors worked out from
it — that code is in `herdr/ui/` in this repository's history. The sockets are Bun's own
(`Bun.listen`, `Bun.connect`); a socket file another process answers on is left alone, and one a
crash left behind is taken over.

```sh
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit   # the types
```

Ported from herdr's own server (`pumi/core/herdr`), and then from this package's Rust.
