# herdr parity

What this package answers today, against what herdr's own server does — and where each remaining
gap now sits, in pumi's target API.

**PROVENANCE.** herdr `5608de0` (server 0.9.4, protocol 22, `herdr api schema --json`); Heeler
`f98028b` (app 0.6.x, `Sources/Heeler/Transport/{HeelerSSHTransport,SSHTransportSettings}.swift`, its
`plugin/` and shared vectors); this package is the `herdr` one renamed to `heeler`, now the Host
itself (its own sshd, pairing, Tailscale and QR — see README.md). The herdr column is the real code
path in
`src/app/agents.rs`, `src/app/api/{agents,panes,tabs,workspaces,worktrees}.rs`,
`src/app/api_helpers.rs`, `src/worktree.rs` and `src/detect/mod.rs`; the pumi column is the target
surface (`../pumi/crates/pumi-api/src/surface.json`): the models, `tab.call`'s methods, `option.set`, the
`request` table and the public `*.opened`/`closed`/`changed` events.

## Scoreboard

| | |
| --- | --- |
| methods declared in `src/methods.ts` | 112 — 82 `served`, 30 `unsupported` |
| answered (`dispatch` in `src/api.ts`, `events.subscribe` in `src/server.ts`) | 39 |
| `served` with no handler | 44 |
| — of those, the target API answers | 24 (below) |
| — of those, nothing does | 12 (below) |
| — of those, herdr's own front end or detection | 5: `agent.explain`, `agent.view.set/clear`, `pane.link.activate/resolve` |
| — of those, this package's own work | 3: `agent.start`, `agent.prompt`, and `events.subscribe` (done) |
| Heeler's calls | its 24 Host calls; the ones this package cannot answer yet are `agent.start`, `agent.prompt`, `agent.rename` and `worktree.create/list/remove` |
| live evidence | `pumi plugin logs heeler`: `herdr.sock: agent.start → unsupported agent.start is not implemented by pumi yet` |

`served` means "we intend to", not "we answer": a `served` name with no `case` ends at
`throw new Fail(codes.UNSUPPORTED, …)`. Heeler's New Agent dies at step 2 of 4
(`tab.create` → `agent.start` → …) and rolls back the tab it created.

## What the target API answers

Twenty-four of the unhandled methods are one pumi function each, so each is a `case` that calls it:

| herdr | pumi |
| --- | --- |
| `events.wait` | `event.wait(event, {match, timeout})` |
| `pane.focus_direction` | `tab.focus(null, {direction})` |
| `pane.neighbor` | `tab.get(tab).neighbors` (`{left, right, up, down}`) |
| `pane.layout` | `view.get(view).layout`; a tab's own place is `tab.get(tab).place` |
| `layout.apply` | `view.update(view, {layout})` |
| `layout.set_split_ratio` | `view.update(view, {layout})`, the ratio written into the tree |
| `layout.export` | `view.get(view).layout` (herdr's own JSON shape stays this package's mapping) |
| `tab.move` | `view.update(view, {index})` |
| `workspace.move_block` | `tab.update(tab, {place})` |
| `pane.move` | `tab.update(tab, {place})` |
| `pane.swap` | `tab.update(tab, {place: {swap}})` |
| `pane.resize` | `pane.update(pane, {size})` |
| `pane.report_metadata` | `option.set(name, value, {ttl, source, seq})` on the tab's scope |
| `workspace.report_metadata` | the same, `{scope: "session", id}` |
| `pane.report_agent_session` | `option.set("@pumi_dev.agents.agent.session", key, {scope: "tab", id: tab})` |
| `pane.clear_agent_authority`, `pane.release_agent` | `option.set("@pumi_dev.agents.agent", null, {scope: "tab", id: tab})` |
| `agent.rename` | `tab.update(tab, {title})` for the tab the agent runs in |
| `agent.wait` | `tab.call(tab, "wait", {match})`, and `event.wait("tab.changed", {match})` when a status is what waits |
| `pane.input.set` | `tab.call(tab, "input", {text})`, `{paste}`, `{keys}`; `"run"` for a line and Enter |
| `pane.wait_for_output` | `tab.call(tab, "wait", {match})`, `{regex}`, `{exit: true}` |
| `pane.selection.read` | `tab.call(tab, "selection")` |
| `pumi.fs.dirs` | `fs.list(path, {hidden, recursive})` |
| `pumi.state` | `session.get(session)`, `tab.get(tab)` |

