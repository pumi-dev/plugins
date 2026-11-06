// How the map names a project, a view and a tab: their folder's or their own name, or the ones pumi
// gives them.
import { expect, test } from "bun:test";

import { projectLabel, tabTitle, viewLabel } from "../../src/context/label.ts";
import { read } from "../../src/context/snapshot.ts";
import { projects } from "./fake.ts";

const snap = () => read(projects(), 1);

test("a project's folder follows its id, or is only the id", () => {
  const given = projects();
  expect(projectLabel(read(given, 1).projects[0]!)).toBe("$1 pumi");
  given[0]!.path = "";
  expect(projectLabel(read(given, 1).projects[0]!)).toBe("$1");
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
