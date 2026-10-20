# csv

A CSV file in a pumi tab, as a table: sort by a column, search across every cell, drag a divider to
make a column wider, press a cell to read all of it and copy it. It draws with
[TanStack Table](https://tanstack.com/table) — the columns, the sorting, the filtering and the row
model are its work; the drawing is the app's.

The plugin is a viewer, not a spreadsheet: it reads and never writes.

```sh
pumi plugin add ./csv                   # from this repository's root
pumi open data.csv                      # a file tab on the right, drawn as a table
pumi call amresyd.csv.open              # or choose a file in a picker
pumi call amresyd.csv.reload %7         # read the file tab %7 shows again
```

Its manifest's `renderers.file` claims `*.csv`, `*.tsv`, `*.tab`, `*.psv` and `*.dsv`, so a file with
one of those extensions opened anywhere — `pumi open`, the project tree, the palette, an agent —
is drawn here. A viewer that fits a file better (a glob in its own `match` with more literal
characters) draws it instead, and `pumi registry list viewer --path data.csv` says who would.

## What it does

- **The separator is guessed** from the first fifty records: which candidate splits them the same
  way, commas inside quotes not counted. The extension settles a tie (`.tsv` is tabs), and
  `Delimiter` in Settings settles it for good.
- **The header is guessed** too: the first record is names when it has no blanks, no repeats, and no
  numbers while a column under it does. `Header row` in Settings says `The first row` or
  `None: number every row`.
- **Sorting** is by a press on a column's name: up, down, then off; shift adds a column to the sort,
  and the footer says what it is. A column whose values are mostly numbers sorts as numbers, so
  `9` comes before `10`.
- **Searching** keeps the rows that hold every word typed, in any cell.
- **Columns are as wide as their contents ask**, the way a spreadsheet is: a table wider than its
  pane scrolls sideways rather than squeezing every column. Room to spare is shared out, so a small
  table still fills the pane. The **scroll / fit** button in the table's bar flips it — `fit`
  squeezes the columns into the pane's width instead — and `Column widths` in Settings is the same
  switch, kept.
- **Rows are windowed** with the app's `<virtual-list>`: only those near the viewport are made, so a
  file of a hundred thousand rows draws as fast as one of ten.
- **The file is followed**: a script that rewrites it makes the table read it again, and every tab
  showing the same file follows. `Follow the file` turns that off; the title bar's ↺ and
  `CSV: read the file again` do it by hand.
- **A cell is copied** from the line at the bottom: press it, and its whole value is on the
  clipboard, however narrow its column is.
- **Records are padded**: a row with fewer fields than the table has is filled with empties, and the
  footer says how many were not the same width. Rows past `Rows at most` are counted and left out,
  and it says so.

## Options

Settings → CSV, on a page of its own:

| Option | |
| --- | --- |
| Header row | Guess, the first row, or none |
| Delimiter | Guess, comma, tab, semicolon, pipe |
| Right-align numbers | A column of numbers lines up on the right, and sorts as numbers |
| Striped rows | Tint every other row |
| Column widths | As wide as they need (scrolling sideways), or squeezed to the pane's width |
| Follow the file | Read it again when it is rewritten |
| Rows at most | 100,000 by default; the rest are counted, not drawn |

## How it is put together

```text
src/parse.ts     the text as a table: the separator, the header, the records, what each column
                 holds. Pure — no node, no pumi — and what `test/parse.test.ts` tests.
src/layout.ts    how wide a column is and how the widths share a pane. Pure, and tested.
src/main.ts      the worker: reads the file, watches it, says when it changed. The disk is here.
src/ui.tsx       the file tab's renderer: TanStack Table's state, the search bar, the footer.
src/ui/grid.tsx  the header (a sort, a divider drag) and the rows (windowed).
```

`bun test` and `./node_modules/.bin/tsc --noEmit -p .` run here with nothing of the app running;
the types need `bun install` first, for `@tanstack/react-table`.

The table is `@tanstack/react-table`'s: `useReactTable` over one row per record, a column per field,
`getCoreRowModel`, `getSortedRowModel` and `getFilteredRowModel`. It is headless, which is what the
window's renderer needs: the cells are the app's `<text>` in `<div>`s, and the sorting arrows, the
dividers and the picked cell are drawn in the theme's colours.
