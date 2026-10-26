# Porting a package to pumi's API level 1

A package's two halves both `import … from "pumi"`: `src/main.ts` runs in a worker and gets the
models and the calls; `src/ui.tsx` draws in the window and gets the hooks. This is what changed for
a package written against the API before it, and the spelling to move to. Every package in this
repository is already here; this file is for one that is not.

Truth, in order:

- `../pumi/api/pumi-api.next.json` — the export: every function with its parameters and examples,
  every event, the models (fields, watch keys, methods), `pane.call`'s methods, the traits and the
  error kinds. The CLI and the SDK's types are generated from it.
- `../pumi/api/renames.json` — old name → new name, and `removed` / `removed_events`: what is gone.
- `../pumi/runtime/app/worker/sdk/index.ts`, `../pumi/runtime/app/sdk/index.ts` — exactly what
  `import … from "pumi"` exports in each half. Anything not there is gone.
- `../pumi/docs/plans/api.md` (the design), `../pumi/docs/user/cli.md` (the same functions as
  commands), `../pumi/docs/user/plugins.md` and `ui.md` (the manifest and the window).

## Ids are prefixed strings

`%3` a pane, `@2` a tab, `$1` a session, `+7` a request, `devbox/%3` one on another server. On
every surface: the wire, the SDK, the CLI, `$PUMI_PANE`/`$PUMI_TAB`/`$PUMI_SESSION`. The server
routes a call by the prefix, so `Ref`, `wireId`, `refFromWire`, `call.on(server)` and the numeric
ids the window used are all gone: a pane's id is a string, everywhere.

```ts
const pane = workspace.getPane("%3")          // not 3, not { id: 3 }
await pane?.update({ title: "tests" })
```

## The manifest (`package.json`'s `pumi`)

Read without running anything: `name`, `owner` (its id is `owner/name`, its prefix `owner.name.`),
`api`, `uses`, `themes`, `icon`, `images`, `contributes`, `activation`. The schema is
`../pumi/api/plugin-manifest.schema.json`.

- `contributes.options` — by key; `side_by_side` is `owner.name.side_by_side`. An option a package
  keeps is always declared here (`storage` is gone: an option in the `plugin` scope is what it was).
  An option of `type: "secret"` is kept in the keychain by the server.
- `contributes.commands` — `{id, title}`, palette metadata for a function name. Commands are
  functions now: there is no `command.run`.
- `contributes.keys` — default keys, each naming a command (a function name).
- `contributes.slots` — `view` (a `ui.tsx` export) and/or `actions` (`{id, title, icon, command}`),
  keyed by the window's slots: `window.titlebar`, `window.overlay`, `session.header`,
  `session.menu`, `tab.actions`, `tab.badge`, `tab.menu`, `pane.toolbar`, `pane.strip`,
  `pane.overlay`, `pane.menu`, `agent.controls`, `agent.footer`, `agent.menu`, `panel`, `status`,
  `palette.actions`.
- `contributes.blocks` — `{id, title, icon, version, strategy, methods}`: `board` is
  `owner.name.board`, drawn by the `ui.tsx` export `Board` with `{pane, block, focused}`. Its
  `methods` are what `pane.call` reaches on its panes.
- `contributes.renderers` — a block it draws but did not define (`{"terminal": "Chat"}`, or
  `{"file": {"export": "Editor", "match": ["*.md"]}}`), picked for a pane by its `@pane_renderer`.
- `contributes.traits` — `owner.name.<id>`, a field set a pane has while its option
  `@owner.name.<id>` is set.
- `activation` — `onStartup`, `onBlock:<id>`, `onCommand:<id>`, `onEvent:<name>`; none means it
  starts on first use of what it contributes.

## `main.ts`: the models

`workspace` is the root, as Airtable's `base`: the caller's own objects, and the calls that make
more. Getters read the live cache and are sync; every method is one wire function and async.

```ts
import { workspace } from "pumi"

await workspace.ready                                    // the cache holds the caller's objects
const tab = workspace.currentTab                         // sync: Session, Tab, Pane, Request, Plugin
const tests = await workspace.openPane("terminal", {command: ["make", "test"]}, {split: "right"})
await tests.update({title: "tests"})                     // pane.update("%7", {title})
await tests.run({command: "make deploy"})
const {exitCode} = await tests.wait({exit: true})
tests.watch(["title"], () => …)                          // event.on("pane.changed", {match}) on keys
await workspace.openRequest({kind: "notification", title: "built"})   // a request, then .close()
for (const agent of await workspace.panes({trait: "agent"})) …        // agent.list is pane.list
```

