// What an agent is doing, read the way the core sidebar reads it (core/agents/src/sidebar.rs):
// `@agent.status` is one word, and `@program_status` is every program's own report, of which the
// most urgent is the one that speaks for the pane. The words and marks are the theme's: `agent.…`
// tokens and `ui.stateMark`, which is what `pumi_core::card::lines` drew.
import type { Pane, Program, Snapshot } from "./snapshot.ts";

/** The states, most urgent first, as pumi ranks them (`blocked`, `error`, `done`, `working`, `idle`). */
export const STATES = ["blocked", "error", "done", "working", "idle", "unknown"] as const;
export type State = (typeof STATES)[number];

/** How urgent a state is: the order a list of panes sorts in. */
export function urgency(state: string): number {
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

/** Every record a pane reports, in its `@program_status`. */
function records(pane: Pane): Program[] {
  return pane.program;
}

/**
 * The program that speaks for a pane: the most urgent report, and between two the root's (`id` is
 * empty), so a sub-agent's block does not hide its own.
 */
export function program(pane: Pane): Program | undefined {
  let best: Program | undefined;
  for (const record of records(pane)) {
    if (!best) {
      best = record;
      continue;
    }
    const [mine, theirs] = [urgency(record.state), urgency(best.state)];
    if (mine > theirs || (mine === theirs && record.id === "" && best.id !== "")) best = record;
  }
  return best;
}

/** The word a pane goes by: `@agent.status`'s, with a `done` whose program failed read as `error`. */
export function state(pane: Pane): State {
  switch (pane.status) {
    case "working":
      return "working";
    case "blocked":
      return "blocked";
    case "error":
      return "error";
    case "done":
      return program(pane)?.state === "error" ? "error" : "done";
    case "idle":
      return "idle";
    default:
      return "unknown";
  }
}

/** The state a row draws as its mark and word: the quiet ones say nothing. */
export function shown(pane: Pane): State | "" {
  const word = state(pane);
  return word === "idle" || word === "unknown" ? "" : word;
}

/** Why a pane waits for the user, from the record that says so. */
export function reason(word: State, said: Program | undefined): string {
  const kind = said && said.state === word ? said.kind : undefined;
  switch (`${word}:${kind ?? ""}`) {
    case "blocked:permission":
      return "needs permission";
    case "blocked:question":
      return "has a question";
    case "blocked:auth":
      return "needs a login";
    case "error:":
      return "failed";
    default:
      return word === "blocked" ? "waiting on you" : word === "error" ? "failed" : "";
  }
}

/** The word a state goes by on a card, or `""` for the states that say nothing (`idle`). */
export function word(word: State): string {
  return word === "idle" || word === "unknown" ? "" : word;
}

/** The states drawn bold: the ones that want reading. */
export function bold(word: State): boolean {
  return word === "blocked" || word === "error" || word === "done";
}

/** What a folded tab's badges say of its panes: a dot a pane, in its state's own mark. */
export function badge(pane: Pane): State {
  const word = state(pane);
  return word === "unknown" ? "idle" : word;
}

/** Whether a pane is an agent: its tab's own view says so, or it named itself, or it reports. */
export function isAgent(pane: Pane): boolean {
  return pane.agent !== "" || pane.status !== "" || pane.program.length > 0;
}

/** The panes that want the user: blocked first, then failed. */
export function waiting(snapshot: Snapshot): { pane: Pane; state: State }[] {
  const out: { pane: Pane; state: State }[] = [];
  for (const pane of snapshot.panes) {
    if (pane.tab === null) continue;
    const word = state(pane);
    if (word === "blocked" || word === "error") out.push({ pane, state: word });
  }
  return out.sort((a, b) => Number(a.state !== "blocked") - Number(b.state !== "blocked"));
}
