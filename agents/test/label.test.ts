// How the map names a space, a tab and a pane: their own names, or the ones pumi gives them.
import { expect, test } from "bun:test";

import { spaceLabel, tabLabel, title } from "../src/label.ts";
import { read } from "../src/snapshot.ts";
import { state } from "./fake.ts";

const snap = () => read(state());

test("a space's name is its own, or its id when it has none", () => {
  const given = state();
  given.spaces[0]!.label = "";
  expect(spaceLabel(read(given).spaces[0]!)).toBe("$1");
});

test("a tab with no name is its number, as the core says it", () => {
  expect(tabLabel(snap().tabs.find((tab) => tab.id === 10)!)).toBe("Tab 1");
  expect(tabLabel(snap().tabs.find((tab) => tab.id === 11)!)).toBe("editor");
});

test("a pane's title is its label, its stripped title, the agent, else its directory", () => {
  const panes = snap().panes;
  expect(title(panes.find((pane) => pane.id === 101)!)).toBe("π - claude");
  const bare = { ...panes[0]!, title: "", stripped: "", label: "", agent: "", cwd: "/Users/me/work/" };
  expect(title(bare)).toBe("/Users/me/work");
  expect(title({ ...bare, label: "the agent" })).toBe("the agent");
  expect(title({ ...bare, title: "⠋ claude", stripped: "claude" })).toBe("claude");
});
