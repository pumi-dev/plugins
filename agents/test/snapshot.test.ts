// The snapshot: the model `server.getState` answers, mapped the way the app maps it for the core
// plugin (src/runtime/pumid/wire.rs).
import { expect, test } from "bun:test";

import { leaves, read, strip } from "../src/snapshot.ts";
import { state } from "./fake.ts";

test("every space, tab and pane comes back with what it says of itself", () => {
  const snap = read(state());
  expect(snap.spaces.map((space) => [space.id, space.label, space.tabs.length])).toEqual([
    [1, "pumi", 2],
    [2, "site", 1],
  ]);
  expect(snap.tabs.map((tab) => [tab.id, tab.space, tab.index, tab.label])).toEqual([
    [10, 1, 0, ""],
    [11, 1, 1, "editor"],
    [20, 2, 0, ""],
  ]);
  const agent = snap.panes.find((pane) => pane.id === 101)!;
  expect([agent.tab, agent.space, agent.agent, agent.status, agent.title, agent.stripped]).toEqual([
    11,
    1,
    "claude",
    "working",
    "π - claude",
    "π - claude",
  ]);
  expect(agent.cwd).toBe("/Users/me/Kitchen/pumi");
});

test("a tab's panes are in the order its layout lays them out", () => {
  const snap = read(state());
  expect(snap.tabs.find((tab) => tab.id === 11)!.panes.map((pane) => pane.id)).toEqual([101, 102]);
});

test("a float and a detached pane are not in a tab, so they are not in a space", () => {
  const snap = read(state());
  for (const id of [300, 301]) {
    const pane = snap.panes.find((each) => each.id === id)!;
    expect([pane.tab, pane.space]).toEqual([null, null]);
  }
});

test("what is in front is the model's current one", () => {
  const snap = read(state());
  expect(snap.focus).toEqual({ space: 1, tab: 11, pane: 101 });
  expect(snap.spaces.find((space) => space.id === 1)!.focused).toBe(true);
  expect(snap.spaces.find((space) => space.id === 2)!.focused).toBe(false);
  expect(snap.panes.filter((pane) => pane.focused).map((pane) => pane.id)).toEqual([101]);
});

test("`@label` is what the user named a pane, and `title` is untouched", () => {
  const model = state() as any;
  model.state.panes[1].options["@label"] = "the agent";
  const pane = read(model).panes.find((each) => each.id === 101)!;
  expect([pane.label, pane.title]).toEqual(["the agent", "π - claude"]);
});

test("a title loses the decoration a program puts round it", () => {
  expect(strip("π - pumi")).toBe("π - pumi");
  expect(strip("  pumi")).toBe("pumi");
  expect(strip("⠋ claude")).toBe("claude");
  expect(strip("✳ thinking")).toBe("thinking");
  expect(strip("yarn build")).toBe("yarn build");
});

test("a layout's leaves come out in order", () => {
  expect(leaves(["leaf", 3])).toEqual([3]);
  expect(leaves(["row", [["leaf", 1, 0.3], ["col", [["leaf", 2, 0.5], ["leaf", 3, 0.5]], 0.7]]])).toEqual([1, 2, 3]);
  expect(leaves(null)).toEqual([]);
});
