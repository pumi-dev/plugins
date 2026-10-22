# Writing a package here

Every folder in this repository is a pumi package: a directory `pumi pack add` links, whose
`package.json`'s `pumi` key says what it is. A package has two halves — its logic and what it
draws — and everything it contributes is declared in the manifest, without running it.

## A package

```text
mypkg/
  package.json     npm's, and its "pumi" key: the manifest (name, owner, api, contributes, activation, themes)
  tsconfig.json    copies pumi's runtime/app/template/tsconfig.json
  src/main.ts      its logic, in a worker: `import … from "pumi"` (runtime/app/worker/sdk)
  src/ui.tsx       what it draws, in the window: React, `import … from "pumi"` (runtime/app/sdk)
  src/*.ts         pure modules either half imports: no `import … from "pumi"` in them
  src/ui/*.tsx     more of the drawing, imported by ui.tsx
  test/*.test.ts   `bun test`, on the pure modules: no pumi needs to be running
  themes/<name>/   a UI theme: theme.tsx (defineTheme), images
  images/          what a store listing shows
  README.md        what it does, how to use it
```

`ui.tsx` imports `main.ts`'s exports and calls them as async functions: the call goes to the worker
and answers a promise, so an export must answer something serialisable.

## The SDK

- In `main.ts`: `command`, `on`, `provide`, `emit`, `notify`, `option`, `storage`, `paths`, `pkg`,
  `call`, and the nouns (`pane`, `tab`, `session`, `key`, `menu`, `script`, `system`, …).
- In `ui.tsx`: the state hooks (`useApp`, `useSessions`, `useTabs`, `useLayout`, `usePane`,
  `useFocusedPane`, `useAgents`, `useOption`, `useWindow`, …), `useTheme`/`useMetrics`/
  `useComponents`, `call`, `num`, `Icon`, `useWebview`/`WebView`, `renderView`, `Boundary`,
  `useContributions`, and the renderer's kit (`useDraggable`/`useDroppable`, `useInterval`,
  `motion`, `Button`, `Dialog`, `Tooltip`, …).

`pumi` is resolved by the app's Bun host, so it always matches the app. For `tsc`, each package's
`tsconfig.json` names `./node_modules/@pumid/types/index.ts` — the app's own types — which
`bun scripts/link.mjs` links from the pumi checkout beside this one:

```sh
bun scripts/link.mjs           # once, and after adding a package
bun install                    # a package's npm dependencies, if it has any
```

## The manifest

```json
{
  "name": "pumi-queue",
  "version": "0.3.0",
  "type": "module",
  "main": "src/main.ts",
  "pumi": {
    "name": "queue",
    "owner": "amresyd",
    "api": 1,
    "uses": ["processes"],
    "contributes": {
      "options": { "side_by_side": { "type": "boolean", "default": false, "label": "Side by side" } },
      "commands": [{ "id": "toggle", "title": "Queue: show it" }],
      "keys": [{ "key": "<D-S-q>", "command": "toggle" }],
      "points": {
        "panel": { "view": "Board", "title": "Queue", "icon": "list" },
        "pane.strip": { "view": "Bar" },
        "status": { "actions": [{ "id": "toggle", "title": "Queue", "icon": "list", "command": "toggle" }] }
      },
      "views": [{ "id": "board", "title": "Queue" }]
    },
    "activation": ["onStartup"],
    "themes": ["themes/queue"]
  }
}
```

- **`points`** is keyed by the fixed set: `window.titlebar`, `window.overlay`, `session.header`,
  `tab.actions`, `tab.badge`, `pane.toolbar`, `pane.strip`, `pane.overlay`, `pane.menu`,
  `agent.controls`, `agent.footer`, `agent.menu`, `panel`, `status`, `palette.actions`. A point has
  a `view` (a `ui.tsx` export) and/or `actions` (data, drawn as the theme's buttons; an action runs
  its command with `{ pane }` or `{ tab }` of where it was pressed).
- **`views`** are pane types a package opens itself: `{ "id": "board" }` is the type
  `owner.name.board`, drawn by the `ui.tsx` export `Board` with `{ pane }`.
- **`themes`** are the folders `defineTheme` reads: a theme replaces the window's parts it names
  (`runtime/app/sdk/theme.ts` `Components`) and nothing else.
- Everything of the package's own is prefixed `owner.name.` (`pkg.prefixed("board")`).
- `activation` says when the worker starts (`onStartup`, `onView:<id>`, `onCommand:<id>`,
  `onEvent:<name>`); with none it starts on first use.

## Drawing

- **Style objects only**: `style={{ display: "flex", gap: 8, padding: 8, borderRadius: 6,
  hover: { backgroundColor: t.hover } }}`, gpui's names in camelCase. No CSS, no class names.
- **Colours from the theme**: `const t = useTheme()` then `t.surface`, `t.text`, `t.muted`,
  `t.border`, `t.hover`, `t.selected`, `t.accent`, `t["agent.working"]`, … Never a literal.
- **Sizes from `useMetrics()`**: `radius`, `radiusSmall`, `fontSize`.
- **Text is `<text>`**; an icon is `<Icon name="folder" size={14} color={t.muted} />` (the app's
  names, `assets/icons`); a web page is `<WebView handle={pane} src={url} />`; a pane's terminal is
  `<terminal pane={id} autoFocus />`.
- Never block a render: state that arrives later is `useState` + `useEffect`, or a hook over the
  app's store (panes, options) when the state is the app's.

## Working here

```sh
bun scripts/link.mjs                    # the SDK's types into every package
bun test                               # every package's tests (bun scripts/all.mjs)
cd <pkg> && bun test                   # one package's
cd <pkg> && ./node_modules/.bin/tsc --noEmit -p .   # its types
```

In a pumi checkout beside this one, `pumi pack add ./<pkg>` links the package and the app starts
it; `pumi pack dev ./<pkg>` reloads it on save, and `pumi plugin logs <owner>.<name>` shows its
output.

## Reference

- `~/Kitchen/pumi/AGENTS.md`: how pumi itself is put together.
- `PHASE2.md` here: the port this repository just went through — the mapping from the old SDK, the
  two halves, and what "done" means for a package.
- `~/Kitchen/pumi/runtime/app/template`: the smallest package.
- `~/Kitchen/pumi/runtime/app/app/theme/default.tsx`: every point drawn, and how.
