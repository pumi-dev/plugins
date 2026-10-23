# tmux/ui: what the Rust names, and where each name goes

An inventory for porting `tmux/ui/src` (11.7k lines of Rust, the plugin's kernel, command table
and builtins) onto the final API. It is a port, not a rename: the crate cannot be built against
`~/Kitchen/pumi` any more, and many of the functions it calls have no successor.

## State of the crate

- `pumi-plugin` (the wasm SDK: `plugin!`, `prelude`, `gpui::App`, `api::call`, `system`) was
  deleted in `~/Kitchen/pumi` commit `bbe5427 plugin: delete the pumi-plugin sdk`. `ui/Cargo.toml`
  takes it from `../pumi/crates/pumi-plugin`, so `cargo check -p tmux` fails while loading the
  manifest, and the crate can be neither compiled, tested nor loaded. `docs/plan/migration.md`
  §4 is the shape of the port: a package writes `src/main.ts` (+ modules), `src/ui.tsx` and
  `package.json`, and `ui/` and its Cargo.toml go.
- The export has no `pumi_` name (`api/pumi-api.json`; the wire's names are in
  `crates/pumid/src/api` and `crates/pumi-host/src/api`). Every one of the 61 old names below is
  called from `ui/src` — 169 call sites.
- Already ported: `src/lang/{parse,args,text}.ts` (the command line: `Command`, `Arg`, quoting,
  `%if`, `$VAR`) and `test/{parse,lang}.test.ts`. Everything else in `src/` is missing, and
  `package.json` still says `main: src/main.ts`.
- `package.json` has no `views`, `points` or `onView:` to rename, and its
  `contributes.options.default_keys` and `activation: ["onStartup"]` are already the final
  shape (`crates/pumi-api/src/manifest.rs`; the copy of `api/plugin-manifest.schema.json` in the
  pumi checkout still lists `points`/`views` and is stale). What it lacks is the code `main`
  names.
- What the port may lean on, because the app now does it: `format.eval` (the format engine,
  `crates/pumi-host/src/api/options.rs`) replaces `kernel/format.rs` (533 lines); options are
  declared in the manifest (`contributes.options`) instead of `kernel/options.rs`'s `Decl`s
  (1080 lines); autocmds, groups and dispatch are the host's (`event.on`/`off`/`emit`/`list`)
  instead of `kernel/events.rs`'s registry (404 lines); the model is read on demand
  (`pane.get`, `tab.get`, `session.get`, `option.get`) instead of a mirror (`kernel/mod.rs`).

## Functions: old name → final API (sites in `ui/src`)

`†` = no successor. Wire-only names (not in the public export) are marked `(wire)`.

