# marmaide, from the inside

A pumi plugin: `package.json`'s `pumi` key is the manifest, `src/main.ts` runs in a worker,
`src/ui.tsx` draws in the window. See `../AGENTS.md` for the API; this file is only what is
peculiar here.

- `src/main.ts` — the functions `draw` and `render`, and `drawn(tab, theme)`, which the view calls.
  The block is `pumi_dev.marmaide.diagram`; the tab option a diagram lives in is
  `pumi_dev.marmaide.source`.
- `src/ui.tsx` — `Diagram({tab, block})`: asks the worker for the tab's picture, again when the
  tab's `source` option or the theme changes, and draws the SVG fitted to the tab.
- `src/pele.ts`, `src/palette.ts` — pure: Pele's SVG, and the theme written into it as Pele's
  variables. `themed()` exists because usvg (the app's SVG painter) knows no CSS custom properties.
  Pele is the npm package `pele`, installed by `bun install`.
- `src/picture.ts` — draws and dresses: Pele's SVG with the theme's colours written into it. The
  view hands that markup to the window's `<svg paint="image">`, which rasterises it at the size on
  screen; nothing is written to disk.

Tests are on the pure modules only (`bun test`): Pele's output, the theming, the palette.