| | |
| --- | --- |
| `workspace.currentSession/currentTab/currentPane` | the caller's own, or `null` |
| `workspace.sessions`, `getSession(id)`, `getTab(id)`, `getPane(id)`, `getPlugin(id)` | sync reads |
| `workspace.panes(filter)`, `requests(filter)` | async lists (`{session, tab, block, trait}` / `{pane, kind}`) |
| `workspace.openPane(block, args, place)`, `openRequest(request, opts)` | one call each |

A model's fields are getters (`pane.title`, `pane.cwd`, `pane.place`, `pane.block`, `pane.traits`,
`pane.options`, `pane.isFocused`); its methods are the functions whose first argument is it
(`session.update/focus/close`, `tab.update/focus/close`, `pane.update/focus/close/read/input/run/
wait/selection/report/attach`, `request.close`, `plugin.update/remove`). `pane.watch(keys, fn)` is
`event.on("<noun>.changed", {match: id})` limited to those keys.

`call(name, ...args)` is for what has no model — another package's function, `registry.list`,
`event.wait`.

## `main.ts`: the rest of the SDK

- `fn.set(name, spec, impl)` — a function of its own: `owner.name.<name>` (`queue.add`), reachable
  from any caller, from a manifest command of that name, and from `pumi call`. `null` withdraws it.
  Three arguments: the spec (`desc`, `effect`, `parameters`, `examples`, `returns`, …) and **the
  function that runs it**. Returns its disposer. This replaces `provide`, `command`, `fn.create`,
  `fn.register`, `action.*`.
- `option.get(name)` / `option.set(name, value)` — the package's own option by its key, in the
  `plugin` scope; `{scope, id}` for a session's, tab's or pane's; `{ttl, source, seq}` for a report;
  `null` removes. This replaces `storage.*`, `secret.*`, `option.info`'s values, `key.*` (bindings
  are the `keymap_bindings` option) and herdr's metadata tokens.
- `request.open(request, opts)` — a notification, a question or a permission, answering the
  `+7` request; `request.close(id, {answer})`. This replaces `notify`, `message.notify`/`withdraw`,
  `dialog.ask`, `dialog.file` (`fs.pick`) and `agent.request`/`agent.answer`.
- `registry.list(kind, opts)` — `fn`, `block`, `trait`, `option`, `key`, `menu`, `plugin`, `theme`,
  `viewer`, one by `{name}`; `{palette: true}` is the commands the palette shows; `{available: true}`
  is the store; `{path}` a file's viewers. This replaces `api.getInfo`, `block.list`, `trait.list`,
  `command.list`, `menu.list`, `plugin.list`, `plugin.search`, `option.info`, `file.viewers`,
  `key.list`, `event.list`.
- `plugin.add/remove/update`, `menu.set(path, item)`, `fn.set(name, null)`.
- `fs.list/open/pick/trash`, `clipboard.get/set`, `process.list` (each process's `cpu` percent and
  `rss` bytes beside pid, parent, command, cwd).
- `on(event, opts, fn)` / `on(event, fn)` — a dispatcher, and `emit(name, data)` — its own event.
  `event.on/off/wait/emit` are the API's. `core.subscribe`/`core.changes` are gone: what a plugin
  caches is filled from `<noun>.get`/`list` and kept current by the public events.
- `agent.onSend(handler)` / `agent.onTurn(handler)` — the transport's hooks
  (`agent.sending`/`agent.turned`); `agent.take(pane, {wait})`, `agent.queue(pane, text)`,
  `agent.turn(pane, turn)`, `agent.unqueue(id)`, `agent.contribute(id, text)`.