## What is really missing

No pumi function covers these. Each is either this package's own building, or herdr's front end:

| | |
| --- | --- |
| `worktree.create/list/open/remove` | nothing: the app keeps a worktree as a tab option (`worktree`) and runs its git in `runtime/app/app/worktrees.ts`. A package that wants herdr's worktree API has to build it, and none in this repository does |
| `workspace.move` | nothing: a session has a name, not an order (`session.update` takes `name`, `cwd`) |
| `pane.edges` | nothing: `tab.get` gives a tab's neighbors, not the view's outer edges |
| `pane.scroll` (the write) | `tab.get(tab).scroll` reads `offsetFromBottom`; scrolling a live tab is the client's own, over `tab.call(tab, "attach")` |
| `integration.install/list/uninstall` | the Agents plugin installs its hooks (Settings → Agents): no `pumi skill` any more |
| `pumi.server.info`, `server.reload_config` | internal functions, deleted in the target; `pumi server list` and `pumi server stop` are the CLI's, and settings reload themselves. `src/api.ts` still asks for `server.getState`, `server.kill` and `server.restart`, which the target no longer has: the Host's restart has to be its own |
| `agent.explain`, `agent.view.set/clear`, `pane.link.activate/resolve` | herdr's TUI and its detection engine: `unsupported`, with the reason in `src/methods.ts` |

## What else the answers differ on

| method | herdr | this package | effect |
| --- | --- | --- | --- |
| `pane.read` `source` | required: `visible`, `recent`, `recent_unwrapped`, `detection` | the API has `pane read --source visible\|recent\|unwrapped`, so `source` is now real (`detection` is not) | Heeler's Chat reads `source: visible` around a send and now gets the screen, not scrollback |
| `pane.process_info` | `shell_pid`, `tty`, `foreground_process_group_id`, `foreground_processes[]` | `pane.get` has `process {pid, command}`, `cwd`, `foregroundCwd` | the foreground process is the pane's, not a list of them |
| `workspace.create` | `source_workspace_id`, no `command` | `pane.open(block, args, {session: "new", cwd})` — a new session is a place, not a method | a herdr client gets the tab it asked for |
| `session.snapshot` | `layouts: PaneLayoutSnapshot[]` per tab | `session.get(session, {deep: true})` — the whole tree in one call | herdr's own layout shape stays a mapping |
| `agent.list` | every pane holding an agent | `pane.list({trait: "agent"})` | |
| `ping` | `capabilities.endpoint_protocol_generation` | none; `live_handoff: true` while pumi restarts | first thing a client reads |
| `pane.close`, `tab.close` | closes the tab, then the workspace, when it was the last pane | pumi prunes the tab, then an empty session | **matches**, nothing to do |

## Events

Heeler subscribes to 16 global lifecycle kinds: the 15 in `snapshotChangeKinds` —
`pane_agent_detected`, `pane_created`, `pane_closed`, `pane_exited`,
`workspace_created/renamed/metadata_updated/closed/moved/reordered`,
`tab_created/closed/renamed/moved`, `pane_moved` — plus `pane_updated`; it also subscribes to
`pane.agent_status_changed` per pane, and resyncs its whole console on any of the 15. See
`Console/HostConsoleProjection.swift`.

The target's events are one family per object, `opened`/`closed`/`changed {keys, patch}`, so the
translation is by key (`translate()` in `src/api.ts`):

