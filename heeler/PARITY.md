# herdr parity

What this package answers today, against what herdr's own server does — and the code for each gap,
so the port is mechanical.

**PROVENANCE.** herdr `5608de0` (server 0.9.4, protocol 22, `herdr api schema --json`); Heeler
`f98028b` (app 0.6.x, `Sources/Heeler/Transport/{HeelerSSHTransport,SSHTransportSettings}.swift`, its
`plugin/` and shared vectors); this package is the `herdr` one renamed to `heeler`, now the Host
itself (its own sshd, pairing, Tailscale and QR — see README.md). The herdr column is the real code
path in
`src/app/agents.rs`, `src/app/api/{agents,panes,tabs,workspaces,worktrees}.rs`,
`src/app/api_helpers.rs`, `src/worktree.rs` and `src/detect/mod.rs`; the pumi column is
`pane.call`, `pane.open`, `option.set` and the core's events, as served by `crates/pumid` and
`crates/pumi-host`.

## Scoreboard

| | |
| --- | --- |
| methods declared in `src/methods.ts` | 112 — 88 `served`, 24 `unsupported` |
| actually answered (`dispatch` in `src/api.ts`, `events.subscribe` in `src/server.ts`) | 40 |
| `served` but ends at `not implemented by pumi yet` | 48 (see the appendix) |
| Heeler's calls | 24; 20 answered, 4 not: `agent.start`, `agent.prompt`, `agent.rename`, `worktree.create/list/remove` |
| live evidence | `pumi plugin logs heeler`: `herdr.sock: agent.start → unsupported agent.start is not implemented by pumi yet` |

`served` currently means "we intend to", not "we answer". Heeler's New Agent dies at step 2 of 4
(`tab.create` → `agent.start` → …) and rolls back the tab it created.

## The table

One row per thing to port. **herdr** is the code path; **yours** is the line in this package today;
**write** is the pumi equivalent.

