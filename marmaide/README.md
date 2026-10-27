# marmaide

Mermaid diagrams in a pumi tab, drawn by [Pele](https://pele.run) — kepano's renderer, the
small synchronous one Obsidian draws with. Made for explaining: an agent with marmaide's `draw`
function can put a flow, a state machine or a schema beside the sentence it is trying to make, and
keep drawing on the same tab as the answer changes.

```sh
pumi plugin add ./marmaide           # or a copy of this directory
pumi plugin update amresyd/marmaide  # read it again after a change

pumi call amresyd.marmaide.draw 'flowchart LR
  ask --> draw --> look'
```

(`amresyd.marmaide.` while the package is linked from this repository, as its manifest's `owner`
says; `pumi_dev.marmaide.` once it is installed from GitHub. `pumi registry list fn` lists what a
package provides.)

## What it needs

Nothing but pumi and Bun, which pumi runs its packages on: Pele (`pele` on npm, MIT) is vendored as
`src/pele.vendor.js`, since the app's workers resolve a package's own files and not its
`node_modules` (`bun install && bun scripts/vendor-pele.mjs` writes it again after bumping `pele`),
and the package's own worker runs it.

## The three functions

Any caller — an agent's `pumi call`, a script, another package, a JSON-RPC client. Each name
starts with the package's prefix:

| Function | Answers |
| --- | --- |
| `marmaide.draw {source \| path, pane?, title?, place?}` | `{pane, type, width, height, opened}` — a tiled tab opens beside the current one, or the diagram in the tab `pane` names is replaced |
| `marmaide.render {source \| path}` | `{svg, type, width, height}` — Pele's own SVG (its `--pele-*` variables and all), nothing shown |
| `marmaide.save {source \| path, out}` | `{path, type, width, height}` — writes `.svg`: Pele's own, themeable anywhere |

```sh
pumi call amresyd.marmaide.draw 'flowchart LR
  a --> b'
pumi call amresyd.marmaide.draw '{"path": "figure.mmd", "pane": "%12"}'
pumi call amresyd.marmaide.render 'sequenceDiagram
  A->>B: hi' | jq -r .svg
```

`place` is a tab's place as `tab.open` takes it (`{"kind": "float", "width": "60%"}`); the tab's
title is the kind of diagram unless `title` says otherwise. `save`'s `out` is the file it writes; its older
shape, `{source, path}`, writes `source` to `path` too.

## Options

Settings → **marmaide** (all of them are also `pumi option set`; their full names start with the
package's prefix, `amresyd.marmaide.font`):

| Option | | |
| --- | --- | --- |
| `font` | string | The diagram's face. Empty is the app's own font, which its renderer has. |
| `font_mono` | string | Code and constants. Empty is the app's monospace font. |
| `font_size` | number | What Pele lays a diagram out at, 16 by default. |
| `source` | string, per tab | The Mermaid a diagram tab draws. Written by `marmaide.draw`; it is what makes a redraw a redraw, and what brings the diagram back with a restored layout. |

A face named here must be one the machine has: a diagram is painted by the app's own SVG renderer,
which has the system's fonts and none of a package's.

## How it works

Pele renders Mermaid to SVG in about a millisecond, and it is JavaScript: it runs in this package's
worker, from the file it is vendored as.

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
   tab draws it as an image (`img`): the app paints SVG with usvg, so the diagram is sharp at any
   size.
4. The tab's source lives in the option `source` (tab-scoped), so `marmaide.draw` is "set the
   option, show the tab": the component hears the change and draws again.

The app's renderer finds the system's fonts, so the package ships none and asks for none: `font`
and `font_mono` name a face the machine has.

## The diagram tab

Fitted to itself, in the app's own colours. It is a canvas, not a picture of one: **drag** it with
the mouse, **zoom** with the wheel (pointer-anchored, a trackpad's many small deltas adding up to
the same), and double-click or `fit` to put it back. `−` and `+` in the footer do the same from the
keyboard's side.

**Click a node** and a note goes with it to an agent: the tab picks an agent running in a tab of
this view (marked `@agent`, and not a shell), and the note is **queued** for it (`agent.queue`, in
the core) with the diagram's source and the node's id and label. It goes to the agent as its next
message once its turn ends — nothing is typed into it. `To … ⇄` cycles through the agents there are.

A diagram that Pele cannot read is said in the tab, with the line it could not read, and again in
the answer to whoever asked for it — so an agent reads it and fixes that line.

## Building it

```sh
cd marmaide
bun test                       # the pure logic: no pumi running
./node_modules/.bin/tsc --noEmit -p .
```

## Licences

Pele is MIT (`pele` on npm; its licence is in `node_modules/pele` after `bun install`). Mermaid's syntax is Pele's to
draw; the diagrams are yours.
