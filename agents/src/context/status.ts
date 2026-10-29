// What an agent is doing, read the way pumi does: `@status` is one word, and
// `@program_status` is every program's own report, of which the most urgent is the one that speaks
// for the tab. All that is drawn of it is in the map, as a word after the tab's title.
import type { Program, Tab } from "./snapshot.ts";

/** The states, most urgent first, as pumi ranks them (`blocked`, `error`, `done`, `working`, `idle`). */
export const STATES = ["blocked", "error", "done", "working", "idle", "unknown"] as const;
export type State = (typeof STATES)[number];

/** How urgent a state is: the order a list of tabs sorts in. */
function urgency(state: string): number {
  switch (state) {
    case "blocked":
      return 4;
    case "error":
      return 3;
    case "done":
      return 2;
    case "working":
      return 1;
    default:
      return 0;
  }
}

/**
 * The program that speaks for a tab: the most urgent report, and between two the root's (`id` is
 * empty), so a sub-agent's block does not hide its own.
 */
export function program(tab: Tab): Program | undefined {
  let best: Program | undefined;
  for (const record of tab.program) {
    if (!best) {
      best = record;
      continue;
    }
    const [mine, theirs] = [urgency(record.state), urgency(best.state)];
    if (mine > theirs || (mine === theirs && record.id === "" && best.id !== "")) best = record;
  }
  return best;
}

/** The word a tab goes by: `@status`'s, with a `done` whose program failed read as `error`. */
export function state(tab: Tab): State {
  switch (tab.status) {
    case "working":
      return "working";
    case "blocked":
      return "blocked";
    case "error":
      return "error";
    case "done":
      return program(tab)?.state === "error" ? "error" : "done";
    case "idle":
      return "idle";
    default:
      return "unknown";
  }
}

/** The state the map says after a tab: the quiet ones say nothing. */
export function shown(tab: Tab): State | "" {
  const word = state(tab);
  return word === "idle" || word === "unknown" ? "" : word;
}
