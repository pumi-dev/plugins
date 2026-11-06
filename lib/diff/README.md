# diff

A patch, read and drawn. `git` and `agent-chat` (through `lib/conversation`) share it. It is a
**library**: no view, command or option, so pumi never starts it. A package imports its files by
relative path (`../../lib/diff/src/ui.tsx`).

| File | |
| --- | --- |
| `src/patch.ts` | `parsePatch` (git's multi-file diffs or a bare `---`/`+++` patch → `FileDiff[]` with numbered `DiffRow`s), `patchItems`, `foldedAtFirst`, `diffRows`, `diffStats`, `tint` |
| `src/ui.tsx` | `PatchView` (a whole patch, windowed), `DiffView` (one file, for a card), `FileHead`, `DiffLine`, `Stats` |

Only `ui.tsx` imports `pumi`. It draws with `div` and `text` alone, in the theme's colours (a line
on a wash of `success` or `error`), and code in the terminal's font.

## Large changes

- **Reading** is one pass over the text: a million lines parse in about 200 ms. A line past
  `MAX_LINE` (2000) characters is cut, and says how much was left out.
- **Drawing**: `PatchView` is a `<virtual-list>` with `itemCount` and `windowStart`. Only the rows
  near the viewport, plus 60 on each side, are made, so 200,000 lines scroll like 20.
- **Folding**: lock files, minified files, source maps, and files over 3000 lines start folded when
  a patch has more than one file. Their heads still say how many lines they hold.

```sh
bun test
./node_modules/.bin/tsc --noEmit -p .
```