| # | thing | herdr (Rust) | yours today (TS) | what to write (pumi) |
| --- | --- | --- | --- | --- |
| 1 | `agent.start` launch | `let argv = once(interactive_agent_executable(kind)).chain(params.args);`<br>`let line = interactive_shell_command(&argv, shell)?;`<br>`let bytes = encode_api_submission(runtime, &line);`<br>`terminal.begin_managed_agent(name, kind, now, SETTLE, timeout);`<br>`runtime.try_send_bytes(bytes)?;` | `served("agent.start")` in `methods.ts`, no `case` in `api.ts`, so it reaches `throw new Fail(codes.UNSUPPORTED, …)` | `const argv = [exe(kind), ...p.strings("args")];`<br>`await ask("pane.call", pane, "input", { paste: quote(argv) });`<br>`await delay(300);`<br>`await ask("pane.call", pane, "input", { keys: ["enter"] });`<br>`return result("agent_started", { agent, argv });` |
| 2 | kind → binary | `match agent { Agent::Cursor => "cursor-agent", Agent::Kiro => "kiro-cli", Agent::Antigravity => "agy", … }` | — | `const EXE = { cursor: "cursor-agent", kiro: "kiro-cli", agy: "agy" };`<br>`const exe = (kind) => EXE[kind] ?? kind;`<br>`if (!KINDS.includes(kind)) throw new Fail("unsupported_agent_kind", …);` |
| 3 | shell quoting | bare if `[A-Za-z0-9@%_+=:,./-]`, else `'…'` with `'\''` | `src/host.ts` single-quotes the shim's paths in the forced command; nothing else quotes | `const bare = /^[A-Za-z0-9@%_+=:,.\\/-]+$/;`<br>`const q = (w) => bare.test(w) ? w : "'" + w.replaceAll("'", "'\\''") + "'";`<br>`const quote = (argv) => argv.map(q).join(" ");` |
| 4 | name rules | `matches!(chars.next(), Some('a'..='z')) && name.len() <= 32 && chars.all(lower, digit, '-', '_')` | none: `@label` is whatever `pane.rename` wrote | `const NAME = /^[a-z][a-z0-9_-]{0,31}$/;`<br>`if (!NAME.test(name)) throw new Fail("invalid_agent_name", …);` |
| 5 | name uniqueness | `self.agent_name_conflicts(&name, "")` → `DuplicateName` → `agent_name_taken` | — | `const taken = v.tiled().filter((x) => v.agentInfo(x)?.name === name);`<br>`if (taken.length > 0) throw new Fail("agent_name_taken", …);` |
| 6 | launch bookkeeping | `begin_managed_agent(…)` sets the alias and `launch_pending`; detection clears it | — | `await ask("option.set", "@agent", kind, { pane });`<br>`await ask("option.set", "@label", name, { pane });`<br>`launches.set(pane, Date.now() + timeout);` |
| 7 | `agent.prompt` send | `let (text, enter) = encode_api_submission_parts(runtime, &params.text);`<br>`runtime.queue_user_input_submission(text, enter, AGENT_PROMPT_SUBMIT_DELAY, deadline)?;`<br>`-> AgentPrompted { agent }` | — | `await ask("pane.call", pane, "input", { paste: p.str("text") });`<br>`await delay(300);`<br>`await ask("pane.call", pane, "input", { keys: ["enter"] });`<br>`return result("agent_prompted", { agent });` |
| 8 | paste encoding | `if bracketed { format!("\x1b[200~{text}\x1b[201~") } else { text }` | `async function write(pane, text) { await ask("pane.call", pane, "input", { text }); }` | use `{ paste: text }` — pumi adds the markers itself, only when the program enabled them (`crates/pumid/src/term/mod.rs:533`) |
| 9 | prompt refusals | `terminal.state == Blocked` → `agent_blocked`; no agent → `agent_not_found`; `launch_pending` or not the foreground → `agent_not_ready`; empty → `empty_agent_prompt` | `view.status(pane)` reads `@agent_status` (`error` shows as `done`), but nothing checks it before sending | `if (p.str("text").trim() === "") throw new Fail("empty_agent_prompt", …);`<br>`if (v.status(pane) === "blocked") throw new Fail("agent_blocked", …);`<br>`if (v.agentInfo(pane) === undefined) throw new Fail("agent_not_found", …);` |
| 10 | agent target by name | `.filter(|c| terminals[c].agent_name.as_deref() == Some(target))`, then `agent_target_ambiguous` | `function paneOf(v, id) { const pane = v.pane(id); if (pane === undefined) throw new Fail(codes.PANE_NOT_FOUND, …); }` | `const hits = v.tiled().filter((x) => v.agentInfo(x)?.name === id);`<br>`if (hits.length === 1) return hits[0];`<br>`if (hits.length > 1) throw new Fail("agent_target_ambiguous", …);` |
| 11 | `agent.rename` | `self.rename_agent_target(&params.target, params.name)` → `ResponseResult::AgentInfo` | only `case "pane.rename": await ask("option.set", "@label", label, { pane });` | `const name = p.optStr("name") ?? null;`<br>`if (name !== null && !NAME.test(name)) throw new Fail("invalid_agent_name", …);`<br>`await ask("option.set", "@label", name, { pane });`<br>`return result("agent_info", { agent: v.agentInfo(pane) });` |
| 12 | `worktree.list` | `list_existing_worktrees` → `parse_worktree_list_porcelain` → `worktree_list {source, worktrees}` | — (app-side only: `runtime/app/app/worktrees.ts:37 parse()`) | `const out = await git(repo, ["worktree", "list", "--porcelain"]);`<br>`return result("worktree_list", { source, worktrees: parse(out).map(info) });` |
| 13 | `worktree.create` | `build_worktree_add_new_branch_command` → `run_worktree_add_command` → `create_workspace_with_options(path, focus)` | — | `await git(repo, ["worktree", "add", "-b", name, path]);`<br>`const pane = opened(await ask("pane.open", "terminal", { cwd: path }, { kind: "session", focus }));`<br>`return result("worktree_created", { workspace, tab, root_pane, worktree });` |
| 14 | `worktree.remove` | `build_worktree_remove_command` + `run_worktree_remove_command_with_recovery` + `close_removed_linked_worktree_workspace` | — | `await ask("session.close", workspace);`<br>`await git(repo, ["worktree", "remove", ...(force ? ["--force"] : []), path]);`<br>`return result("worktree_removed", { workspace_id, path, forced: force });` |
| 15 | read sources | `read_terminal_snapshot(pane, source, format, lines)` → `PaneReadResult {source, format, text, revision, truncated}` | `const source = enumParam(p, "source", READ_SOURCES) ?? "recent";`<br>`let text = await read(pane, lines);` — `source` is validated and then unused | `const text = source === "visible" ? await gridSnapshot(pane) : await ask("pane.call", pane, "read", { lines });`<br>// `gridSnapshot` is the postcard grid this package already speaks in `src/grid.ts` |
| 16 | `@agent` events | `EventKind::PaneAgentDetected` when detection succeeds, `PaneUpdated` on a change | `if (name === "@agent_status") return [envelope("pane.agent_status_changed", …)];` and `@label`/`title`/`pane_current_path` → `pane_updated`, but `@agent` is not listed | `if (name === "@agent") return [envelope("pane_agent_detected", { pane: info }), envelope("pane_updated", { pane: info })];` |
| 17 | `AgentInfo` shape | `launch_pending: terminal.managed_agent_launch_pending(), interactive_ready: terminal.managed_agent_interactive_ready()` | `interactive_ready: true,` — `launch_pending` absent (both are required by the schema) | `interactive_ready: !launches.has(pane),`<br>`launch_pending: launches.has(pane),` |
| 18 | create defaults | schema: `"focus": { "default": false }` | `const place = { kind: "tab", focus: p.bool("focus", true) };` (and `kind: "session"` likewise) | `const place = { kind: "tab", focus: p.bool("focus", false) };` |
| 19 | method table honesty | — | `served("agent.start")` … 48 such names end at `throw new Fail(codes.UNSUPPORTED, …)` | demote unimplemented ones to `unsupported(name, "…")`, and add `test("every served method has a handler", …)` to `test/methods.test.ts` |

