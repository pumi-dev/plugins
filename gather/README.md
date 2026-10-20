# gather

A pumi UI theme after Gather's office: the window seen from above as a pixel-art floor. Each view
is a room — grey carpet, a blue rim, its name on a sign — and each pane in it is a desk, with its
terminal as the monitor and whoever works there sitting at it, back to you, a name tag under the
chair. A desk keeps its tabs in a tray along its top, so several terminals can sit at one desk.
The lobby down the left is one more room, on tiles, where every agent stands, and your character
walks to the desk you focus. Menus are the game's framed dialog boxes.

```sh
pumi plugin add ./gather
pumi option set ui_theme gather
```

Day is Gather's own map colours with cream dialog boxes; night is the office in the dark with blue
RPG windows. It draws the default theme's behaviour (`runtime/app/app/theme/default.tsx` in pumi)
in its own look.

## Options

| Option | Default | |
| --- | --- | --- |
| `appearance` | `system` | **Mode**: light, dark, or follow the system. |

Its full name is `amresyd.gather.appearance`.

## Working on it

```sh
./node_modules/.bin/tsc --noEmit -p .   # the types
bun tools/art.ts                        # draws themes/gather/art/ and themes/gather/preview.svg
```

`themes/gather/theme.tsx` is the `defineTheme` (colours, metrics, the mode); `window.tsx` draws the
window's parts, and `art.tsx` the sprites, boxes and tags from the SVGs under `art/`. Every sprite is
a grid of art pixels drawn as crisp rects, so it stays sharp at any display scale. The package has
no tests.
