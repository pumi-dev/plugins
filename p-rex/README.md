# P-Rex

A pumi UI theme in the terminals' own colours, a little see-through. Every colour comes from the
terminal palette (the color scheme picked in Settings → Appearance, or P-Rex's own neutral one),
so the side bar, the panes and the menus match whatever scheme is picked; the desktop shows
faintly through. The views are a list down the side, each pane holds its tabs in a strip along
its bar, and the panes are cards (Comfortable) or edge to edge with a line between (Compact).

- **The side bar** has the traffic lights and its two buttons on top: hide the side bar (⌘B) and
  a new view. Under them every session, with its views: each view on a tile of its own — its front
  tab's, an agent on warm paper with its mark (`π`), a terminal on slate with its green prompt
  (`>_`), a page with its globe — and, for a view of several tabs, a deck of cards behind the tile
  (as many as Settings → Appearance → Tab icons per view says). An agent's state is a dot in the
  tile's corner, and the window's front view is a pill. Two fingers swept left over the side bar
  hide it (Settings → Appearance). A click goes to a view, a double click renames it, a right click
  or the `…` (always on the front view, on the others while hovered) opens its menu; drag a tab
  from a pane onto a view's row to join it, or a view onto another to move it there. Sessions on
  another machine are listed under that machine.
- **The foot** of the side bar: on the left, a menu that switches its view (the list, or any
  plugin's `panel`: Project, Git, Scripts…) or hides it; on the right, a new session and a page in
  a new view (when `browser` is installed).
- **With the side bar hidden** the window's session's views run across the top, on a track beside
  the traffic lights, with the side bar's button and a new view at either end: the front view a
  pill whose `…` lists its tabs (what each agent is doing, its folder; a click goes to it). Views
  click, rename, drag and take dropped tabs as their rows do.
- **The panes** are the app's own layout (its splits and their edges, zoom, floats, drops), and a
  pane holds its tabs in a strip along its bar: the front one a pill, each with its mark, its name
  and a close, a right click for its menu. A tab drags along its strip, into another pane's, onto a
  side of a pane for one of its own, or onto a view's row in the side bar. The focused pane's
  buttons always show (split right, split down, zoom, close); another's show while the mouse is
  over it. Settings → Appearance → Panes turns on an outline for the focused pane, the focus
  following the mouse, even splits, and the panes' title bars.

Settings → P-Rex:

- **Pane style**: Comfortable (each pane a rounded card, room round it) or Compact (edge to edge).
- **Background opacity**: how much of the desktop shows through (88% by default).
- **Pane title bars**: whether each pane's bar shows its strip (a pane of several tabs keeps one
  whatever this says).
- **Tab icons per view**: how many of a view's tabs show on its tile before a count.
- **Mode**: night (the default), day, or the system's, when no terminal color scheme is picked.

It needs a pumi with `fromPalette`, a `layout` function and the window preferences in `pumi/theme`.