## The Host this package is now

The herdr-API half above is unchanged. What changed when `herdr` became `heeler` is the Host:

- **SSH** is the machine's own OpenSSH on port 22 as the account running pumi (`src/host.ts`,
  `src/cli.ts`) — the plugin starts no server, needs no root and adds no host key. The Pairing Code
  pins the machine's `/etc/ssh` fingerprint and Enrollment edits the account's
  `~/.ssh/authorized_keys`; a `herdr` shim (under the plugin's state, and at `~/.local/bin` only when
  no real herdr is there) runs the plugin's CLI with pumi's embedded Bun, so no herdr install is
  needed. This is what any herdr Host is, so a phone pairs exactly as it would with herdr.
- **Pairing** (`src/pair.ts`, `src/pairing/*`) is Heeler's v1 QR envelope, Bootstrap Key, forced-command
  Enrollment and one-key revoke, in pumi, exposed as `heeler.pair.*` functions for Settings.
- **No tailnet** — the plugin has none: the machine reaches the phone over the LAN or over whatever
  VPN (Tailscale, otherwise) the machine runs beside it, and the `pumi.tailnet.*` methods answer
  `unsupported`.
- **Notifications** are the same hooks; the Registration path is still
  `~/.config/herdr/plugins/config/heeler/`, which this plugin's CLI and a real herdr's both print.

## What else the answers differ on

Beyond the four gaps, the methods Heeler already uses diverge here:

| method | herdr | yours | effect |
| --- | --- | --- | --- |
| `pane.read`, `agent.read` | `source` required (`visible`, `recent`, `recent_unwrapped`, `detection`); real `truncated` | source ignored, always history; `truncated: false` always | Heeler's Chat reads `source: visible`, `format: ansi` around a send and silently gets scrollback |
| `pane.read` `revision` | the terminal's content revision | this package's own counter, bumped on any pane event (`src/state.ts`) | Heeler reads it as "something changed" |
| `pane.process_info` | `shell_pid`, `tty`, `foreground_process_group_id`, `foreground_processes[]` | `shell_pid`, `tty` | pumi has `pane_foreground_pgid` and a process tree |
| `workspace.create` | `source_workspace_id` (the `follow` cwd policy); no `command` | ignored; `command` accepted | a herdr client gets a tab that is not a shell |
| `session.snapshot` | `layouts: PaneLayoutSnapshot[]` per tab | `layouts: []` | required field, always empty |
| `agent.list` | every pane holding an agent | `tiled()` only, floats excluded | |
| `ping` | `capabilities` with `endpoint_protocol_generation` | no `endpoint_protocol_generation`; `live_handoff: true` while pumi restarts via `pumi.server.restart` | first thing a client reads |
| `pane.close`, `tab.close` | closes the tab, then the workspace, when it was the last pane | pumi prunes the tab, then an empty session (`crates/pumid/src/kernel/mod.rs:373`) | **matches**, nothing to do |

## Events