- `self` — `self.plugin` (`id`, `prefix`, `prefixed("x")`, `dir`, `manifest`), `self.session`,
  `self.pane` (the caller's), `self.args` (from `pumi do`). This replaces `pkg`/`plugin.prefix`.
- `layout.split(ratio, a, b)`, `layout.block(block, args)`, `layout.set(tree, tab)` — the tab's
  layout, composed of `pane.open` and `tab.update`.
- `paths` (`config`, `state`, `cache`), `ui.post(topic, data)` (to its own `ui.tsx`), `stop(code)`
  (a `pumi do` script's exit).
- `ApiError` — `err.kind` is one of the export's error kinds (`not_found`, `invalid_params`, …).
- Timers, sleep and processes are Bun's: `setTimeout`, `Bun.sleep`, `Bun.spawn`.

## `ui.tsx`: the window SDK

```tsx
import { usePane, usePanes, useWatchable, useOption, useTheme, useMetrics, Icon } from "pumi"

const pane = usePane("%3")                  // re-renders on any change to it
useWatchable(pane, ["title", "cwd"])        // or only on these keys
const agents = usePanes({session: "$1", trait: "agent"}).map((p) => p.traits.agent)
const [width, setWidth] = useOption("owner.name.width", {scope: "plugin"})
```

- `useSessions()`, `useSession(id)`, `useTabs(session)`, `useTab(id)`, `usePane(id)`,
  `usePanes(filter)`, `useRequests(filter)`, `useRegistry(kind, opts)`, `useWatchable`,
  `useWindow()`. There is no `useAgents`/`useAgent`/`useFocusedPane`/`useLayout`: an agent is a pane
  with the `agent` trait (`pane.traits.agent`, or `pane.options["@agent"]`), the focused pane is
  `tab.activePane`, the layout is `tab.layout`.
- `useTheme()` (`t.surface`, `t.text`, `t.muted`, `t.border`, `t.hover`, `t.selected`, `t.accent`,
  `t["agent.working"]`), `useMetrics()` (`radius`, `radiusSmall`, `fontSize`), `useFont()`,
  `useAppearance()`, `usePalette()`.
- `call(name, ...args)` from the window, `Icon`/`IconButton`, `WebView`/`useWebview` (a page),
  `<terminal pane id>`, `useChannel`/`useChannelListener` (the plugin's own `ui.post` stream),
  `useEvent`/`useWindow`'s events, `useDraggable`/`useDroppable`/`useHover`/`useInterval`/`useNow`,
  `motion`, `Select`, `createPortal`.
- A UI theme is `defineTheme({name, colors, terminal, metrics, fonts})` in `theme.tsx` (the app
  reads `themes/<name>/`), drawn from `pumi`: a theme may draw the window's own parts with the
  theme kit (`useApp`, `useSlot`, `renderView`, `useRenderer`, `useComponents`); a plugin's
  `ui.tsx` may not.

## Events

One family per object, and only these:

| | |
| --- | --- |
| `session.opened` `closed` `changed` | `name`, `activeTab` |
| `tab.opened` `closed` `changed` | `name`, `index`, `layout`, `activePane`, `zoom` |
| `pane.opened` `closed` `changed` | `title`, `cwd`, `block`, `place`, `size`, `exitCode`, `options.*` |
| `pane.alerted` `{kind}` | a bell, OSC 9, OSC 777 |
| `request.opened` `closed {answer}` | |
| `agent.sending` `agent.turned` | the transport's hooks |
| `option.changed` | the global and `{plugin}` scopes only |
| `registry.changed {kind}` `app.changed {isFocused}` | |

So `pane.called`, `terminal.opened`, `terminal.osc`, `pane.blockChanged`, `message.notified`,
`core.started`, `client.attached` and the rest of the old event names are gone: a change is
`<noun>.changed` with the keys it changed, and what has no state of its own (`agent.sending`,
`pane.alerted`) is its own event.

## The CLI is the same names

`pumi NOUN VERB [ID] [ARGS…] [--flags]` is a function: `pumi pane get %3` is `pane.get("%3")`, and
the flags are the fields of its last argument in kebab case (`--no-focus` is `false`). A pane's
methods are verbs: `pumi pane read %3 --lines 80`, `pumi pane run %3 --command 'make test'`.
`pumi open PATH`, `pumi wait`, `pumi call NAME`, `pumi do FILE`, `pumi help NAME`,
`pumi registry list fn`, `pumi plugin add|dev|logs`, `pumi skill add|remove|list|hook`,
`pumi server list|stop`, `pumi option get|set`, `pumi event on`.

There are no tmux verbs and no `-t -L -S -V`: `split-window`, `capture-pane`, `send-keys`,
`kill-pane`, `list-commands`, `pumi api`, `pumi events`, `pumi theme copy`, `pumi pack add`,
`pumi plugin reload|del|info|enable|disable` and `pumi skill setup|status` are gone. A README, a
comment or a script that teaches one moves to the verb table above (`../pumi/docs/user/cli.md`).

## Checking

In the package's directory:

```sh
bunx tsc --noEmit -p .       # the types, against the checkout beside this one
bun test                     # the pure modules: no pumi needs to be running
```

Then, in the pumi checkout, `pumi plugin dev <path>` runs it as you edit it, and
`pumi plugin logs <name>` says what it printed.
