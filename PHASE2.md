# Porting a package to the React app

The app was rewritten: each window is one React tree, and a package now has two halves. This file
is the contract every port follows. It is the only briefing you need; read it fully before you
start, and follow it exactly.

## What changed

| Before | Now |
| --- | --- |
| `src/*.ts`, one file per part, drawing with the builder (`div().flex().gap(px(8))`) and a `View` class | `src/main.ts` (logic, a worker) and `src/ui.tsx` (what it draws, React) |
| `contributes.views` with slots (`sidebar.left`, `statusline`, `winbar.bottom`, `PaneStrip`) | `contributes.points`, keyed by point: `panel`, `status`, `pane.strip`, `tab.badge`, … |
| style rules (`style.set`), CSS, `.class("x")` | style objects only: `style={{ … , hover: { … } }}` |
| the theme's colours as `theme.bg`, `token("agent.working")`, `px(8)` | `useTheme()` (`t.surface`, `t["agent.working"]`), plain numbers for pixels |
| `native(view)`, `ui.*` | `<terminal pane>`, `<preview pane>`, and divs |
| `icon("check")` | `<Icon name="check" />` from `"pumi"` |
| `list(...)` | divs, or `<virtual-list>` for long ones |

## The two halves

```text
src/main.ts    the logic: commands, events, provided functions, options, panes it opens.
               `import … from "pumi"` is the worker SDK: pane, tab, session, option, event, key,
               menu, pack, script, client, fs, paths, storage, system, notify, on, emit, provide,
               command, call.
src/ui.tsx     what it draws: React components. `import … from "pumi"` is the window SDK:
               the state hooks (useSessions, useSession, useTabs, useTab, useLayout, usePane,
               useFocusedPane, useFloats, useAgents, useAgent, useAgentOf, useOption, useWindow,
               useConnection, useZoomed), useTheme/useMetrics/useAppearance, call, Icon,
               useAgentStatus, WebView/useWebview, Boundary, renderView, useContributions,
               usePackage, and the elements below.
src/*.ts       pure logic either half imports: no `import … from "pumi"` in it, ever.
src/ui/*.tsx   more of the drawing, imported by ui.tsx (same rules as ui.tsx).
```

`ui.tsx` imports `main.ts`'s exports and calls them as async functions: the call goes to the
worker and answers a promise. So `export function load(path: string): Row[]` in `main.ts` is
`await load(path)` in `ui.tsx`. Exports must be serialisable (JSON).

Move code as it is: most of a package is already logic (`main.ts` and the modules it imports,
which rarely import `pumi`). Only the `View` classes and their helpers are rewritten.

## The manifest

```json
"pumi": {
  "name": "queue",
  "owner": "amresyd",
  "api": 1,
  "main": "src/main.ts",
  "contributes": {
    "options": { … },
    "commands": [{ "id": "toggle", "title": "Queue: show it" }],
    "keys": [{ "key": "<D-S-q>", "command": "toggle" }],
    "points": {
      "panel": { "view": "Board", "title": "Queue", "icon": "list" },
      "pane.strip": { "view": "Bar" },
      "status": { "actions": [{ "id": "toggle", "title": "Queue", "icon": "list", "command": "toggle" }] }
    },
    "views": [{ "id": "board", "title": "Queue" }]
  }
}
```

- **`points`** is keyed by point. A point has a `view` (the name of a `ui.tsx` export), `actions`
  (data: `id`, `title`, `icon`, `command`, drawn as the theme's own buttons), or both. An action
  runs its command with `{ pane }` or `{ tab }` of where it was clicked.
- **The points** (the fixed set): `window.titlebar`, `window.overlay`, `session.header`,
  `tab.actions`, `tab.badge`, `pane.toolbar`, `pane.strip`, `pane.overlay`, `pane.menu`,
  `agent.controls`, `agent.footer`, `agent.menu`, `panel`, `status`, `palette.actions`.
- **Mapping from the old places**:
  - `slot: "sidebar.left"` (a page in the side bar) → **`panel`**, with its title and icon.
  - `slot: "statusline"` → **`status`**.
  - `slot: "winbar.bottom"` / `"PaneStrip"` / a strip under a pane → **`pane.strip`**.
  - `slot: "tabline"` extras → **`tab.actions`** (buttons) or **`tab.badge`** (a small label).
  - `slot: "titlebar.*"` → **`window.titlebar`**; a page over everything → **`window.overlay`**.
  - a page over a pane → **`pane.overlay`**; a right-click menu → **`pane.menu`**.
  - anything the package opens as a pane (`pane.open`) stays a **`views`** pane type: floats
    (palette, pickers, overlays) and tiled panes (browser, diagrams).
- **A point view's props**: `panel`, `status`, `pane.strip`, `pane.toolbar`, `pane.overlay`,
  `window.titlebar`, `window.overlay`, `agent.controls`, `agent.footer` get
  `{ pane?: string; tab?: string; session?: string }` where they make sense (`pane.*` and
  `agent.*` always get `pane`); `pane.menu` and `agent.menu` also get `close()`.
- **`views` stay pane types**: `{ "id": "board" }` is the type `owner.name.board`, drawn by the
  `ui.tsx` export `Board` (PascalCase of the id) with `{ pane }`. `pane.open(type, args, place)`
  opens one, from `main.ts`.
- **Option names are unchanged**: the server prefixes them with `owner.name.`.

## Drawing rules

- **Style objects only.** `style={{ display: "flex", gap: 8, padding: 8, borderRadius: 6,
  hover: { backgroundColor: t.hover }, active: { backgroundColor: t.active } }}`. The keys are
  gpui's names in camelCase (`backgroundColor`, `borderWidth`, `flexGrow`, `whiteSpace`,
  `textOverflow`, `minWidth`, `flexShrink`). No CSS, no class names, no `style.*` API.
