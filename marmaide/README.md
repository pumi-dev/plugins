# marmaide

Mermaid diagrams in a pumi tab, drawn by [Pele](https://pele.run) — kepano's small synchronous
Mermaid renderer, the one Obsidian draws with. Made for explaining: an agent puts a flow, a state
machine or a schema in a tab beside the sentence it is trying to make, and redraws that tab as the
answer changes.

```sh
pumi plugin add pumi-dev/plugins/marmaide

pumi call pumi_dev.marmaide.draw 'flowchart LR
  ask --> draw --> look'
pumi call pumi_dev.marmaide.draw '{"path": "figure.mmd", "tab": "%12"}'
pumi call pumi_dev.marmaide.render '{"path": "figure.mmd"}' | jq -r .svg
```

## The two functions

| Function | Answers |
| --- | --- |
| `marmaide.draw {source \| path, tab?, title?, place?}` | `{tab, type, width, height, opened}` — a tab opens beside this one, or `tab`'s diagram is redrawn |
| `marmaide.render {source \| path}` | `{svg, type, width, height}` — Pele's own SVG (its `--pele-*` variables and all), nothing shown |

`place` is a tab place like any other (`{"kind": "float", "width": "60%"}`); the tab's title is the
kind of diagram unless `title` says otherwise.

## Options

| Option | | |
| --- | --- | --- |
| `marmaide.font` | string | The diagram's face. Empty is the app's own font. |
| `marmaide.font_mono` | string | Code and constants. Empty is the app's monospace font. |
| `marmaide.font_size` | number | What Pele lays a diagram out at, 16 by default. |
| `marmaide.source` | string, per tab | The Mermaid a diagram tab draws. `marmaide.draw` sets it; a new value is a new drawing, and it is what brings the diagram back with a restored layout. |

A diagram is drawn by the window, so it needs a pumi with `<svg paint="image">` (0.48 and after).

A face named here must be one the machine has: a diagram is painted by the app's own SVG renderer,
which has the system's fonts and none of a package's.

## How it works

1. `src/pele.ts` draws the source — Pele's own SVG, with Pele's defaults in it — and writes every
   `var(--pele-*)` back out as the value it names: the window's SVG painter (resvg) knows no CSS
   custom properties.
2. `src/palette.ts` says the app's theme the way Pele's SVG says it: the window's tokens, handed to
   `marmaide.drawn` with every draw, become `--pele-fg`, `--pele-bg`, `--pele-accent` and the rest.
   Fills and lines are mixed from the background and the text — a theme may paint a surface almost
   the colour of its background, and a diagram of invisible boxes is no diagram. A theme switched
   while a tab is open draws it again.
3. The tab draws that markup with the window's own `<svg paint="image">` element: the app parses it
   with resvg and rasterises it at the size on screen, drawing it again when that size changes, so
   the diagram is sharp at any zoom and nothing is written to disk. (`<svg>` without `paint` is an
   icon: one colour.)
4. The source lives in the tab's `source` option, so a redraw is one option set: the tab's view
   hears the change and draws again.

## Building it

```sh
cd marmaide
bun install                    # Pele, from npm
bun test                       # the drawing itself: no pumi running
bun run check                  # types

## Licence

MIT. The diagram renderer is [Pele](https://pele.run), also MIT; Mermaid's syntax is its to draw,
the diagrams are yours.
