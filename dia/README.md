# Dia

A pumi UI theme after the Dia browser: one frosted sidebar of pinned tiles, folders and tabs, and
the panes on a card beside it.

The sidebar is the whole chrome. The packages' panel views are pinned as tiles at its top (a press
shows one where the tabs were), your sessions are folders, and this session's tabs are rows — a
split tab shows its panes side by side in its row, each one a press away. Under them, the agents'
counts and the session's path. The panes sit on one rounded card beside it, under a quiet toolbar;
each pane has a strip with its title, its splits and its close, and the edge between two panes
drags.

Settings → Appearance shows it; its colours are its own, light and dark.

## What it draws

`themes/dia/theme.tsx` is the theme: its colours, metrics and the parts it replaces — `Window`,
`Layout`, `Pane`, `Starting`. `themes/dia/window.tsx` is those parts.

- **Panes resize.** Drag the edge between two of them: the ratio follows, and the server has it
  when the drag ends (`useSplitDrag`).
- **Panes even out.** When one opens or closes, the tab is laid out again with even shares
  (tmux's `equalalways`, which the theme owns now — `equalize` + `setLayout`).
- **A pane's strip** has its terminal's title, split right, split down, zoom (double-pressing the
  strip zooms too) and close.

## Working on it

```sh
bun scripts/link.mjs               # at the repository's root, once: links @pumid/types
./node_modules/.bin/tsc --noEmit   # the types
```

`src/` (copies of the default theme's parts) and the stylesheets went with the CSS renderer: a
`theme.tsx` replaces parts by name now.
