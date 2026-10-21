// herdr's events, as a table: the dotted name a subscription asks for, the snake name an envelope
// carries (`{"event": "pane_created", "data": {"type": "pane_created", …}}`), and how a
// subscription to it behaves.
//
// PROVENANCE: herdr `src/api/schema/events.rs` (`EventKind`, `Subscription`,
// `SubscriptionEventKind`) @ v0.9.3 (Apache-2.0).

export type Delivery =
  /** Every occurrence goes to every subscriber of the name. */
  | "lifecycle"
  /** A per-pane subscription with its own parameters (`pane_id`, …) and its own envelope
   * (`{"event": "pane.agent_status_changed", "data": …}`, dotted, untagged data). */
  | "per_pane"
  /** Only `events.wait` matches it; no subscription names it. */
  | "wait_only";

export interface Event {
  dotted: string;
  snake: string;
  delivery: Delivery;
}

function lifecycle(dotted: string): Event {
  return { dotted, snake: dotted.replaceAll(".", "_"), delivery: "lifecycle" };
}

export const EVENTS: Event[] = [
  lifecycle("workspace.created"),
  lifecycle("workspace.updated"),
  lifecycle("workspace.metadata_updated"),
  lifecycle("workspace.renamed"),
  lifecycle("workspace.moved"),
  lifecycle("workspace.reordered"),
  lifecycle("workspace.closed"),
  lifecycle("workspace.focused"),
  lifecycle("worktree.created"),
  lifecycle("worktree.opened"),
  lifecycle("worktree.removed"),
  lifecycle("tab.created"),
  lifecycle("tab.closed"),
  lifecycle("tab.focused"),
  lifecycle("tab.renamed"),
  lifecycle("tab.moved"),
  lifecycle("pane.created"),
  lifecycle("pane.closed"),
  lifecycle("pane.updated"),
  lifecycle("pane.focused"),
  lifecycle("pane.moved"),
  lifecycle("pane.exited"),
  lifecycle("pane.agent_detected"),
  lifecycle("layout.updated"),
  { dotted: "pane.output_changed", snake: "pane_output_changed", delivery: "wait_only" },
  { dotted: "pane.agent_status_changed", snake: "pane_agent_status_changed", delivery: "per_pane" },
  { dotted: "pane.output_matched", snake: "pane_output_matched", delivery: "per_pane" },
  { dotted: "pane.scroll_changed", snake: "pane_scroll_changed", delivery: "per_pane" },
];

export function byDotted(name: string): Event | undefined {
  return EVENTS.find((event) => event.dotted === name);
}

export function bySnake(name: string): Event | undefined {
  return EVENTS.find((event) => event.snake === name);
}

/** The dotted or snake name, either way round. */
export function find(name: string): Event | undefined {
  return byDotted(name) ?? bySnake(name);
}
