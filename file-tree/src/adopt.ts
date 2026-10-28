// The window's side of a new view: what did not change keeps its object, so React's memo skips the
// rows that are as they were and a tick of the clock that found nothing draws nothing.
import type { View } from "./main.ts";
import type { Row } from "./row.ts";

/** A row as it was, when the new one says the same: the memoised rows it keys stay as they are. */
function sameRow(a: Row, b: Row): boolean {
  return (
    a.key === b.key &&
    a.kind === b.kind &&
    a.depth === b.depth &&
    a.open === b.open &&
    a.icon === b.icon &&
    a.text === b.text &&
    a.color === b.color &&
    a.selected === b.selected &&
    a.indent === b.indent &&
    a.path === b.path &&
    a.editing === b.editing &&
    a.actions.length === b.actions.length &&
    a.actions.every((action, i) => action === b.actions[i])
  );
}

/** The next view, keeping every row object of the last one that has not changed, so only the rows
 *  that did draw again; `null` (the clock found nothing new) keeps the view itself. */
export function adopt(had: View | undefined, next: View | null): View | undefined {
  if (next === null) return had;
  if (!had) return next;
  const old = new Map(had.rows.map((row) => [row.key, row]));
  let changed = had.rows.length !== next.rows.length;
  const rows = next.rows.map((row, i) => {
    const was = old.get(row.key);
    const kept = was && sameRow(was, row) ? was : row;
    if (kept !== had.rows[i]) changed = true;
    return kept;
  });
  return {
    ...next,
    rows: changed ? rows : had.rows,
    naming: had.naming && next.naming && had.naming.name === next.naming.name && had.naming.isDir === next.naming.isDir ? had.naming : next.naming,
  };
}
