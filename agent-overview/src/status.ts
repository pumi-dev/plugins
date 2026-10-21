// What a program says it is doing (OSC 7501, docs/v2/23 §6): the five states of the protocol, and
// `unknown` for a pane nothing has reported. And the four ways the rail narrows the list by them.

/** What a program says it is doing; `unknown` is a pane nothing has reported on. */
export type Status = "blocked" | "error" | "working" | "done" | "idle" | "unknown";

/** The statuses a program reports, in the order the legend reads them. */
export const STATUSES: readonly Exclude<Status, "unknown">[] = ["working", "blocked", "error", "done", "idle"];

/** The status `word` names, or null for anything else. */
export function parseStatus(word: unknown): Status | null {
  return STATUSES.includes(word as Exclude<Status, "unknown">) ? (word as Status) : null;
}

/** What a card calls it. */
export function statusLabel(status: Status): string {
  switch (status) {
    case "blocked":
      return "Blocked";
    case "error":
      return "Failed";
    case "working":
      return "Working";
    case "done":
      return "Done";
    case "idle":
      return "Idle";
    case "unknown":
      return "Unknown";
  }
}

/** Lower wants the user sooner: the order the table and the rail sort in. */
export function rank(status: Status): number {
  switch (status) {
    case "blocked":
      return 0;
    case "error":
      return 1;
    case "working":
      return 2;
    case "done":
      return 3;
    case "idle":
      return 4;
    case "unknown":
      return 5;
  }
}

/** Blocked and failed: the agents that will not go on without the user. */
export function needsYou(status: Status): boolean {
  return status === "blocked" || status === "error";
}

/** Which agents the rail and the table show. */
export const FILTERS = ["all", "needs-you", "working", "idle"] as const;
export type Filter = (typeof FILTERS)[number];

/** What its row in the rail says. */
export function filterLabel(filter: Filter): string {
  switch (filter) {
    case "all":
      return "Overview";
    case "needs-you":
      return "Needs you";
    case "working":
      return "Working";
    case "idle":
      return "Idle";
  }
}

/** Whether `status` is one the filter shows. */
export function filterMatches(filter: Filter, status: Status): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs-you":
      return needsYou(status);
    case "working":
      return status === "working";
    case "idle":
      return status === "idle" || status === "done";
  }
}
