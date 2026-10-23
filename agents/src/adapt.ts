// The window's own state, as the rows read it: the app's sessions, tabs and panes (the state hooks
// of `pumi`) mapped to what `tree.ts` and `status.ts` expect. It is the same shape `snapshot.ts`
// maps the server's model to, so a row reads the same whichever half of the package made the model.
import type { WindowPane, WindowSession, WindowTab } from "pumi";

import { read, type Snapshot } from "./snapshot.ts";

/** What the window has, as its hooks give it. */
export interface WindowState {
  sessions: WindowSession[];
  tabs: WindowTab[];
  panes: WindowPane[];
  /** The session the window shows. */
  session?: WindowSession;
  /** The tab in front of it. */
  tab?: WindowTab;
  /** The pane in front. */
  pane?: WindowPane;
}

/** What the window knows, as the model the rows read. */
export function fromWindow(window: WindowState): Snapshot {
  return read(given(window));
}

/** The window's sessions, tabs and panes, as the model is built from them. */
function given(window: WindowState) {
  const same = (a: { id: number; server?: string } | undefined, b: { id: number; server?: string } | undefined) =>
    a !== undefined && b !== undefined && a.id === b.id && a.server === b.server;

  return {
    spaces: window.sessions.map((each) => ({
      id: each.id,
      label: each.name,
      current: each.tab ?? null,
      focused: same(each, window.session),
    })),
    tabs: window.tabs.map((each) => ({
      id: each.id,
      space: each.session,
      // The window counts a session's tabs from 1; the model, as the server does, from 0.
      index: each.index - 1,
      label: each.name,
      focused: same(each, window.tab),
    })),
    panes: window.panes.map((each) => ({
      id: each.id,
      block: each.block,
      tab: each.tab ?? null,
      space: each.session ?? null,
      title: each.title ?? "",
      cwd: each.cwd ?? "",
      label: each.label ?? "",
      options: each.options,
      focused: same(each, window.pane),
    })),
  };
}
