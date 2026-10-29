// How the map names a session, a view and a tab: their own names, or the ones pumi gives them.
import { expect, test } from "bun:test";

import { sessionLabel, tabTitle, viewLabel } from "../../src/context/label.ts";
import { read } from "../../src/context/snapshot.ts";
import { sessions } from "./fake.ts";

const snap = () => read(sessions(), 1);

test("a session's name follows its id, or is only the id", () => {
  const given = sessions();
  expect(sessionLabel(read(given, 1).sessions[0]!)).toBe("$1 pumi");
  given[0]!.name = "";
  expect(sessionLabel(read(given, 1).sessions[0]!)).toBe("$1");
});

test("a view's name follows its id, or is only the id", () => {
  const model = snap();
  expect(viewLabel(model.views[0]!)).toBe("@1 main");
  expect(viewLabel(model.views[2]!)).toBe("@3");
});

test("a tab is its title, the agent in it, its directory, else its block", () => {
  const tabs = snap().tabs;
  expect(tabTitle(tabs.find((tab) => tab.id === 11)!)).toBe("π - claude");
  const bare = { ...tabs[0]!, title: "", stripped: "", agent: "", cwd: "/Users/me/work/", block: "" };
  expect(tabTitle(bare)).toBe("/Users/me/work");
  expect(tabTitle({ ...bare, cwd: "", block: "terminal" })).toBe("terminal");
  expect(tabTitle({ ...bare, cwd: "", agent: "claude" })).toBe("claude");
  expect(tabTitle({ ...bare, cwd: "", title: "⠋ claude", stripped: "claude" })).toBe("claude");
});
