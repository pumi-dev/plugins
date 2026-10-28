// How wide a column is: what its contents ask for, and how those widths share the room a pane
// has. Pure, so the numbers are tested without drawing anything.

/** How tall a row is, and the header above them: drawn with the app's font, not measured. */
export const ROW = 26;
export const HEADER = 30;
/** The narrowest a column is drawn, and the widest its contents can ask for. */
export const MIN_COLUMN = 56;
export const MAX_COLUMN = 360;
/** A character at the app's font size (13), near enough to lay a column out. */
const CHAR = 7.2;
/** A cell's padding, left and right, and the room a sorted column's arrow takes. */
const CELL_PAD = 18;
const ARROW = 14;
/** How many rows a column's width is measured from. */
const SAMPLE = 200;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/**
 * What each column asks for: its longest value, the header among them, as px. A number column
 * gets room for its arrow, and nothing is narrower than `MIN_COLUMN` or wider than `MAX_COLUMN`.
 */
export function naturalWidths(headers: string[], rows: string[][], numeric: boolean[]): number[] {
  return headers.map((header, column) => {
    let longest = Math.min(header.length, 80);
    const until = Math.min(rows.length, SAMPLE);
    for (let i = 0; i < until; i++) {
      const length = (rows[i]![column] ?? "").length;
      if (length > longest) longest = Math.min(length, 80);
    }
    return clamp(Math.round(CELL_PAD + longest * CHAR + (numeric[column] ? ARROW : 0)), MIN_COLUMN, MAX_COLUMN);
  });
}

/** `sizes` scaled to add up to exactly `total`, each rounded to a whole px and the remainder
 *  handed to the columns that were rounded down furthest, so the sum is exact. */
function exact(sizes: number[], total: number): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum <= 0 || sizes.length === 0) return sizes.map(() => Math.floor(total / Math.max(1, sizes.length)));
  const scale = total / sum;
  const dirty = sizes.map((size) => size * scale);
  const widths = dirty.map((value) => Math.floor(value));
  let left = Math.round(total) - widths.reduce((a, b) => a + b, 0);
  // Hand out what rounding lost, a px at a time, to the largest fractions first.
  const order = dirty.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) widths[order[i]!.index]! += 1;
  return widths;
}

/** What a table's columns are drawn at: the widths, their sum, and whether they are too many to fit. */
export interface Plan {
  widths: number[];
  total: number;
  /** True when even the narrowest columns are wider than the room: the table scrolls sideways. */
  overflow: boolean;
}

export interface PlanOptions {
  /** The narrowest a column is squeezed to, when `fit` shares the pane's room out. */
  min?: number;
  /** Share the pane's room out between the columns — squeezing them to `min` if need be — instead
   *  of keeping the widths their contents ask for and letting the table be wider than the pane. */
  fit?: boolean;
}

/**
 * `natural` widths in `available` px. Room to spare is always shared out in proportion, so a table
 * of three columns fills the pane instead of hugging one corner. Too little room: with `fit` the
 * columns give width back the same way, down to `min` a column; without it they keep the width
 * their contents ask for and the table is wider than the pane, which scrolls sideways.
 */
export function planWidths(natural: number[], available: number, opts: PlanOptions = {}): Plan {
  const { min = MIN_COLUMN, fit = false } = opts;
  const n = natural.length;
  if (n === 0) return { widths: [], total: 0, overflow: false };
  const room = Math.max(0, Math.floor(available));
  const naturalSum = natural.reduce((a, b) => a + b, 0);
  if (naturalSum <= room) {
    const widths = exact(natural, room);
    return { widths, total: widths.reduce((a, b) => a + b, 0), overflow: false };
  }
  const floor = min * n;
  if (fit && floor <= room) {
    // Every column keeps `min`, and what is left over is shared by how much more each one asked for.
    const extra = natural.map((size) => Math.max(0, size - min));
    const extraSum = extra.reduce((a, b) => a + b, 0);
    const asked = extraSum > 0 ? extra.map((size) => min + (size / extraSum) * (room - floor)) : natural.map(() => room / n);
    const widths = exact(asked, room);
    return { widths, total: widths.reduce((a, b) => a + b, 0), overflow: false };
  }
  const widths = natural.map((size) => Math.max(size, min));
  return { widths, total: widths.reduce((a, b) => a + b, 0), overflow: true };
}

/**
 * `widths` with the divider after column `index` dragged by `delta` px: the column takes from its
 * right neighbour (or gives to it), neither going under `min`. The total is unchanged.
 */
export function resizeWidths(widths: number[], index: number, delta: number, min = MIN_COLUMN): number[] {
  if (index < 0 || index + 1 >= widths.length) return widths;
  const left = widths[index]!;
  const right = widths[index + 1]!;
  // As far as the drag can go before either column is under its minimum.
  const move = Math.round(Math.max(min - left, Math.min(right - min, delta)));
  if (move === 0) return widths;
  const next = widths.slice();
  next[index] = left + move;
  next[index + 1] = right - move;
  return next;
}

/** A count as the table says it: `1,204`. */
export function count(n: number): string {
  return n.toLocaleString();
}

/** An amount of memory as the table says it: `912 B`, `41 KB`, `2.4 MB`. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
