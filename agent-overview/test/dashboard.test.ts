// The dashboard: the rows it lists and the order they come in, the filters and the search, and what
// a press on a row does.
import { afterEach, expect, test } from "bun:test";
import type { FakeApp, RenderedView } from "pumi/testing";

import { since } from "../src/dashboard.ts";
import { machine, type Machine } from "./fake.ts";

let app: FakeApp;
afterEach(() => app?.stop());

/** The dashboard, opened on the fake app's model. */
async function opened(m: Machine = {}): Promise<RenderedView> {
  app = await machine({ main: "src/main.ts", ...m });
  const view = app.open("overview");
  await app.settle();
  await app.settle();
  return view;
}

/** The ids of the nodes `selector` finds. */
const ids = (view: RenderedView, selector: string) => view.findAll(selector).map((node) => node.props.id);

test("the rail lists a session's agents under its name, what wants the user first", async () => {
  const view = await opened();
  expect(ids(view, ".agent-overview-agent")).toEqual([
    "agent-overview-rail-100",
    "agent-overview-rail-101",
    "agent-overview-rail-200",
  ]);
  expect(view.text("#agent-overview-session-1")).toContain("MAIN");
  expect(view.text("#agent-overview-session-2")).toContain("WORK");
  expect(view.text("#agent-overview-rail-100")).toBe("claudepumiyou");
  // The pane the user is in says so, and only it.
  expect(view.text("#agent-overview-rail-200")).toBe("piother");
});

test("the table has a row each, in the same order", async () => {
  const view = await opened();
  expect(ids(view, ".agent-overview-row")).toEqual([
    "agent-overview-row-100",
    "agent-overview-row-101",
    "agent-overview-row-200",
  ]);
  expect(view.text("#agent-overview-row-100")).toContain("claude");
  expect(view.text("#agent-overview-row-100")).toContain("needs permission");
  expect(view.text("#agent-overview-row-100")).toContain("main › agents");
  expect(view.text("#agent-overview-row-100")).toContain("/Users/me/Kitchen/pumi");
});

test("the heading counts what the list narrows to", async () => {
  const view = await opened();
  expect(view.text()).toContain("3 of 3 agents · 2 sessions · 2 need you");
  // The cards count each state against the whole.
  expect(view.text()).toContain("running now");
  expect(view.text()).toContain("blocked or failed");
  expect(view.text()).toContain("waiting for a prompt");
});

test("a filter narrows the rail and the table", async () => {
  const view = await opened();
  await view.click("#agent-overview-nav-needs-you");
  expect(ids(view, ".agent-overview-agent")).toEqual(["agent-overview-rail-100", "agent-overview-rail-101"]);
  expect(ids(view, ".agent-overview-row")).toEqual(["agent-overview-row-100", "agent-overview-row-101"]);
  expect(view.text()).toContain("2 of 3 agents");

  await view.click("#agent-overview-nav-idle");
  expect(ids(view, ".agent-overview-agent")).toEqual(["agent-overview-rail-200"]);
  await view.click("#agent-overview-nav-working");
  expect(ids(view, ".agent-overview-agent")).toEqual([]);
  expect(view.text()).toContain("No agents report yet");
});

test("the search narrows by every word, in the name, the place or the directory", async () => {
  const view = await opened();
  await view.type("#agent-overview-search", "claude");
  expect(ids(view, ".agent-overview-agent")).toEqual(["agent-overview-rail-100"]);
  expect(view.text()).toContain("1 of 3 agents");

  await view.type("#agent-overview-search", "nothing");
  expect(ids(view, ".agent-overview-agent")).toEqual([]);
  expect(view.text()).toContain("Nothing matches “nothing”");
});

test("a press on a row picks the agent, and the bar under the table offers its pane", async () => {
  const view = await opened();
  expect(view.findAll("#agent-overview-go")).toEqual([]);
  await view.click("#agent-overview-rail-101");
  expect(view.find("#agent-overview-selected-101").props.id).toBe("agent-overview-selected-101");
  expect(view.find("#agent-overview-go").props.params).toMatchObject({ label: "Go to pane" });
});

test("Go to pane goes to it, and marks what it left seen", async () => {
  const view = await opened();
  await view.click("#agent-overview-rail-101");
  await view.click("#agent-overview-go");
  expect(app.called("pane.select")).toEqual([[{ to: 101 }]]);
  expect(app.called("pane.markSeen")).toEqual([[101]]);
});

test("a second press on a row goes to its pane", async () => {
  const view = await opened();
  await view.click("#agent-overview-rail-200", { clicks: 2 });
  expect(app.called("pane.select")).toEqual([[{ to: 200 }]]);
});

test("the keyboard steps the highlight, enter goes, escape lets it go", async () => {
  const view = await opened();
  await view.press("down", "#agent-overview");
  expect(view.find("#agent-overview-selected-100").props.id).toBe("agent-overview-selected-100");
  await view.press("down", "#agent-overview");
  expect(view.find("#agent-overview-selected-101").props.id).toBe("agent-overview-selected-101");
  await view.press("up", "#agent-overview");
  expect(view.find("#agent-overview-selected-100").props.id).toBe("agent-overview-selected-100");
  await view.press("escape", "#agent-overview");
  expect(view.findAll("#agent-overview-go")).toEqual([]);
  await view.press("enter", "#agent-overview");
  expect(app.called("pane.select")).toEqual([[{ to: 100 }]]);
});

test("hide_idle leaves out the agents that only wait, but not the one you are in", async () => {
  const view = await opened({ options: { hide_idle: true } });
  expect(ids(view, ".agent-overview-agent")).toEqual(["agent-overview-rail-100", "agent-overview-rail-101"]);
});

test("an event about an agent reads the model again", async () => {
  const view = await opened();
  await app.fire("option.changed", { name: "@agent_status" }, { match: "@agent_status" });
  await app.settle();
  expect(app.called("server.getState").length).toBeGreaterThan(1);
  expect(ids(view, ".agent-overview-row")).toEqual(["agent-overview-row-100", "agent-overview-row-101", "agent-overview-row-200"]);
});

test("the line above the table ages", () => {
  expect(since(0)).toBe("updated just now");
  expect(since(4_900)).toBe("updated just now");
  expect(since(5_000)).toBe("updated 5s ago");
  expect(since(59_000)).toBe("updated 59s ago");
  expect(since(60_000)).toBe("updated 1m ago");
  expect(since(150_000)).toBe("updated 2m ago");
});

test("the dashboard as it opens", async () => {
  const view = await opened();
  expect(view.snapshot()).toMatchSnapshot();
});

test("the rail is as wide as its option says", async () => {
  const view = await opened({ options: { rail_width: 300 } });
  expect(view.find("#agent-overview-rail").parent?.style).toMatchObject({ width: "300px" });
});

test("it reads its options when it opens", async () => {
  const view = await opened();
  const asked = app.called("option.get").map(([name]) => name);
  expect(asked).toContain("local.agent_overview.poll_secs");
  expect(asked).toContain("local.agent_overview.hide_idle");
  expect(asked).toContain("local.agent_overview.rail_width");
  expect(view.find("#agent-overview-rail").parent?.style).toMatchObject({ width: "248px" });
});
