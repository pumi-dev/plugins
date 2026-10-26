# Porting a plugin to pumi's final API

The pumi checkout is `~/Kitchen/pumi`. Its truth, in order:
- `~/Kitchen/pumi/api/pumi-api.json`: every public function with its parameters and examples.
- `~/Kitchen/pumi/api/renames.json`: old name → new name, for functions and events. `removed`
  and `removed_events` list what is gone, and why.
- `~/Kitchen/pumi/runtime/app/types/index.ts`: what `import … from "pumi"` exports. Anything
  not there is gone.
- `~/Kitchen/pumi/docs/user/ui.md`, `plugins.md`: slots, blocks, renderers, traits.

## Manifest (`package.json` → `"pumi"`)

- `contributes.views` → `contributes.blocks` (same fields: id, title, icon, version, strategy,
  methods). A block `board` is drawn by the `ui.tsx` export `Board`, given `{ pane, block, focused }`.
- `contributes.points` → `contributes.slots`. The only slots: `panel`, `status`, `pane.strip`,
  `pane.overlay`, `pane.toolbar` (actions, view), `pane.menu`, `palette.actions` (actions only).
  Cut slots: `window.titlebar`, `window.overlay`, `session.header`, `tab.actions`, `tab.badge`,
  `agent.controls`, `agent.footer`, `agent.menu`. Move `agent.menu`/`agent.controls` actions to
  `pane.menu`; drop the others (say so in your report).
- `activation`: `onView:x` → `onBlock:x`.
- To draw another block (e.g. terminals): `contributes.renderers: { "terminal": "Terminal" }`,
  and the pane option `@pane_renderer` (was `@pane_face`) set to `owner/name` picks it for a pane.

## `main.ts` (worker SDK)

- `pkg` → `plugin` (`plugin.id`, `plugin.prefix`, `plugin.prefixed("x")`, `plugin.dir`,
  `plugin.manifest`); `plugin.list()` is the API's.
- Getters: `pane.current()` → `pane.get()` (answers `{ id, block, traits, place }`; use `.id`),
  `tab.current()` → `tab.get()`, `session.current()` → `session.get()`. `pane.getPlace(p)` →
  `(await pane.get(p)).place`. `tab.getLayout(t)` → `(await tab.get(t)).layout`.
- `pane.setZoom(p, on)` → `pane.resize(p, { zoom: on })` (`"toggle"` too).
  `tab.applyLayout(t, { name })` → `tab.setLayout(t, name)`.
- `pane.listClosed()` → `pane.list({ closed: true })`. `pane.listTypes()` → `block.list()`.
- `pane.list({ type })` / `{ kind }` → `pane.list({ block })`; `pane.list({ trait: "agent" })` exists.
- `pane.setState(p, state)` → `pane.open(block, { state }, { replace: p })`.
- `option.getInfo` / `option.getAll` / `option.list` → `option.info(name?, { values })`;
  `option.save(...)` → `option.set(name, value, { save: true })`.
- `fn.create`/`fn.register` → `fn.set`, `fn.unregister` → `fn.del`.
- `event.createGroup(name)` → just pass `{ group: name }` to `event.on`; `event.delGroup`/
  `event.clear` → `event.off({ group | event | match })`.
- `remote.*` → `server.list()` (entries have `via: "socket" | "ssh"`), `fs.listDirs(path, { server })`,
  `session.create({ server, cwd })`.
- `action.list/run` → `command.list/run`. `menu.get` → `menu.list`.
  `storage.keys()` → `Object.keys(await storage.get())`; `storage.del(k)` → `storage.set(k, null)`.
