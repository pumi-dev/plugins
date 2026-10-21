// What herdr's socket keeps between messages: who subscribed to what, each pane's revision — what it
// has shown since herdr started watching, herdr's own counter, since no screen is kept here — and
// the model as of the last event translated, which is where an event that took something away is
// read from.
import type { Json } from "./types.ts";
import type { View } from "./view.ts";

/** An event as herdr's clients hear it: `{"event": snake, "data": {"type": snake, …}}`. */
export interface Envelope {
  event: string;
  data: Record<string, Json>;
}

/** What one subscriber asked for. */
export type Want =
  /** Every event of this snake name. */
  | { kind: "lifecycle"; snake: string }
  /** A pane's agent status changes, perhaps only to one status. */
  | { kind: "status"; paneId: string; status?: string };

function asks(want: Want, envelope: Envelope): boolean {
  if (want.kind === "lifecycle") return want.snake === envelope.event;
  if (envelope.event !== "pane.agent_status_changed") return false;
  if (envelope.data.pane_id !== want.paneId) return false;
  return want.status === undefined || envelope.data.agent_status === want.status;
}

/** Each connection that subscribed, and what it asked for, in the order they asked. */
const subscriptions = new Map<number, Want[]>();
const revisions = new Map<number, number>();
let last: View | undefined;

/** A connection's `events.subscribe`: herdr's events of these kinds go to it, and no others. */
export function subscribe(conn: number, wants: Want[]): void {
  subscriptions.delete(conn);
  subscriptions.set(conn, wants);
}

/** A connection went away: what it asked for goes with it. */
export function closed(conn: number): void {
  subscriptions.delete(conn);
}

/** Whether anyone is listening: without a subscriber no event is worth translating. */
export function subscribed(): boolean {
  return subscriptions.size > 0;
}

/** What a pane has shown since herdr started watching. */
export function revision(pane: number): number {
  return revisions.get(pane) ?? 0;
}

/** The pane changed: its revision moves on. */
export function bump(pane: number): void {
  revisions.set(pane, revision(pane) + 1);
}

/** The model as of the last event translated. */
export function view(): View | undefined {
  return last;
}

export function setView(now: View): void {
  last = now;
}

/** Who is to be sent which of these envelopes: one that cannot be reached is gone. */
export function publish(envelopes: Envelope[]): [number, Envelope][] {
  const out: [number, Envelope][] = [];
  for (const [conn, asked] of subscriptions) {
    for (const envelope of envelopes) {
      if (asked.some((want) => asks(want, envelope))) out.push([conn, envelope]);
    }
  }
  return out;
}