| herdr | pumi |
| --- | --- |
| `workspace_created/closed/renamed/focused` | `session.opened`/`closed`/`changed {keys: ["name"]}`/`changed {keys: ["activeView"]}` |
| `tab_created/closed/renamed/moved/focused` | `view.opened`/`closed`/`changed {keys: ["name"] \| ["index"] \| ["activeTab"]}` |
| `pane_created/closed/moved/updated/exited` | `tab.opened`/`closed`/`changed {keys: ["place"] \| ["title"] \| ["cwd"] \| ["options.*"] \| ["exitCode"]}` |
| `pane_agent_detected` | `tab.changed {keys: ["options.@pumi_dev.agents.agent"]}` |
| `pane.agent_status_changed` | `tab.changed {keys: ["options.@status"]}` |

Nothing is missing any more except what the model has no field for: `workspace_updated/moved/
reordered` (sessions are not ordered) and `workspace_metadata_updated` beyond `option.changed`.

## The two designs, by nature

| | herdr | pumi |
| --- | --- | --- |
| what an agent is | a terminal whose foreground process matches a manifest, plus a managed name | a terminal tab the Agents plugin gave its trait (`@pumi_dev.agents.agent`), told by the agent's own hook (OSC 7501) |
| state | regexes over a kept screen (`detect/manifests/*.toml`) | `@status` from what the program reports; `blocked` from `request.open` |
| readiness | `launch_pending` → detected → `interactive_ready` | nothing; the hook's first report is the signal |
| "send a prompt" | paste + Enter into the TUI | paste and Enter into the tab, or `pumi_dev.agents.conversation.send` with the Agents plugin |
| worktrees | a workspace per worktree, with group membership bookkeeping | a tab option (`worktree`) inside a session, app-side git |

The two binary wire formats are the part already ported faithfully: `src/wire.ts` (bincode, herdr's
client socket) and `src/grid.ts` (postcard, pumi's grid), with vectors from the Rust they came from.

## What not to port

- The manifest/regex detection engine: pumi has no screen to scan, and an agent that reports itself
  needs none.
- Worktree *group* close confirmation (`confirmation_required`, `workspace_group_close_required`):
  only meaningful with herdr's workspace-per-worktree membership.
- `pane.copy_motion`, `pane.copy_search`, `pane.edit_scrollback`, `command.invoke`, `popup.close`:
  they belong to herdr's TUI, and this package already answers `unsupported` with a reason.

## Work order

1. `agent.start` and `agent.prompt`: paste and Enter through `tab.call(tab, "run", {command})`,
   herdr's nine error codes, and `option.set("@pumi_dev.agents.agent", kind, {scope: "tab"})` for the
   Agents plugin's trait. `tab.call(tab, "wait", …)` is the foreground check.
2. `agent.rename` (name rules, uniqueness, by-name targets), then the 24 `case`s of "What the target
   API answers".
3. `worktree.*` — the only real build: `Bun.spawn git`, porting
   `runtime/app/app/worktrees.ts` (`parse`, `nameOf`, `placeFor`, `newName`), session-per-worktree.
4. The Host's restart without `server.*` (see "What is really missing"), then the honesty pass: every
   `served` name that has no handler becomes `unsupported(name, "…")`, with
   `test("every served method has a handler", …)` in `test/methods.test.ts`.

## Appendix: the 44 `served` methods with no handler

Answer in the target (24): `agent.rename` `agent.wait` `events.wait` `layout.apply` `layout.export`
`layout.set_split_ratio` `pane.clear_agent_authority` `pane.focus_direction` `pane.input.set`
`pane.layout` `pane.move` `pane.neighbor` `pane.release_agent` `pane.report_agent_session`
`pane.report_metadata` `pane.resize` `pane.selection.read` `pane.swap` `pane.wait_for_output`
`pumi.fs.dirs` `pumi.state` `tab.move` `workspace.move_block` `workspace.report_metadata`

Nothing does (12): `integration.install` `integration.list` `integration.uninstall` `pane.edges`
`pane.scroll` `pumi.server.info` `server.reload_config` `worktree.create` `worktree.list`
`worktree.open` `worktree.remove` `workspace.move`

herdr's own (5): `agent.explain` `agent.view.clear` `agent.view.set` `pane.link.activate`
`pane.link.resolve`

This package's own (3): `agent.prompt` `agent.start` (the rows above), `events.subscribe` (answered
by `src/server.ts`).