| old | # | final API |
| --- | --- | --- |
| `pumi_set_option_value` | 12 | `option.set(name, value, {pane\|tab\|session\|client, scope, save})` |
| `pumi_pane_call` | 9 | `pane.call(pane, method, args)` |
| `pumi_set_current_tab` | 8 | `tab.select({tab})` (also `{offset}`, `{last}`, `{index}`) |
| `pumi_set_keymap` | 7 | `key.set(table, keys, rhs, opts)` (wire) — the prefix table is computed, so it stays on the wire |
| `pumi_open_pane` | 6 | `pane.open(block, args, place)` |
| `pumi_get_buffer` | 5 | `storage.get(plugin, key)` |
| `pumi_set_buffer` | 5 | `storage.set(plugin, key, value)` |
| `pumi_get_commands` | 5 | `command.list()` |
| `pumi_set_current_session` | 5 | `session.select({session})` |
| `pumi_set_current_pane` | 5 | `pane.select({pane})` |
| `pumi_tab_set_place` | 5 | `tab.setPlace(tab, {session, index, kill, swap})` — no `link`/`unlink` |
| `pumi_tab_set_place` (`link`/`unlink`) | 2 | † links are gone: `link-tab`/`unlink-tab` and their table and specs entries go |
| `pumi_pane_set_place` | 4 | `pane.setPlace(pane, place)` |
| `pumi_pane_set_zoom` | 4 | `pane.resize(pane, {zoom: bool\|"toggle"})` |
| `pumi_get_autocmds` | 4 | `event.list(filter)` (wire) |
| `pumi_get_api_info` | 4 | `api.getInfo()` |
| `pumi_del_buffer` | 4 | `storage.set(plugin, key, null)` |
| `pumi_cmd` | 4 | the package's own command line: `provide("cmd.run", spec, fn)`; hooks run it through the host |
| `pumi_get_environment` | 3 | † `Bun.env` |
| `pumi_set_environment` | 3 | † `Bun.env` |
| `pumi_pane_get_state` | 3 | `pane.getState(pane, opts)` |
| `pumi_pane_close` | 3 | `pane.close(pane)` |
| `pumi_list_buffers` | 3 | `storage.get(plugin)` (the whole store) |
| `pumi_get_keymap` | 3 | `key.list(table)` (wire) |
| `pumi_del_keymap` | 3 | `key.del(table, keys)` (wire) |
| `pumi_exec_autocmds` | 3 | `event.emit(event, opts)` |
| `pumi_create_autocmd` | 3 | `event.on(event, {group, pattern, chan\|callback\|command, once})` |
| `pumi_create_user_command` | 3 | † commands are the manifest's `contributes.commands` |
| `pumi_del_user_command` | 3 | † same |
| `pumi_tab_close` | 2 | `tab.close(tab)` |
| `pumi_tab_set_name` | 2 | `tab.rename(tab, name)` |
| `pumi_create_augroup` | 2 | `event.on(ev, {group: name})` — a named group is made by naming it |
| `pumi_clear_autocmds` | 2 | `event.off({group\|event\|match})` |
| `pumi_core_set_option_value` | 2 | `option.set(...)` (`option.set` is already the host's) |
| `pumi_parse_cmd` | 2 | † the parser is `src/lang/parse.ts` |
| `pumi_exec2` | 2 | † the line is split and run by the package itself |
| `pumi_attach` | 1 | `client.attach(...)` (wire) |
| `pumi_detach`, `pumi_ui_detach` | 2 | `client.detach(...)` (wire) |
| `pumi_ui_try_resize` | 1 | `client.resize(...)` (wire) |
| `pumi_call_atomic` | 1 | `call.atomic([calls])` (wire) |
| `pumi_chan_notify` | 1 | `channel.notify(chan, ref, args)` (wire) |
| `pumi_event` | 1 | gone as a message: `channel.notify` / `rpc.event` |
| `pumi_create_session` | 1 | `session.create({name, cwd, pane: {block, args}})` |
| `pumi_session_close` | 1 | `session.close(session)` |
| `pumi_session_set_name` | 1 | `session.rename(session, name)` |
| `pumi_tab_set_layout` | 1 | `tab.setLayout(tab, preset \| {offset} \| tree)`; `tab.get(t).layout` for `display-message -p "#{window_layout}"` |
| `pumi_get_option_value` | 1 | `option.get(name, {pane\|tab\|session\|client, scope})` |
| `pumi_get_all_options_info` | 1 | `option.info(null, {values: true, ...scope})` |
| `pumi_create_option` | 1 | `option.declare` (wire) is the core's only; the package's own go in the manifest |
| `pumi_get_state` | 1 | `server.getState()` (wire) |
| `pumi_kill_server` | 1 | `server.kill()` (wire) |
| `pumi_list_chans` | 1 | `channel.list()` (wire) |
| `pumi_list_pane_types` | 1 | `block.list()` |
| `pumi_pane_set_state` | 1 | `pane.open(block, {state}, {replace: pane})` |
| `pumi_notify` | 1 | `message.notify(msg, level, opts)` |
| `pumi_menu_add` | 1 | `menu.add(path, rhs, opts)` |
| `pumi_eval_format` | 1 | `format.eval(fmt, {spans: true, pane, tab, session, time, hl})` — the host's engine: `kernel/format.rs` goes |
| `pumi_create_namespace` | 1 | † `style.set` and highlight namespaces are gone |
| `pumi_set_style` | 1 | † same; the bars are drawn by a `src/ui.tsx` view |
| `pumi_get_style` | 1 | † same |
| `pumi_list_messages` | 1 | † the message list is the app's (`message.notify`/`withdraw` only) |

## Events

Old kernel/event names (`kernel/events.rs`) → `api/pumi-api.json`'s events. Everything not
listed is gone with no successor, so the hook vocabulary that fires it goes too.

| old | final |
| --- | --- |
| `OptionSet` | `option.changed` |
| `OptionDeclared` | † (`option.info` once; `option.declared` was removed) |
| `PumiEnter`, `PumiLeave`, `UIEnter`, `UILeave` | † (`core.started`, `client.attached` removed) |
| `SessionNew`/`Closed`/`Renamed` | `session.created`/`closed`/`renamed` |
| `SessionEnter`, `SessionLeave` | `session.focused`; leave has none |
| `TabNew`/`Closed`/`Enter`/`Leave`/`Renamed`/`Moved` | `tab.opened`/`closed`/`focused`/†/`renamed`/`moved` |
| `PaneOpenPre`, `PaneNew` | `pane.opened` (`{pane, block}`); there is no `Pre`: nothing can rewrite or cancel |
| `PaneClosePre`, `PaneClosed` | `pane.closed`; no `Pre` |
| `PaneEnter`, `PaneLeave` | `pane.focused`; leave has none |
| `PaneResized`, `PaneMoved` | `pane.resized`, `pane.moved` |
| `PaneSavePre`, `PaneRestorePost` | †, `pane.restored` |
| `LayoutChanged` | `layout.changed` |
| `TermOpen`, `TermClose` | `pane.opened`, `terminal.closed` |
| `TermBell`, `TermNotify`, `TermOsc` | † (`terminal.notified`, `terminal.osc` removed) |
| `DirChanged` | `cwd.changed` |
| `CommandPost` | † |
| `ColorScheme` | `theme.changed` |
| `MenuChanged`, `MenuPopup` | `menu.changed`; popup has none |
| `FocusGained`, `FocusLost` | `app.focused`, `app.blurred` |
| `StyleSet` | † |
| `PackChangedPre`, `PackChanged` | `plugin.changed` (`kind`); no `Pre` |
| `Gesture`, `User` | † |
| `SessionWritePost`, `SessionLoadPost` | † |

## Shapes

- A pane's `type` is `block`: `{"type": ty, "args": args}` → `{"block": ty, "args": args}`
  (`session.create`'s pane, `cmd/builtin/session.rs:48`); `{"id", "type", "place", "options"}`
  (`kernel/mod.rs:892`) → `pane.get`'s `{id, block, traits, place}` plus
  `option.info(null, {pane, values: true})`.
- Places: `PlaceKind` is `tiled | tab | session | float`
  (`crates/pumi-layout/src/place.rs:104`); `slot` and `detached` are gone, as are `order`,
  `client` and `owner` as place fields. The crate writes `float` (row, col, width, height,
  zindex) and `tab` (session, index, name, focus) places only — both still valid — but
  `tab.rs:288`'s `{"link": link, "kill": …}` and `tab.rs:312`'s `{"unlink": …}` have no field
  any more. What `place` does not carry (the tab of a tiled pane, a pane's type) is read from
  `pane.get`.
- `pane.getPlace(p)` → `(await pane.get(p)).place`; `tab.getLayout(t)` → `(await tab.get(t)).layout`.
- `pane.list({type})` → `pane.list({block})`; `pane.listClosed()` → `pane.list({closed: true})`.

## What the port drops, and what replaces it

| feature | why | replacement |
| --- | --- | --- |
| `link-tab`/`unlink-tab` (`cmd/builtin/tab.rs:250-320`), `window-linked`/`window-unlinked` hook names (`hook.rs:99,105,151-152`), their `cmd/table.rs:279-297` entries and `api/specs.json` | a tab is in one session; `tab.setPlace` has no link | `move-tab` and `swap-tab` stay; say so in README |
| user commands (`create_user_command`, `del_user_command`, `get_commands`'s own entries) | commands come from the manifest | a manifest `contributes.commands` list; `command.list` is the host's |
| paste buffers (`*_buffer`, 5 call sites each) | no buffer namespace | the package's own `storage` (`storage.get`/`set(plugin, key, null)`) |
| the environment (`*_environment`) | no environment functions | `Bun.env`; tmux's `set-environment` is per-package, so it starts its own map |
| `style.set`/`get_style`/`create_namespace` | no style API | a `src/ui.tsx` view with style objects |
| `attach`/`detach`/`ui.try_resize`, `list_chans`, `kill_server`, `get_state`, `call.atomic` | the package is not a server | where they are kept: the wire names, `call(...)` |
| `A*/Pre` events (open, close, save, pack) | the export has no `Pre` | hooks fire after the fact |
| `api/specs.json` (35 KB, 12 functions) | only `cmd.run` is called by name (`pumi-cli/src/lib.rs:285`, `pumi-host/src/callback.rs:88`) | one `FunctionSpec` passed to `provide("cmd.run", …)` |

## Suggested split (5 workers, by command group)

Line counts are the Rust each one replaces; the share of `kernel/` each needs goes with it.

| # | what | Rust | files |
| --- | --- | --- | --- |
| 1 | the spine: `package.json`, `README.md`, `src/main.ts`, `src/model.ts` (the pane/tab/session reader over `pane.get`/`tab.get`/`session.get`/`pane.list`/`tab.list`/`session.list`), `provide("cmd.run")`, `exec`/`exec2`/`parse`, buffers over `storage`, the environment, `command.list` | 741 + 374 + 922 (mirror) + 210 = ~2.2k | `api/{mod,commands}.rs`, `server.rs`, `kernel/{mod,core,state}.rs`, `defaults.rs`, `lib.rs` |
| 2 | the command table and dispatch: `src/cmd/table.ts`, `src/cmd/queue.ts` (`;`, `{}`, `%if`, `run-shell`, `if-shell`, `wait-for`, `source-file`) | 2355 | `cmd/mod.rs`, `cmd/table.rs` |
| 3 | panes and tabs: `split-pane`, `select-pane`, `resize-pane -Z`, floats (`break-pane`, `join-pane`), `move-pane`, `new-tab`, `select-tab`, `move-tab`, `swap-tab`, layouts, `respawn-pane`, `capture-pane`, `pipe-pane` | 1517 | `cmd/builtin/{pane,tab}.rs` |
| 4 | hooks, keys, scripts and style: `set-hook`, `bind-key`/`unbind-key`, `run-shell`'s jobs, `display-message`, the command line's style commands | 1168 | `cmd/builtin/{hook,key,script,style}.rs` |
| 5 | options, sessions, user commands, pumi's own functions: `set-option`, `show-options`, `new-session`, `kill-session`, `rename-session`, `list-*`, `pumi ...` | 2234 | `cmd/builtin/{option,session,user,pumi,server,buffer}.rs` |

`kernel/format.rs` (533) and `kernel/options.rs` (1080) are mostly deleted rather than ported
(`format.eval` and the manifest), but whoever takes group 1 owns both.
