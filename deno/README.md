# Deno

A pumi UI theme after the Rex app: one graphite window, a little see-through.

- **The side bar** has no fill or edge of its own. On top: the traffic lights, the side bar's
  toggle (⌘B), then the pane title bars' toggle (the eye), the command palette (⌘, when a palette
  plugin is installed) and a new view.
- **Sessions** are small grey headings with their views under them. Each view shows its front
  tab's dark tile (a terminal's green `>_`, or the tab's icon) and its name, with its folder when
  that is short (`zsh ~`). The window's front view is a pill. A click goes to a view, a double click
  renames it, a right click or the `…` on hover opens its menu, and views and tabs drag onto rows.
- **The foot** of the side bar: the side bar's views (the list, or any plugin's `panel`) on the
  left; a new session and a page (when a browser plugin is installed) on the right.
- **Panes** are cards a shade off the window, with a dark rim and a light bevel inside it, 6 px
  apart. The title bar shows the front tab's mark, name and folder (a strip of tabs when the pane
  holds several) and, on the focused pane or under the mouse: split right, split down, float, zoom
  and close. With the view's only pane, float and zoom are dimmed and do nothing, and close is dimmed.

**Colours.** With no terminal colour scheme picked, Deno is graphite. With one picked (Settings →
Appearance), the window takes the scheme's colours: the cards are its background, the words its
foreground, the accent and states its blue, yellow, red and green, and a light scheme draws a light
window.

**Settings → Deno → Window**: Background opacity (95% by default; 100 is opaque) and Background
blur (40 px by default).

Pick it with `pumi option set ui_theme deno`, or in Settings → Appearance.