- **Colours come from the theme**: `const t = useTheme()` then `t.surface`, `t.text`, `t.muted`,
  `t.faint`, `t.border`, `t.hover`, `t.active`, `t.selected`, `t.accent`, `t.warning`, `t.error`,
  `t.window`, `t.editor`, `t["agent.working"]` … Never a colour literal, except a transparent or
  a shadow's black. Leave a view's background unset unless it draws its own panel.
- **Sizes come from `useMetrics()`**: `radius`, `radiusSmall`, `fontSize`.
- **An icon**: `<Icon name="folder" size={14} color={t.muted} />`. The names are the app's set
  (`assets/icons`), and `agent`, `branch`, `dot`, `search`, `sliders` are aliases that already
  work. An icon that is not there draws nothing: pick one from `assets/icons`.
- **A terminal**: `<terminal pane={id} autoFocus={focused} style={{ flexGrow: 1 }} />`.
- **A web page**: `<WebView handle={pane} src={url} />` (a package's own file: `src="index.html"`).
- **A long list**: `<virtual-list>` with `itemCount`/`estimatedItemHeight`, or divs when it is short.
- **Text is `<text>`**, styled by the `style` object; it takes children as a string.
- **Interaction**: `onClick`, `onMouseDown`, `onMouseEnter`/`onMouseLeave`, `onKeyDown` (needs
  `autoFocus` or a click), `onAuxClick` (a right click; `e.isRightClick`). A click's event has
  `e.x`/`e.y` (window coordinates) and `e.isRightClick`. Drag: `onMouseDown` remembers the start,
  `onMouseMove` follows, `onMouseUp` ends — as the default theme's sidebar resizer does.
- **Suspense**: `ui.tsx` may be async at the top only in the sense of awaiting `main.ts` inside
  event handlers; a component body must be sync. Use `useEffect`/`useState` for loading.
- **Never block**: a component that awaits inside render is a bug. State that arrives later is
  `useState` + `useEffect`, or a hook over the app's own store if it is the app's (panes, options).

## Naming and comments

- Everything of the package's own is prefixed `owner.name.` (`pkg.prefixed("board")`).
- Keep the existing comments' voice: full sentences, lowercase after a colon, `the app` and
  `the package`, no marketing. Keep the file's leading comment, rewritten for the two halves.
- Keep the tests that test logic (`src/*.test.ts` on pure modules). Delete snapshot tests of the
  old tree, or replace them with logic tests; there is no testing kit for the React tree yet.

## Checking your work

Every package's `tsconfig.json` already points `pumi` at the app's types
(`~/Kitchen/pumi/runtime/app/types`, linked as `@pumid/types` by `bun tools/link.mjs`), with
`"jsx": "react-jsx"` and `"jsxImportSource": "pumi"`. If `tsc` can't find `pumi`, run
`bun tools/link.mjs` from the workspace root.

```sh
cd <package>
bunx tsc --noEmit -p .        # must be clean
bun test                      # the logic tests, if any
node -e 'JSON.parse(require("fs").readFileSync("package.json"))'
```

Do **not** run `pumi pack add`/`del`, do not start the app, and do not touch git: the app is one
process for the whole machine, and the integration pass adds every package at the end.

Read these before you write anything:

- `~/Kitchen/pumi/runtime/app/template/src/ui.tsx` and `template/src/main.ts`: the smallest pair.
- `~/Kitchen/pumi/runtime/app/app/theme/default.tsx`: every point drawn, and how.
- `~/Kitchen/pumi/runtime/app/sdk/`: the window SDK (`index.ts`, `state.ts`, `theme.ts`,
  `contributions.ts`, `webview.tsx`, `elements.tsx`).
- `~/Kitchen/pumi/runtime/app/worker/sdk/`: the worker SDK (`index.ts`, `core.ts`).
- `~/Kitchen/pumi/site/content/docs/ui.md` and `ui-themes.md`: points and themes, for users.

## What "done" means for one package

1. `src/main.ts` compiles and holds all the logic, its commands, options and the panes it opens.
2. `src/ui.tsx` draws every part the package had, as the manifest's points and views.
3. The manifest declares `main`, the points (with titles and icons) and the views it still opens.
4. `bunx tsc --noEmit` is clean and `bun test` passes.
5. No `View`, no builder, no `px()`, no `theme.` (the old tokens), no `native(`, no `icon(`,
   no `ui.`, no `style.set`, no `.class(`, and nothing imports a module that imports `"pumi"`
   from the wrong half.
