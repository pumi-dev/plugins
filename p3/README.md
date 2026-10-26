# P3

A pumi UI theme after [T3 Code](https://t3.codes): flat graphite, no cards, little chrome.

- **The side bar** is a shade lighter than the panes. On top, the traffic lights, the button that
  hides it (⌘B) and the wordmark; under them a search row (the command palette, when `palette` is
  installed) with a new session and a new tab beside it.
- **Threads**: every tab of every session, one list. Each shows its project's tag and name (its
  session's), an agent's state on the right, its title, and what is in it (each pane's glyph) with
  its worktree. The window's front tab is lit. A click goes to it, a double click renames it, a
  right click or the `…` on hover opens its menu (the tab's, its focused pane's, its session's);
  drag it onto a pane to join that tab, or drop a pane on it to move the pane there.
- **The foot** has the settings (⌘,) and what plugins put in the status bar.
- **Over the panes**, a breadcrumb: project / thread, with the title bar's plugin buttons, the pane
  titles' toggle, split right, and the surfaces' toggle.
- **Surfaces**, on the right (⌘⌥B, or View → Surfaces), as T3 Code's: "Open a surface" lists a
  page (when `browser` is installed), a terminal beside the focused pane, and every plugin's
  `panel` view; pick one and it fills the dock, the arrow goes back to the list. Both docks drag
  wider at their inner edge (a double press gives back their size).
- **The panes** sit edge to edge in the app's own layout, a hairline between them. Menus list keys
  in small chips.

Settings → P3 → Mode picks dark (the default), light, or the system's.
