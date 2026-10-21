# herdr

herdr's API on pumi. The package serves `herdr.sock` and `herdr-client.sock`, so herdr's clients
— its CLI, its mobile apps — drive pumi's panes and show them live: a session is a workspace, a
tab is a tab, a pane is a pane.

The protocol is herdr's own (v0.9.x, newline-delimited JSON, protocol 22); `ping`, `pane.read`
and `events.subscribe` are the parts worth knowing. herdr's public ids come from pumi's:
session `$5` is `w5`, its tab `@7` is `w5:t7`, its pane `%9` is `w5:p9`, terminal `term_9`.

Nothing here keeps a screen: `pane.read` is the core's own text (`pumi_pane_call`'s `read`),
keys are `{"keys": […]}` on the same call, and what an agent is doing is the pane's
`@agent`/`@agent_status` (OSC 7501). Methods herdr serves from its own TUI, plugins or remotes
answer `unsupported`.

The sockets are in pumi's data directory — `$PUMI_DATA_DIR`, else
`~/Library/Application Support/pumi` (macOS) or `~/.local/share/pumi` — and, as herdr keeps a
named session, in `~/.config/herdr/sessions/<herdr.session>/` (`pumi` by default; empty turns it
off). So pumi is one of herdr's sessions: `herdr session list` shows it, `herdr --session pumi …`
reaches it, and a herdr mobile app (Heeler) reaches it with the Host's session name set to
`pumi`. herdr's own `~/.config/herdr/herdr.sock` is left alone, so a real herdr runs beside it.

`herdr.session = default` serves herdr's own default session (`~/.config/herdr`) instead, so a
Host with no session name reaches pumi — but a herdr server already running there owns that
socket, and only one process can: pumi then says so in its log and serves nothing there.

**herdr's "session" is a server, and a pumi session is one of its workspaces.** herdr keeps
several servers side by side (`default`, `pumi`, …); Heeler's session picker lists those, not
pumi's sessions. Inside the `pumi` server, pumi's sessions are the workspaces, its tabs are the
tabs, and its panes are the panes — a herdr server that is already running is a separate one, and
the two cannot share state.

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

herdr's default keys come with it: while it runs, the prefix table (`C-b`, then the key) is
herdr's — `v` and `-` split, `h` `j` `k` `l` move between panes, `H` `J` `K` `L` resize, `c`
`n` `p` `X` and `1`–`9` for tabs, `N` `D` `[` `]` for workspaces, `x` and `z` for the pane.
`herdr.default_keys` off leaves the prefix table as it was. herdr's keys for its own TUI (help,
settings, detach, the agent list) have no counterpart in the API and are not bound.

Ported from `pumi/core/herdr` (herdr on pumi).
