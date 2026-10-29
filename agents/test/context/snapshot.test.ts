// The model: sessions, their views, panes and tabs, and what each tab says of itself — as the map
// reads it, and as `session.get` with `deep` carries it.
import { expect, test } from "bun:test";

import { panesIn, read, strip } from "../../src/context/snapshot.ts";
import { sessions } from "./fake.ts";

const snap = (here: number | null = 1) => read(sessions(), here);

test("every session, view, pane and tab comes back with what it says of itself", () => {
  const model = snap();
  expect(model.sessions.map((session) => [session.id, session.label, session.focused, session.views.length])).toEqual([
    [1, "pumi", true, 2],
    [2, "site", false, 1],
  ]);
  expect(model.views.map((view) => [view.id, view.session, view.name, view.focused, view.panes.length])).toEqual([
    [1, 1, "main", true, 2],
    [2, 1, "logs", false, 1],
    [3, 2, "", true, 1],
  ]);
  expect(model.panes.map((pane) => [pane.id, pane.session, pane.view, pane.index, pane.tabs.length])).toEqual([
    [4, 1, 1, 0, 1],
    [5, 1, 1, 1, 2],
    [6, 1, 2, 0, 1],
    [7, 2, 3, 0, 1],
  ]);
  expect(model.tabs.map((tab) => [tab.id, tab.session, tab.view, tab.pane, tab.index, tab.block])).toEqual([
    [10, 1, 1, 4, 0, "terminal"],
    [11, 1, 1, 5, 0, "terminal"],
    [12, 1, 1, 5, 1, "terminal"],
    [13, 1, 1, null, 0, "terminal"],
    [14, 1, 2, 6, 0, "terminal"],
    [20, 2, 3, 7, 0, "terminal"],
  ]);
});

test("a view's panes keep the layout's order, and a pane's tabs its strip's", () => {
  const given = sessions();
  const view = given[0]!.tree![0]!;
  // The layout splits into :5 then :4, and :5's strip puts the editor in front of the agent.
  view.layout = {
    axis: "row",
    ratio: 0.5,
    first: { pane: ":5", tabs: ["%12", "%11"], active: "%12" },
    second: { pane: ":4", tabs: ["%10"], active: "%10" },
  };
  const model = read(given, 1);
  expect(model.views[0]!.panes.map((pane) => pane.id)).toEqual([5, 4]);
  expect(model.views[0]!.panes[0]!.tabs.map((tab) => [tab.id, tab.index])).toEqual([
    [12, 0],
    [11, 1],
  ]);
});

test("a tab the layout does not name is still in its pane, after the ones it does", () => {
  const given = sessions();
  const view = given[0]!.tree![0]!;
  (view.layout as any).second.tabs = ["%11"];
  const model = read(given, 1);
  expect(model.views[0]!.panes[1]!.tabs.map((tab) => tab.id)).toEqual([11, 12]);
});

test("a float is in no pane, so it is beside the panes, not in one", () => {
  const view = snap().views[0]!;
  expect(view.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id))).toEqual([10, 11, 12]);
  expect(view.floating.map((tab) => [tab.id, tab.pane])).toEqual([[13, null]]);
});

test("what a tab's options say of it is read off the tab", () => {
  const agent = snap().tabs.find((tab) => tab.id === 11)!;
  expect([agent.agent, agent.status, agent.title, agent.stripped, agent.cwd]).toEqual([
    "claude",
    "working",
    "π - claude",
    "π - claude",
    "/Users/me/Kitchen/pumi",
  ]);
  const blocked = snap().tabs.find((tab) => tab.id === 20)!;
  expect([blocked.agent, blocked.status, blocked.program]).toEqual([
    "pi",
    "blocked",
    [{ id: "", state: "blocked", kind: "permission", msg: "Bash(npm publish)?" }],
  ]);
});

test("the tab in front of a pane says so, and the pane of its view that has the focus", () => {
  const model = snap();
  expect(model.views[0]!.panes.map((pane) => [pane.id, pane.focused, pane.zoomed])).toEqual([
    [4, false, false],
    [5, true, false],
  ]);
  expect(model.views[1]!.panes[0]).toMatchObject({ id: 6, focused: true, zoomed: true });
  expect(model.tabs.filter((tab) => tab.focused).map((tab) => tab.id)).toEqual([11]);
});

test("a layout of a pane and a split of two halves flatten in order", () => {
  expect(panesIn({ pane: ":9", tabs: ["%90"] })).toEqual([{ pane: 9, tabs: [90] }]);
  expect(
    panesIn({
      axis: "column",
      ratio: 0.3,
      first: { pane: ":1", tabs: ["%10"] },
      second: { axis: "row", ratio: 0.5, first: { pane: ":2", tabs: [] }, second: { pane: ":3", tabs: ["%30", "%31"] } },
    }),
  ).toEqual([
    { pane: 1, tabs: [10] },
    { pane: 2, tabs: [] },
    { pane: 3, tabs: [30, 31] },
  ]);
});

test("an empty model still reads", () => {
  expect(read([], null)).toEqual({ sessions: [], views: [], panes: [], tabs: [] });
});

test("a title loses the decoration a program puts round it", () => {
  expect(strip("⠋ claude")).toBe("claude");
  expect(strip("π - claude")).toBe("π - claude");
  expect(strip("  zsh ")).toBe("zsh");
});
