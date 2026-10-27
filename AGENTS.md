# Writing a package here

Every folder in this repository is a pumi plugin: a directory `pumi plugin add` links, whose
`package.json`'s `pumi` key says what it is. A package has two halves — its logic and what it
draws — and everything it contributes is declared in the manifest, without running it.

pumi's model is session → view → pane → tab: a session (`$1`) holds views (`@2`), a view's layout
splits it into panes (`:4`), and a pane holds tabs (`%3`), each tab one block (a terminal, a file,
a plugin's own). Older code and docs here may say "pane" for what is now a tab and "tab" for what
is now a view; write new code and docs in today's names.

## A package

```text
mypkg/
  package.json     npm's, and its "pumi" key: the manifest (name, owner, api, contributes, activation, themes)
  tsconfig.json    a copy of a sibling package's: ../pumi/runtime/app/template/tsconfig.json, with
                   `paths` for `pumi` pointing at ./node_modules/@pumid/types
  src/main.ts      its logic, in a worker: `import … from "pumi"` (../pumi/runtime/app/worker/sdk)
  src/ui.tsx       what it draws, in the window: React, `import … from "pumi"` (../pumi/runtime/app/sdk)
  src/*.ts         pure modules either half imports: no `import … from "pumi"` in them
  src/ui/*.tsx     more of the drawing, imported by ui.tsx
  test/*.test.ts   `bun test`, on the pure modules: no pumi needs to be running
  themes/<name>/   a UI theme: theme.tsx (defineTheme), images
  README.md        what it does, how to use it
```

`ui.tsx` imports `main.ts`'s exports and calls them as async functions: the call goes to the worker
and answers a promise, so an export must answer something serialisable.

## The SDK

- In `main.ts`: `workspace` (the models — `Session`, `View`, `Pane`, `Tab`, `Request`, `Plugin` —
  and the caller's own `currentSession`, `currentView`, `currentTab`), `call`, `fn` (`fn.set(name,
  spec, impl)` registers a function under the plugin's prefix; a manifest command is one), `on`,
  `emit`, `event`, `option`, `registry`, `request` (notifications, permissions, questions), `menu`,
  `agent`, `plugin`, `self` (`self.plugin.id`, `self.plugin.prefixed`), `paths`, `fs`, `clipboard`,
  `process`, `layout`, `stop` and `ui.post`.
- In `ui.tsx`: the state hooks (`useSessions`, `useSession`, `useViews`, `useView`, `useTabs`,
  `useTab`, `useRequests`, `useRegistry`, `useOption`, `useWindow`, …), `useTheme`/`useMetrics`/
  `usePalette`/`useFont`, `call`, `workspace`, `Icon`/`IconButton`, `WebView`/`useWebview`,
  `useChannel`, `useEvent`, `usePlugin`, the renderer's kit (`motion`, `Select`,
  `useDraggable`/`useDroppable`, `useHover`, `useInterval`, `useNow`, …) and the Settings kit
  (`Page`, `Section`, `Row`, `OptionRow`, `Switch`, `Button`, …).
- In a theme: `pumi/theme` too, the window's own kit (`useComponents`, `useSlot`, `useRenderer`,
  `renderComponent`, `useApp`, `useLayout`, `useAgents`, `num`, `commands`, `useLocal`, …).

`../pumi/docs/user/plugins.md` is the whole API; `pumi registry list fn` and `pumi help NAME` say
what a running pumi has.

`pumi` is resolved by the app's Bun host, so it always matches the app. For `tsc`, each package's
`tsconfig.json` names `./node_modules/@pumid/types/index.ts` — the app's own types — which
`bun tools/link.mjs` links from the pumi checkout beside this one (or `$PUMI_SRC`):

```sh
bun tools/link.mjs           # once, and after adding a package
bun install                  # the packages' npm dependencies, if they have any
```

## The manifest

```json
{
  "name": "pumi-queue",
  "version": "0.3.0",
  "license": "GPL-3.0-or-later",
  "type": "module",
  "main": "src/main.ts",
  "pumi": {
    "name": "queue",
    "owner": "amresyd",
    "api": 1,
    "uses": ["processes"],
    "contributes": {
      "options": { "side_by_side": { "type": "boolean", "default": false, "label": "Side by side", "desc": "Run two at once." } },
      "commands": [{ "id": "toggle", "title": "Queue: show it" }],
      "keys": [{ "key": "<D-S-q>", "command": "toggle" }],
      "slots": {
        "panel": { "component": "Board", "title": "Queue", "icon": "list" },
        "tab.toolbar": { "actions": [{ "id": "toggle", "title": "Queue", "icon": "list", "command": "toggle" }] }
      },
      "blocks": [{ "id": "board", "title": "Queue" }]
    },
    "activation": ["onStartup"],
    "themes": ["themes/queue"]
  }
}
```

- **`options`** need a `desc`; their `scope` is `global` (the default), `session`, `view` or `tab`.
- **`slots`** is keyed by the fixed set: `window.overlay`, `session.header`, `session.menu`,
  `view.actions`, `view.badge`, `view.menu`, `tab.toolbar`, `tab.strip`, `tab.overlay`, `tab.menu`,
  `agent.controls`, `agent.footer`, `agent.menu`, `panel`, `sidebar.footer`, `palette.actions`. A
  slot has a `component` (a `ui.tsx` export) and/or `actions` (data, drawn as the theme's buttons;
  an action runs one of the plugin's `commands` with `{ tab }` or `{ view }` of where it was
  pressed). `palette.actions` holds actions only.
- **`blocks`** are what a plugin's tabs hold: `{ "id": "board" }` is the block `owner.name.board`,
  drawn by the `ui.tsx` export `Board` with `{ tab, block, focused }`. **`renderers`** draws a
  block it didn't define: `{ "terminal": "Chat" }`, picked for one tab by its `@tab_renderer`
  option; the core's `file` block takes `{ "export": "Editor", "match": ["*.md"] }`.
- **`settings`** adds pages or sections to Settings, each with a `component`.
- **`themes`** are the folders `defineTheme` reads: colours, metrics, fonts, and the window's
  parts it draws itself (`components`, with the kit from `pumi/theme`).
- Everything of the plugin's own is prefixed `owner.name.` (`-` in the name as `_`). The owner is
  the manifest's `owner` when the plugin is linked from a checkout (`amresyd` here) and the GitHub
  owner when it is installed from GitHub (`pumi_dev` for this repository), so never write the
  prefix out: use `self.plugin.prefixed("board")` in `main.ts`, and the id `usePlugin()` answers
  (`owner/name`) in `ui.tsx`.
- `activation` says when the worker starts (`onStartup`, `onBlock:<id>`, `onCommand:<id>`,
  `onEvent:<name>`); with none it starts when one of its blocks opens or one of its commands runs.

pumi reads the manifest strictly: an unknown key, a slot outside the set, or a slot's `view`
(the old name for `component`) is refused. `../pumi/api/plugin-manifest.schema.json` is its schema.

## Drawing

- **Style objects only**: `style={{ display: "flex", gap: 8, padding: 8, borderRadius: 6,
  hover: { backgroundColor: t.hover } }}`, gpui's names in camelCase. No CSS, no class names.
- **Colours from the theme**: `const t = useTheme()` then `t.surface`, `t.text`, `t.muted`,
  `t.border`, `t.hover`, `t.selected`, `t.accent`, `t["agent.working"]`, … Never a literal.
- **Sizes from `useMetrics()`**: `radius`, `radiusSmall`, `fontSize`.
- **Text is `<text>`**; an icon is `<Icon name="folder" size={14} color={t.muted} />` (the app's
  names, `../pumi/assets/icons`); a web page is `` <WebView handle={`page-${tab.id}`} src={url} /> ``;
  a tab's terminal is `<terminal tab={tab.id} autoFocus />`. Window objects have string ids
  (`%3`, `@2`).
- Never block a render: state that arrives later is `useState` + `useEffect`, or a hook over the
  app's store (tabs, options) when the state is the app's.

## Working here

```sh
bun tools/link.mjs                    # the SDK's types into every package
bun run test                          # every package's tests and types (bun tools/all.mjs)
cd <pkg> && bun test                  # one package's tests
cd <pkg> && ./node_modules/.bin/tsc --noEmit -p .   # its types
```

With pumi running, `pumi plugin add ./<pkg>` links the plugin and the app starts it;
`pumi plugin dev ./<pkg>` links it, reloads it on save and prints its log, and
`pumi plugin logs <name>` shows its output. Do not run `pumi --headless` against your own
directories to try one: `--headless --clean` keeps its own.

## Reference

- `../pumi/docs/user/plugins.md`: the plugin API, the manifest and the SDK.
- `../pumi/docs/user/themes.md`: UI themes, `defineTheme` and the window's parts.
- `../pumi/runtime/app/template`: the smallest package (`pumi plugin new` writes it).
- `../pumi/runtime/app/app/theme/default.tsx`: every slot drawn, and how.
