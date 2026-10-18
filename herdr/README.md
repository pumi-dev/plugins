# herdr

herdr's API on pumi. The package serves `herdr.sock`, so herdr's clients — its CLI, its mobile
apps — drive pumi's panes: a session is a workspace, a tab is a tab, a pane is a pane.

The protocol is herdr's own (v0.9.x, newline-delimited JSON, protocol 22); `ping`, `pane.read`
and `events.subscribe` are the parts worth knowing. herdr's public ids come from pumi's:
session `$5` is `w5`, its tab `@7` is `w5:t7`, its pane `%9` is `w5:p9`, terminal `term_9`.

Nothing here keeps a screen: `pane.read` is the core's own text (`pumi_pane_call`'s `read`),
keys are `{"keys": […]}` on the same call, and what an agent is doing is the pane's
`@agent`/`@agent_status` (OSC 7501). Methods herdr serves from its own TUI, plugins or remotes
answer `unsupported`.

The socket's path is the pumi data directory's `herdr.sock` — deliberately not herdr's own
`~/.config/herdr/herdr.sock`, so a real herdr can run beside it.

Ported from `pumi/core/herdr` (herdr on pumi, docs/v2/23-client-plugins.md §3 and §6).
