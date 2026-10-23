# Office

A pumi UI theme: the app as a pixel office you walk around, drawn in Gather's style — wood floors,
carpeted rooms with their names on plates, dark name tags, framed game boxes and the Pixelify Sans
pixel font (bundled in `themes/office/fonts/`). Day (light) or night (dark) is its **Mode** setting.

Every session is a room on the floor, and every view in it is a desk whose little screen shows the
tab in front of it, live — so the whole app is in the room at once. Its agent sits at the desk,
back to you, with a bubble saying what it is doing (typing dots, a `!` when it needs you, a tick).

- **One desk per tab** (`desk_per_tab`, in Settings → Office, or the hotbar's grid slot) gives
  each tab of a split view its own desk, agent and screen. Sitting at one opens that tab ("Whole
  view" in the monitor shows the rest).
- **Sit at a desk** (walk up and press X, or click it) and the monitor opens with the real views.
  "Stand up" or a press outside it closes it.
- **Drag a desk** by its body to move it; where you left it is kept (`office.desks`). Double-click
  renames its view; right-click is its menu — the office's own, then its view's and its tab's, the
  app's and the plugins' items together.

## The plugins

- **The lobby** down the left (⌘B, the hotbar's sidebar slot, or the bookshelf): the players —
  every agent; a click walks you to their desk and sits you down — and every plugin's `panel`
  component on a notice board, each folded by its sign.
- **The top right**: the minimap.
- **The bar along the foot**: you, the hotbar (New desk, Decorate, the lobby, One desk per tab,
  Settings, the emotes 1–5), the agents' counts (a click walks you to one) and the clock.
- Their `window.overlay` components, menus (`Menu`), questions (`Dialog`) and buttons (`Action`) are
  drawn as the office's pixel boxes.

## Playing it

- **Walk** with WASD or the arrow keys — brisk, sliding along what you bump into — or click the
  floor: a click's walk is over in under half a second however far it goes. The camera follows
  you; the wheel looks around.
- **X** (or E, Enter, Space) uses what you stand by: sit at a desk, the bookshelf (the lobby),
  coffee (Settings), the door mat (your sessions), and the furniture — ping-pong, the arcade, the
  lamp, the TV, the sofa. **1–5** are emotes. Click your card in the bar for another look.
- **Decorate** places furniture, drags what is on the floor (× puts it away), and changes the floor,
  the wall paint and the lights. Everything is kept across runs (`office.furniture`, `office.floor`, …).

## Working on it

```sh
bun tools/link.mjs                 # at the repository's root, once: links @pumid/types
./node_modules/.bin/tsc --noEmit   # the types
bun test                           # the walk and the plan
bun tools/art.ts                   # redraws the furniture, walls, and copies the gather art
```

`themes/office/plan.ts` decides where the rooms and desks go; `game.ts` walks you (time-based, so a
late frame catches up instead of slowing you); `window.tsx` draws the room, `kit.tsx` the pixel
boxes, tags and slots, `parts.tsx` the window's parts beside it, `build.tsx` Decorate mode.
