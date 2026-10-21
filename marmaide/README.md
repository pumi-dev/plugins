# marmaide

Mermaid diagrams in a pumi pane, drawn by [Pele](https://pele.run) — kepano's renderer, the
small synchronous one Obsidian draws with. Made for explaining: an agent with the `marmaide`
tool can put a flow, a state machine or a schema beside the sentence it is trying to make, and
keep drawing on the same pane as the answer changes.

```sh
pumi pack add ~/Kitchen/pumi-plugins/marmaide      # or a copy of this directory
pumi plugin reload marmaide

printf 'flowchart LR\n  ask --> draw --> look\n' | bin/marmaide draw
```

`bin/marmaide` is the command line around the API (`marmaide draw | svg | save | size | types`);
`AGENTS.md` is what tells an agent it is Marmaide and what it may draw with.

## What it needs

A JavaScript runtime — **`bun` or `node`** — because Pele is JavaScript and a pumi plugin is
WASM. The plugin looks for one on `PATH` and then where they usually live (`~/.bun/bin`,
`/opt/homebrew/bin`, `nvm`, …); the option `marmaide.runtime` names one outright. Nothing is
installed at runtime and Pele is vendored (`vendor/pele.js`, 660 KB), so a diagram is drawn
offline.

## The three functions

Any caller — an agent's `pumi call`, a script, another package, a JSON-RPC client:

| Function | Answers |
| --- | --- |
| `marmaide.draw {source \| path, pane?, title?, place?}` | `{pane, type, width, height, opened}` — a tiled pane opens beside the current one, or `pane`'s diagram is replaced |
| `marmaide.render {source \| path}` | `{svg, type, width, height}` — Pele's own SVG (CSS variables and all), nothing shown |
| `marmaide.save {source \| path, path, scale?}` | `{path, type, width, height}` — writes `.svg` (Pele's own, themeable anywhere) or `.png` (the picture the pane draws, in the app's colours; `scale` is pixels to the point, 2 by default) |

```sh
pumi call marmaide.draw 'flowchart LR
  a --> b'
pumi call marmaide.draw '{"path": "figure.mmd", "pane": 12}'
pumi call marmaide.render 'sequenceDiagram
  A->>B: hi' | jq -r .svg
```

`place` is a pane place like any other (`{"kind": "float", "width": "60%"}`); the pane's title is
the kind of diagram unless `title` says otherwise.

## Options

Settings → Packages → **marmaide** (all of them are also `pumi call pumi_set_option_value`):

| Option | | |
| --- | --- | --- |
| `marmaide.runtime` | string | The program that runs Pele; empty finds `bun`, then `node`. |
| `marmaide.font` | string | The diagram's face — `IBM Plex Sans` by default (shipped with the package). |
| `marmaide.font_mono` | string | Code and constants — `IBM Plex Mono` by default. |
| `marmaide.font_size` | number | What Pele lays a diagram out at, 16 by default. |
| `marmaide.source` | string, per pane | The Mermaid a diagram pane draws. Written by `marmaide.draw`; it is what makes a redraw a redraw, and what brings the diagram back with a restored layout. |

## How it works

Pele renders Mermaid to SVG in about a millisecond, but it is JavaScript, and a component is
WASM. So the work is split at the one place both sides understand — a pipe:

1. `render.mjs` (this package, run by `bun`/`node`) imports the vendored Pele, reads one JSON
   request on stdin and writes one JSON answer on stdout. It resolves the theme's colours into
   the SVG (a rasteriser knows no CSS custom properties) and keeps Pele's own SVG for `render`
   and `save`, where a browser's variables are wanted.
2. The component (`ui/`) rasterises that SVG with `resvg` — the same one gpui paints SVG with —
   at the pixels the pane wants, on the pane's own background, with the fonts Pele measured the
   diagram in, and draws it as an image. Text is text: without those fonts a diagram is boxes.
3. The pane's source lives in the option `marmaide.source` (pane-scoped), so `marmaide.draw` is
   "set the option, show the pane": the view hears the change and paints again.

Two things follow from WASI: a linked package's directory is a symlink and the sandbox will not
follow one, so the fonts are copied by `render.mjs` (which runs natively) into the plugin's data
directory (`~/.local/share/pumi/ui/marmaide/fonts`), and the rasteriser reads them there.

Rendering costs one runtime start the first time (~150 ms for bun, ~40 ms for node); after that
a diagram is cached by its source, so redrawing a pane is free and zooming re-paints the same
SVG at more pixels.

## The pane

Fitted to itself, in the app's own colours — the theme's background and text are mixed for
fills, lines and borders, so a diagram reads in any theme. It is a canvas, not a picture of one:
**drag** it with the mouse, **zoom** with the wheel, a trackpad scroll or a two-finger pinch
(pointer-anchored), and double-click or `fit` to put it back. Zooming re-paints the SVG at the
new size rather than stretching pixels. `−` and `+` in the footer do the same from the keyboard's
side.

## Building it

```sh
cd ~/Kitchen/pumi-plugins && cargo build --release -p marmaide   # wasm32-wasip2, the workspace's
pumi plugin reload marmaide
pumi plugin logs marmaide
```

The crate's tests are the renderer's `render.mjs` one end and resvg the other; they need a native
target (`cargo test -p marmaide --lib --target aarch64-apple-darwin`), which this SDK's
`plugin!` macro does not build on macOS — the tests are there for a Linux checkout.

## Licences

Pele is MIT (`vendor/pele.LICENSE`); IBM Plex Sans and Mono are OFL (`vendor/fonts/OFL.txt`).
Mermaid's syntax is Pele's to draw; the diagrams are yours.
