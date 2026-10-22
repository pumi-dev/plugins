// The window's snapshot, as the rows read it: the app's own state mapped to what `tree.ts` and
// `status.ts` expect — numeric ids, as the API has them, and one record per space, tab and pane.
// It is the shape `snapshot.ts` maps the server's model to, so a row reads the same whichever half
// of the package made the model.
import { num, type Snapshot as Window, type Tree } from "pumi";

import { programs, strip, type Pane, type Snapshot } from "./snapshot.ts";

/** The panes of a tab's layout, in the order it lays them out. */
export function laidOut(tree: Tree | undefined): number[] {
  if (!tree) return [];
  if ("pane" in tree) return [num(tree.pane)];
  if ("app" in tree) return [];
  return [...laidOut(tree.first), ...laidOut(tree.second)];
}

/** What the window knows, as the model the rows read. */
export function read(app: Window | undefined, trees: Record<string, Tree>): Snapshot {
  if (!app) return { spaces: [], tabs: [], panes: [], focus: { space: null, tab: null, pane: null } };
  const focus = {
    space: app.focused_workspace_id ? num(app.focused_workspace_id) : null,
    tab: app.focused_tab_id ? num(app.focused_tab_id) : null,
    pane: app.focused_pane_id ? num(app.focused_pane_id) : null,
  };
  /** The space a tab is in, and where in it. */
  const spaceOf = new Map(app.tabs.map((tab) => [tab.tab_id, tab.workspace_id]));
  const inTab = new Map<string, Pane[]>();

  const panes: Pane[] = app.panes.map((each) => {
    const title = each.terminal_title ?? "";
    const kind = each.kind === "web" || each.kind === "browser" ? "web" : each.kind;
    const pane: Pane = {
      id: num(each.pane_id),
      tab: each.tab_id ? num(each.tab_id) : null,
      space: each.workspace_id ? num(each.workspace_id) : null,
      kind: kind === "terminal" ? "terminal" : kind,
      title,
      stripped: strip(title),
      cwd: each.cwd ?? "",
      label: each.label ?? "",
      agent: each.agent ?? "",
      status: each.agent_status ?? "",
      program: programs((each.options ?? {})["@program_status"]),
      focused: each.pane_id === app.focused_pane_id,
    };
    if (each.tab_id) inTab.set(each.tab_id, [...(inTab.get(each.tab_id) ?? []), pane]);
    return pane;
  });

  // A tab's panes as its layout says, then any it keeps but does not lay out.
  for (const [tab, list] of inTab) {
    const order = laidOut(trees[tab]);
    const rank = (pane: Pane) => {
      const at = order.indexOf(pane.id);
      return at === -1 ? order.length : at;
    };
    list.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  }

  const tabs = app.tabs
    .map((each) => ({
      id: num(each.tab_id),
      space: num(each.workspace_id),
      index: each.number,
      label: each.label ?? "",
      panes: inTab.get(each.tab_id) ?? [],
      focused: each.tab_id === app.focused_tab_id,
    }))
    .sort((a, b) => a.space - b.space || a.index - b.index);

  const spaces = app.workspaces
    .map((each) => ({
      id: num(each.workspace_id),
      label: each.label ?? "",
      current: each.active_tab_id ? num(each.active_tab_id) : null,
      focused: each.workspace_id === app.focused_workspace_id,
      tabs: tabs.filter((tab) => tab.space === num(each.workspace_id)),
    }))
    .sort((a, b) => a.id - b.id);

  return { spaces, tabs, panes, focus };
}

/** The space a tab is in, as the app says it (the model above keeps it on the tab). */
export function spaceOfTab(app: Window | undefined, tab: number): number | null {
  const found = app?.tabs.find((each) => num(each.tab_id) === tab);
  return found ? num(found.workspace_id) : null;
}
