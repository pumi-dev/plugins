# P-Rex

A pumi UI theme: frosted violet glass. The desktop shows through a wash of plum, indigo and
magenta (the system's blur under it), the tabs are a list down the side, and every pane is a dark
card of its own with its title bar inside.

- **The side bar** has the traffic lights and the window's buttons on top: hide the side bar
  (⌘B), show or hide the panes' title bars (the eye), the command palette (⌘, when `palette` is
  installed) and a new tab. Under them every session, with its tabs: each tab on its program's
  tile (an agent's mark, a terminal's prompt, a page's globe), an agent's state as a dot in the
  tile's corner, the window's front tab as a pill. A click goes to a tab, a double click renames
  it, a right click or the `…` (always on the front tab, on the others while hovered) opens its
  menu; drag a tab onto a pane to join it, or a pane's title bar onto a tab to move the pane
  there. Sessions on another machine are listed under that machine.
- **The foot** of the side bar: on the left, a menu that switches its view (the tabs, or any
  plugin's `panel`: Project, Git, Scripts…) or hides it; on the right, a card of what plugins put
  in the status bar (usage meters and their actions), a new session, and a page in a new tab (when
  `browser` is installed).
- **With the side bar hidden** the window's session's tabs run across the top, on a track beside
  the traffic lights: the front tab a pill whose `…` lists its panes (what each agent is doing, its
  folder; a click goes to it). Tabs click, rename, drag and take dropped panes as their rows do.
- **The panes** are the app's own layout (its splits and their edges, zoom, floats, drops), each
  pane drawn as a card. The focused pane's buttons always show (split right, split down, zoom,
  close); another's show while the mouse is over it.

Settings → P-Rex → Mode picks night (the default), day, or the system's.
