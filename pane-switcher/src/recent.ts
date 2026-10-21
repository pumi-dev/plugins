// The panes used lately, the most recent first: what `order = "recent"` sorts by. The switcher is
// momentary and reads this as it opens, so the first card is where you were and the next one is
// where you were before, as a task switcher does.
const seen: number[] = [];

/** How many panes it remembers. */
const KEEP = 64;

/** Remembers that `pane` is the one being used now. */
export function remember(pane: number | undefined): void {
  if (pane === undefined) return;
  const at = seen.indexOf(pane);
  if (at >= 0) seen.splice(at, 1);
  seen.unshift(pane);
  if (seen.length > KEEP) seen.length = KEEP;
}

/** The panes used lately, the most recent first. */
export function recently(): number[] {
  return [...seen];
}
