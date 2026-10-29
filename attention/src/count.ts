// The rule attention follows, apart from the app: how many agents are waiting, and whether that is
// more than at the last look. `main.ts` reads the panes and says the notice; this decides what
// there is to say, so a test can decide too.

/** How many of the tabs say `blocked`. */
export function count(states: (string | null | undefined)[]): number {
  return states.filter((state) => state === "blocked").length;
}

/** What is said when `now` wait and `before` did: nothing unless more wait than before. */
export function said(before: number, now: number): string | null {
  if (now <= before) return null;
  return now === 1 ? "An agent is waiting for you" : `${now} agents are waiting for you`;
}
