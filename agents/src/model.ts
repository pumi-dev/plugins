// The snapshot every part of the package reads, kept fresh from the events that move it: one
// `server.getState` per batch, shared by the sidebar's page and by the functions that answer the
// guide and the map.
//
// The core plugin is pushed a snapshot with every change (`{type: "refresh"}`, src/store.rs
// `forward`). A package is not, so it does what the store does: read the model again, once, when
// something says it moved — and again on a slow clock, for what never said so.
import { on } from "pumi";

import { readState, EMPTY, type Snapshot } from "./snapshot.ts";

/** What the rows read; the events that change it, and the options among them. */
const EVENTS = [
  "pane.opened",
  "pane.closed",
  "pane.moved",
  "pane.focused",
  "pane.restored",
  "tab.opened",
  "tab.closed",
  "tab.moved",
  "tab.renamed",
  "tab.focused",
  "session.created",
  "session.closed",
  "session.renamed",
  "session.focused",
  "client.attached",
  "terminal.opened",
  "terminal.closed",
  "cwd.changed",
  "layout.changed",
] as const;

/** The options a row draws: an agent's state, its name, a pane's title, its label, its directory. */
const OPTIONS = ["@agent_status", "@program_status", "@agent", "@label", "title", "pane_current_path"];

/** How often the model is read even when nothing said it moved: a missed event, not a change. */
const TICK = 10_000;

let current: Snapshot = EMPTY;
const watchers = new Set<() => void>();
let loading: Promise<void> | null = null;
let behind = false;

/** The model as of the last read. */
export function snapshot(): Snapshot {
  return current;
}

/** Calls `fn` after every read that changed the model; returns the disposer. */
export function watch(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

/**
 * Reads the model again. A read asked for while one is in flight does not double it: one more
 * follows, with whatever moved in between.
 */
export function refresh(): Promise<void> {
  if (loading) {
    behind = true;
    return loading;
  }
  loading = (async () => {
    try {
      current = await readState();
      for (const fn of watchers) fn();
    } catch (err) {
      console.error("agents: reading the model threw:", err instanceof Error ? err.message : err);
    } finally {
      loading = null;
    }
    if (behind) {
      behind = false;
      await refresh();
    }
  })();
  return loading;
}

/** Subscribes to what moves the model, reads it once now, and keeps a slow clock on it. */
export function follow(): void {
  const reread = (what: string) => () => void refresh().catch(() => console.error(`agents: ${what} threw`));
  for (const event of EVENTS) on(event, { desc: "the agents sidebar follows the panes" }, reread(event));
  on("option.changed", { match: OPTIONS, desc: "the agents sidebar follows what panes say" }, () => void refresh());
  const clock = setInterval(() => void refresh(), TICK);
  clock.unref?.();
  void refresh();
}
