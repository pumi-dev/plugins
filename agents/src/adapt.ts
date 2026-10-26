// The window's own state, as the rows read it: the app's sessions, tabs and panes (the state hooks
// of `pumi`) mapped to what `tree.ts` and `status.ts` expect. It is the same shape `snapshot.ts`
// maps the server's model to, so a row reads the same whichever half of the package made the model.
import type { Pane, Session, Tab } from "pumi";

import { num } from "./ids.ts";
import { read, type Snapshot } from "./snapshot.ts";

/** What the window has, as its hooks give it: the models of the caller's own objects. */
export interface WindowState {
  sessions: Session[];
  tabs: Tab[];
  panes: Pane[];
  /** The session the window shows. */
  session?: Session;
  /** The tab in front of it. */
  tab?: Tab;
  /** The pane in front. */
  pane?: Pane;
}

/** What the window knows, as the model the rows read. */
export function fromWindow(window: WindowState): Snapshot {
  return read(given(window));
}

/** The window's sessions, tabs and panes, as the model is built from them. */
function given(window: WindowState) {
  const same = (a: { id: string } | undefined, b: { id: string } | undefined) => a !== undefined && b !== undefined && a.id === b.id;
  const label = (model: Pane) => {
    const named = model.options["@label"];
    return typeof named === "string" ? named : "";
  };

  return {
    spaces: window.sessions.map((each) => ({
      id: num(each.id),
      label: each.name,
      current: each.activeTab === null ? null : num(each.activeTab.id),
      focused: same(each, window.session),
    })),
    tabs: window.tabs.map((each) => ({
      id: num(each.id),
      space: num(each.session.id),
      // The window counts a session's tabs from 1; the model, as the server does, from 0.
      index: each.index - 1,
      label: each.name ?? "",
      focused: same(each, window.tab),
    })),
    panes: window.panes.map((each) => ({
      id: num(each.id),
      block: each.block,
      tab: each.tab === null ? null : num(each.tab.id),
      space: num(each.session.id),
      title: each.title ?? "",
      cwd: each.cwd ?? "",
      label: label(each),
      options: each.options,
      focused: same(each, window.pane),
    })),
  };
}
