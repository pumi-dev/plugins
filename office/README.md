# Office

A pumi UI theme: the app as a little pixel office, after Gather. Every session is a pod on the
floor with its name on it, and every tab in it is a desk whose little screen shows that tab's pane
in front, live — so the whole app is in the room at once.

- **Press a desk** and you walk over and sit at its computer: the monitor opens with the tab's real
  panes, where you type. "Stand up", Escape or a press on the floor closes it.
- **Drag a desk** by its body to move it anywhere on the floor; where you left it is kept across
  runs (`office.desks`). A drag that ends where it started is a press, so it opens the desk.
- **One agent a desk**: its pane's own name when it has one, else the tab's, over a seated sprite
  chosen by the desk itself — the same office every time.
- **A cup** for each pane past the first: a split desk. The screen shows the pane in front and a
  bubble over it says what its agent is doing.
- The **bar** along the foot: you, the session, New desk, the Bookshelf (the packages' panels),
  Settings (the coffee machine does that too), "a desk for every pane", the agents' counts and
  the clock.

## Playing it

- **Walk** with WASD or the arrow keys (you bump into desks and furniture), or click the floor and
  you walk there around everything. The camera follows you; the wheel looks around.
- **X** (or E, Enter, Space) uses what you stand by: sit at a desk, browse the bookshelf, coffee
  (Settings), the door mat (your sessions), and the furniture — play ping-pong or the arcade, flip
  the lamp or the TV, sink into the sofa. **1–5** are emotes. Click your face in the bar for another look.
- **Decorate** (in the bar) places furniture from the build panel, drags what is on the floor
  (× puts it away), and changes the floor, the wall paint and the lights (by the clock, or always
  day, evening or night). Everything is kept across runs (`office.furniture`, `office.floor`, …).
- Desks still drag anywhere; double-click one to rename it, right-click for its menu.

`bun tools/art.ts` redraws the furniture, floors and walls (`images/furniture`, `floors`, `walls`).

**A desk for every pane** (`desk_per_pane`, in Settings → Office, or the bar's button) gives each
pane of a split tab its own desk, agent and screen instead of one desk holding the whole tab.

`themes/office/plan.ts` decides where the pods and desks go (pods wrap onto the next row when the
floor runs out); `themes/office/window.tsx` draws the room. The panes inside a monitor are the
app's own layout (`C.Layout`), so they resize and even out as any tab's do.

## Working on it

```sh
bun scripts/link.mjs               # at the repository's root, once: links @pumid/types
./node_modules/.bin/tsc --noEmit   # the types
```

`src/` (the old theme's helpers) and the stylesheets went with the CSS renderer. The art in
`themes/office/images/` is the room's, as it was.