- `format.evalStatusline(f, o)` → `format.eval(f, { ...o, spans: true })`.
- `system.*`: `system.process.list/ports/signal` → `process.list/ports/signal` (import
  `process` from "pumi"; it shadows Node's global, so alias it: `import { process as procs }`
  if the file also uses Node's `process`). `system.process.info(pid)` /
  `.tree(pid)` → `process.list({ pid, tree })`. `system.open/reveal/trash` → `fs.open/reveal/trash`.
  `system.clipboard.*` → `clipboard.*`. `system.secret.get/set` → `secret.get/set`
  (`set(name, null)` deletes). `system.dialog.*` → `dialog.ask` / `dialog.file` (read their
  parameters in pumi-api.json). `system.notify.send` → `message.notify`. `system.platform()` →
  Node's `process.platform`. Anything else of `system.*` is gone: use Bun (`Bun.spawn`, …).
- Gone from the SDK: `key`, `client`, `channel`, `input`, `tailnet`, `highlight`, `action`,
  `remote`, `system`. Keys: a static key goes in the manifest (`contributes.keys:
  [{ "key": "cmd+k", "command": "open" }]`). One the plugin computes (from an option, a key table,
  a mode) stays on the wire: `call("key.set", table, keys, rhs, opts)` / `call("key.del", table, keys)`.
  It has no disposer, but the app undoes it when the plugin stops.
- Events, renamed: `pane.callReceived` / `pane.inputReceived` → `pane.called`
  (`{ pane, method, args }`; input is `method: "input"`). `terminal.opened` → `pane.opened`
  (data `{ pane, block }`). `pane.closed`'s data is `{ pane, block }` (was `type`).
  New: `pane.blockChanged` `{ pane, from, to }`.
- Events, gone (see `removed_events`): `pane.blurred`, `tab.blurred`, `terminal.osc`,
  `terminal.notified`, `link.clicked`, `chrome.clicked`, `gesture.performed`, `core.started`,
  `host.started`, `key.changed`, `script.changed`, `client.attached`, `client.detached`,
  `message.notified`, `notification.answered`, `option.declared`, `colors.changed`,
  `style.changed`. Remove the listener; say in your report what that loses.

## `ui.tsx` (window SDK)

- Ids are numbers on both sides: `num()` is gone. A pane is `{ id: 3, server?, block, traits,
  tab?, session?, place?, title?, cwd?, label?, options }`. That replaces `pane_id: "%3"`, `kind`,
  `tab_id`, `workspace_id` and `terminal_title`. A pane's agent status:
  `useAgent(pane.id)?.status` or `pane.options["@agent_status"]`.
- Tab: `{ id, session, index, name, status, worktree? }`. That replaces `tab_id`,
  `workspace_id`, `number`, `label` and `agent_status`.
- Session: `{ id, name, tab?, status, cwd? }`. That replaces `workspace_id`, `label`,
  `active_tab_id` and `agent_status`.
- Agent: `{ pane, server?, tab?, session?, agent, status, block, name?, title?, cwd?,
  agent_session?, model?, transcript?, conversation? }`. `status` was `agent_status`,
  `agent_session` was `session`, and `pane`/`tab`/`session` are numbers.
- `useAgentOf(x)` → `useAgent(x)`. `usePanes({ tab, block, trait })` is new.
- Gone: `useApp`, `useConnection`, `useFloats`, `useZoomed`, `useAgentStatus`, `useComponents`,
  `useAppearance`, `useThemeOption`, `renderView`, `useContributions`, `usePaneView`, `Boundary`,
  `PANE_FACE`, `usePaneFace`, `commands`, `useBinding`, `useLocal`, `run`, `setContextResolver`,
  `windowContext`, `Button`, `DismissableLayer`, `useIsPresent`, `usePresence`,
  `useWindowInsets`, `useWindowSize`. Rebuild what a plugin needs from what remains (e.g. a
  `<div>` with `onClick` for `Button`), or from `call(...)`.
- `call(name, ...args)` from the window: a pane, tab or session a hook gave goes to its server.
- A UI theme is `defineTheme({ name, colors, terminal, metrics, fonts })`: no `components`. A
  theme that replaced the window's parts cannot any more: keep its colours and metrics, drop the
  rest, and say so.

## Checking

In the package's directory: `node_modules/.bin/tsc --noEmit -p .` and `bun test --passWithNoTests`.
Do not run `bun tools/all.mjs` (it checks every package, and others are being ported at the
same time).