Heeler subscribes to 16 global lifecycle kinds: the 15 in `snapshotChangeKinds` —
`pane_agent_detected`, `pane_created`, `pane_closed`, `pane_exited`,
`workspace_created/renamed/metadata_updated/closed/moved/reordered`,
`tab_created/closed/renamed/moved`, `pane_moved` — plus `pane_updated`; it also subscribes to
`pane.agent_status_changed` per pane, and resyncs its whole console on any of the 15. See
`Console/HostConsoleProjection.swift`.

This package translates (`translate()` in `src/api.ts`): `workspace_created/closed/renamed/focused`,
`tab_created/closed/focused/renamed`, `pane_created/closed/focused`, `pane_updated` (only for
`title`/`@label`/`pane_current_path`), `pane_exited`, `layout_updated`,
`pane.agent_status_changed`.

Missing, and pumi emits the source:

- `option.changed @agent` → nothing. A pane *becoming* an agent — a hook's `agent.turn`, a
  `pane.report_agent`, a launch — is invisible to Heeler until some other event forces a resync.
  Should be `pane_agent_detected` and `pane_updated`.
- `pane.moved` → no `pane_moved`; `tab.moved` → no `tab_moved`. Both are in Heeler's resync set.
- `session.*` has no `workspace_updated`, `workspace_metadata_updated`, `workspace_moved`,
  `workspace_reordered`.

## Where the two designs diverge by nature

| | herdr | pumi |
| --- | --- | --- |
| what an agent is | a terminal whose foreground process matches a manifest, plus a managed name | a pane with `@agent`, told by the agent's own hook (OSC 7501, `agent.turn`) |
| state | regexes over a kept screen (`detect/manifests/*.toml`: priorities, regions, negatives) | `@agent_status` from what the program reports; `blocked` from `agent.request` |
| readiness | `launch_pending` → detected → `interactive_ready` | nothing; the hook's first report is the signal |
| "send a prompt" | paste + Enter into the TUI | hidden context at send (`agent.turn`), or a message in the queue (`agent.queue`) |
| worktrees | a workspace per worktree, with group membership bookkeeping | a tab option (`worktree`) inside a session, app-side git |
| screens | kept, read (`visible`), scanned | kept only in the grid (the attach socket); `pane.call read` is history |

The two binary wire formats are the part already ported faithfully: `src/wire.ts` (bincode, herdr's
client socket) and `src/grid.ts` (postcard, pumi's grid), with vectors from the Rust they came from.

## What not to port

- The manifest/regex detection engine: pumi has no screen to scan, and an agent that reports itself
  needs none.
- Worktree *group* close confirmation (`confirmation_required`, `workspace_group_close_required`):
  only meaningful with herdr's workspace-per-worktree membership; add it if worktrees land.
- `pane.copy_motion`, `pane.copy_search`, `pane.edit_scrollback`, `command.invoke`, `popup.close`:
  they belong to herdr's TUI, and this package already answers `unsupported` with a reason.

## Work order

1. `agent.start` — rows 1–6, with herdr's nine error codes and a `pane_current_command` shell check.
2. `agent.prompt` — rows 7–9; `unsupported` for plugin-hosted panes (`pane.call` is inert there;
   their route is `conversation.send`).
3. `agent.rename`, name rules and name targets — rows 4, 5, 10, 11.
4. `worktree.list/create/open/remove` — rows 12–14 (`open` is `create`'s last two lines when the path
already exists), session-per-worktree, `Bun.spawn git`, porting
`runtime/app/app/worktrees.ts` (`parse`, `nameOf`, `placeFor`, `newName`) and the `worktree_dir`
option.
5. Events — row 16 plus `pane_moved`, `tab_moved`, `workspace_updated`; then the read sources (row 15).
6. `AgentInfo` completeness (row 17), create defaults (row 18), the honesty pass (row 19).

## Appendix: the 48 `served` methods with no handler

```
agent.explain              agent.prompt               agent.rename
agent.start                agent.view.clear           agent.view.set
agent.wait                 events.wait                integration.install
integration.list           integration.uninstall      layout.apply
layout.export              layout.set_split_ratio     pane.clear_agent_authority
pane.edges                 pane.focus_direction       pane.input.set
pane.layout                pane.link.activate         pane.link.resolve
pane.move                  pane.neighbor              pane.release_agent
pane.report_agent_session  pane.report_metadata       pane.scroll
pane.selection.read        pane.swap                  pane.wait_for_output
pumi.fs.dirs               pumi.server.info           pumi.state
server.reload_config       tab.move                   workspace.move
workspace.move_block       workspace.report_metadata  worktree.create
worktree.list              worktree.open              worktree.remove
```
