# Writing a package here

Every folder in this repository is a pumi package. A package is a directory `pumi pack add` links:
its `package.json`'s `pumi` key says what it is, and its `src/main.ts` is its code, run by pumi's
Bun host while an app is open. The packages used to be Rust (`ui/`, compiled to wasm) and Lua
(`themes/<name>/theme.lua`); they are being ported to TypeScript, one folder at a time.

## A package

```text
mypkg/
  package.json     npm's, and its "pumi" key: the manifest (name, owner, api, contributes, activation)
  tsconfig.json    copies pumi's runtime/bun/template/tsconfig.json
  src/main.ts      the package's code: views, commands, events, provided functions, options read
  src/**/*.ts
  test/*.test.ts   `bun test`, against `pumi/testing`'s FakeApp: no pumi needs to be running
  themes/<name>/   a UI theme: theme.ts (defineTheme), *.css, preview.png
  images/          what a store listing shows
  README.md        what it does, how to use it
```

## The SDK

`import { pane, tab, on, notify, provide, command, View, view, div, text, px, theme, ui, list,
input, textArea, scroll, canvas, terminal, webview, storage, paths } from "pumi"`. The API is
dotted and TypeScript-first (`pane.open`, `tab.select`, `option.get`), events are `noun.pastTense`
(`pane.closed`, `option.changed`), and ids are numbers (`Pane` objects wrap them).

- `pumi` is resolved by the app's Bun host, so it always matches the app. Locally, each package's
  `node_modules/@pumid/types` links this checkout's SDK (`bun scripts/link.mjs` at the root does
  it for every package).
- Read `/path/to/pumi/runtime/bun/sdk/README.md` first, then
  `/path/to/pumi/runtime/bun/template/AGENTS.md`.
- Every element and view API, with a working example:
  `/path/to/pumi/runtime/bun/examples/gallery`. A whole window as a theme:
  `/path/to/pumi/runtime/bun/examples/default-theme`.

## The manifest

```json
{
  "name": "pumi-queue",
  "version": "0.3.0",
  "description": "…",
  "type": "module",
  "main": "src/main.ts",
  "scripts": { "test": "bun test", "check": "tsc --noEmit" },
  "devDependencies": { "@pumid/types": "1.0.0", "@types/bun": "1.3.14", "typescript": "5.9.3" },
  "pumi": {
    "name": "queue",
    "owner": "amresyd",
    "api": 1,
    "uses": ["processes"],
    "contributes": {
      "options": { "side_by_side": { "type": "boolean", "default": false, "label": "Side by side" } },
      "commands": [{ "id": "toggle", "title": "Toggle the queue" }],
      "keys": [{ "key": "<C-q>", "command": "toggle" }],
      "views": [{ "id": "bar", "title": "Queue", "icon": "list" }]
    },
    "activation": ["onStartup"]
  }
}
```

Options, commands, keys and views are declared **only** in the manifest: they are registered
without running the package, so the palette, Settings, key bindings and the store know them. The
package's prefix is `owner.name.` (option `queue.side_by_side`, view type `amresyd.queue.bar`,
event `amresyd.queue.done`); the SDK adds it for `view("bar")`, `command("toggle")` and `on(...)`.
`activation` says when the worker starts (`onStartup`, `onView:<id>`, `onCommand:<id>`,
`onEvent:<name>`); with none it starts on first use.

## Working here

```sh
bun scripts/link.mjs            # once, and after adding a package: links @pumid/types everywhere
cd <pkg>
bun test                        # the package against pumi/testing
./node_modules/.bin/tsc --noEmit   # types (the homebrew tsc is older; use this one)
bun scripts/all.mjs             # at the root: every package's tests and types
```

In a pumi checkout beside this one, `pumi pack add ./<pkg>` links the package and the app starts it;
`pumi pack dev ./<pkg>` reloads it on save, and `pumi plugin logs <owner>.<name>` shows its output.
