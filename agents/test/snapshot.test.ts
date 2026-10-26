// The model: sessions, tabs and panes, and what each pane says of itself — as the map reads it.
import { expect, test } from "bun:test";

import { read, strip } from "../src/snapshot.ts";
import { state } from "./fake.ts";

test("every space, tab and pane comes back with what it says of itself", () => {
  const snap = read(state());
  expect(snap.spaces.map((space) => [space.id, space.label, space.tabs.length])).toEqual([
    [1, "pumi", 2],
    [2, "site", 1],
  ]);
  expect(snap.tabs.map((tab) => [tab.id, tab.space, tab.index, tab.label])).toEqual([
    [10, 1, 0, "Tab 1"],
    [11, 1, 1, "editor"],
    [20, 2, 0, "Tab 1"],
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

test("a tab's panes keep the order they are given in", () => {
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

test("the session in front is the one that says it is", () => {
  const snap = read(state());
  expect(snap.spaces.find((space) => space.id === 1)!.focused).toBe(true);
  expect(snap.spaces.find((space) => space.id === 2)!.focused).toBe(false);
});

test("`@label` is what the user named a pane, and `title` is untouched", () => {
  const given = state();
  given.panes[1]!.label = "the agent";
  const pane = read(given).panes.find((each) => each.id === 101)!;
  expect([pane.label, pane.title]).toEqual(["the agent", "π - claude"]);
});

test("a title loses the decoration a program puts round it", () => {
  expect(strip("π - pumi")).toBe("π - pumi");
  expect(strip("  pumi")).toBe("pumi");
  expect(strip("⠋ claude")).toBe("claude");
  expect(strip("✳ thinking")).toBe("thinking");
  expect(strip("yarn build")).toBe("yarn build");
});
