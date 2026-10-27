# P3

A pumi UI theme after [T3 Code](https://t3.codes): flat graphite, no cards, little chrome.

- **The side bar** is a shade lighter than the panes. On top, the traffic lights, the button that
  hides it (⌘B) and the wordmark; under them a search row (the command palette, when `palette` is
  installed) with a new session and a new view beside it.
- **Threads**: every view of every session, one list. Each shows its project's tag and name (its
  session's), an agent's state on the right, its title, and what is in it (each of its tabs'
  glyphs) with its worktree. The window's front view is lit. A click goes to it, a double click
  renames it, a right click or the `…` on hover opens its menu (the view's, its front tab's, its
  session's); drag it to move it among its session's views or to another session, or drop a tab on
  it to move the tab into it.
- **The foot** has the settings (⌘,), and beside them what plugins put at the side bar's foot.
- **Over the panes**, a breadcrumb: project / thread, with the pane titles' toggle, split right,
  and the surfaces' toggle.
- **Surfaces**, on the right (⌘⌥B, or View → Surfaces), as T3 Code's: "Open a surface" lists a
  page (when `browser` is installed), a terminal beside the focused pane, and every plugin's
  `panel` component; pick one and it fills the dock, the arrow goes back to the list. Both docks drag
  wider at their inner edge (a double press gives back their size).
- **The panes** sit edge to edge in the app's own layout, a hairline between them, each pane's tabs
  in a flat strip over it. Menus list keys in small chips.

Settings → P3 → Mode picks dark (the default), light, or the system's.
