# marmaide

Mermaid diagrams in a pumi pane, drawn by [Pele](https://pele.run) — kepano's renderer, the
small synchronous one Obsidian draws with. Made for explaining: an agent with marmaide's `draw`
function can put a flow, a state machine or a schema beside the sentence it is trying to make, and
keep drawing on the same pane as the answer changes.

```sh
pumi plugin add ~/Kitchen/pumi-plugins/marmaide    # or a copy of this directory
pumi plugin update marmaide

pumi call local.marmaide.draw 'flowchart LR
  ask --> draw --> look'
```

(`local.marmaide.` while the package is linked from disk; `amresyd.marmaide.` once it is
installed. `pumi registry list fn` lists what a package provides.)

## What it needs

Nothing but pumi and Bun, which pumi runs its packages on: Pele is a dependency (`pele` on npm, MIT)
and the package's own worker runs it. The Rust package had to start `render.mjs` under a `bun` or
`node` it found on the machine, one process per diagram; this one calls the renderer.

## The three functions

Any caller — an agent's `pumi call`, a script, another package, a JSON-RPC client:

| Function | Answers |
| --- | --- |
| `marmaide.draw {source \| path, pane?, title?, place?}` | `{pane, type, width, height, opened}` — a tiled pane opens beside the current one, or `pane`'s diagram is replaced |
| `marmaide.render {source \| path}` | `{svg, type, width, height}` — Pele's own SVG (its `--pele-*` variables and all), nothing shown |
| `marmaide.save {source \| path, out}` | `{path, type, width, height}` — writes `.svg`: Pele's own, themeable anywhere |

```sh
pumi call local.marmaide.draw 'flowchart LR
  a --> b'
pumi call local.marmaide.draw '{"path": "figure.mmd", "pane": "%12"}'
pumi call local.marmaide.render 'sequenceDiagram
  A->>B: hi' | jq -r .svg
```

`place` is a pane place like any other (`{"kind": "float", "width": "60%"}`); the pane's title is
the kind of diagram unless `title` says otherwise. `save`'s `out` is the file it writes; its older
shape, `{source, path}`, writes `source` to `path` too.

## Options

Settings → Plugins → **marmaide** (all of them are also `pumi option set`):

| Option | | |
| --- | --- | --- |
| `marmaide.font` | string | The diagram's face. Empty is the app's own font, which its renderer has. |
| `marmaide.font_mono` | string | Code and constants. Empty is the app's monospace font. |
| `marmaide.font_size` | number | What Pele lays a diagram out at, 16 by default. |
| `marmaide.source` | string, per pane | The Mermaid a diagram pane draws. Written by `marmaide.draw`; it is what makes a redraw a redraw, and what brings the diagram back with a restored layout. |

A face named here must be one the machine has: a diagram is painted by the app's own SVG renderer,
which has the system's fonts and none of a package's.

## How it works

Pele renders Mermaid to SVG in about a millisecond, and it is JavaScript: it runs in this package's
worker, in the same file it is vendored as.

1. `src/pele.ts` draws the source — Pele's own SVG, with Pele's defaults in it — and reads every
   `var(--pele-*)` back out of it, so a renderer that knows no CSS custom properties gets the
   colours written where it can see them.
2. `src/palette.ts` says the app's theme the way Pele's SVG says it: the window's tokens (its
   renderer's `useTheme()` and `useMetrics()`, which it hands `marmaide.drawn` with every draw), as
   `#rrggbb`, become `--pele-fg`, `--pele-bg`, `--pele-accent` and the rest, and the fills and lines
   are mixed from the background and the text — a theme may paint a surface almost the colour of its
   background, and a diagram of invisible boxes is no diagram. A theme switched while a diagram is
   open draws it again; a call from elsewhere (`render`, `save`) has no window, so it gets Pele's own
   colours.
3. `src/picture.ts` writes the dressed SVG into the package's cache, named by what is in it, and the
   pane draws it as an image (`img`): the app paints SVG with usvg, so the diagram is sharp at any
   size.
4. The pane's source lives in the option `marmaide.source` (pane-scoped), so `marmaide.draw` is
   "set the option, show the pane": the view hears the change and draws again.

The Rust package rasterised the same SVG itself with resvg, inside the component, because gpui's
renderer looked for the app's bundled faces where a package could not reach. The app's renderer now
finds the system's, so the package ships no fonts and asks for none: `font` and `font_mono` name a
face the machine has.

## The pane

Fitted to itself, in the app's own colours. It is a canvas, not a picture of one: **drag** it with
the mouse, **zoom** with the wheel (pointer-anchored, a trackpad's many small deltas adding up to
the same), and double-click or `fit` to put it back. `−` and `+` in the footer do the same from the
keyboard's side.

**Click a node** and a note goes with it to an agent: the pane picks an agent running in a pane of
this tab (marked `@agent`, and not a shell), and the note is **queued** for it (`agent.queue`, in
the core) with the diagram's source and the node's id and label. It goes to the agent as its next
message once its turn ends — nothing is typed into it. `To … ⇄` cycles through the agents there are.

A diagram that Pele cannot read is said in the pane, with the line it could not read, and again in
the answer to whoever asked for it — so an agent reads it and fixes that line.

## Building it

```sh
cd ~/Kitchen/pumi-plugins/marmaide
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit
```

## Licences

Pele is MIT (`pele` on npm, its licence in `node_modules/pele`). Mermaid's syntax is Pele's to
draw; the diagrams are yours.
