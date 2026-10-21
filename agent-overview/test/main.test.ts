// The package as it starts: its command, the function it provides, the menu item, and the chord its
// `key` option binds.
import { afterEach, expect, test } from "bun:test";
import type { FakeApp } from "pumi/testing";

import { machine } from "./fake.ts";

let app: FakeApp;
afterEach(() => app?.stop());

/** The package's own `name` (`amresyd.agent_overview.` in the app, `local.agent_overview.` here). */
const at = (app: FakeApp, name: string) => `${app.init.prefix}${name}`;

test("the command opens a tab of its own when the overview is closed", async () => {
  app = await machine({ main: "src/main.ts", open: [] });
  await app.command("open");
  expect(app.called("pane.open")).toEqual([[at(app, "overview"), {}, { kind: "tab", name: "agents" }]]);
});

test("the command goes to the overview when one is open", async () => {
  app = await machine({ main: "src/main.ts", open: [7] });
  await app.command("open");
  expect(app.called("pane.select")).toEqual([[{ to: 7 }]]);
  expect(app.called("pane.open")).toEqual([]);
});

test("it says so when the tab could not be made", async () => {
  app = await machine({ main: "src/main.ts", open: [] });
  app.answer("pane.open", () => {
    throw new Error("no room");
  });
  await app.command("open");
  expect(app.notices).toEqual([{ msg: "agent overview: no room", level: "error" }]);
});

test("list answers every agent, its counts and its sessions", async () => {
  app = await machine({ main: "src/main.ts" });
  const answered = (await app.serve(at(app, "list"))) as { agents: unknown[]; sessions: number; counts: unknown };
  expect(answered.agents).toHaveLength(3);
  expect(answered.sessions).toBe(2);
  expect(answered.counts).toEqual({ blocked: 1, error: 1, working: 0, done: 0, idle: 1 });
});

test("its menu item opens it", async () => {
  app = await machine({ main: "src/main.ts" });
  expect(app.called("menu.add")).toEqual([
    [
      "View.Agent Overview",
      { call: at(app, "open") },
      { desc: "Every agent in this pumi: who is working, who is blocked, and where." },
    ],
  ]);
});

test("an empty key option binds nothing", async () => {
  app = await machine({ main: "src/main.ts", options: { key: "" } });
  expect(app.called("key.set")).toEqual([]);
});

test("the key option binds a chord that opens it", async () => {
  app = await machine({ main: "src/main.ts", options: { key: "<M-a>" } });
  expect(app.called("key.set")).toEqual([
    ["root", "<M-a>", { call: at(app, "open") }, { desc: "Open the agent overview" }],
  ]);
});

test("changing the key unbinds the chord before it", async () => {
  app = await machine({ main: "src/main.ts", options: { key: "<M-a>" } });
  await app.fire("option.changed", { name: at(app, "key") }, { match: at(app, "key") });
  expect(app.keys.has("root <M-a>")).toBe(true);

  // The option's new value is what the app would answer; the package unbinds and binds again.
  app.options.set(at(app, "key"), "<M-b>");
  await app.fire("option.changed", { name: at(app, "key") }, { match: at(app, "key") });
  await app.settle();
  expect(app.keys.has("root <M-a>")).toBe(false);
  expect(app.keys.has("root <M-b>")).toBe(true);

  app.options.set(at(app, "key"), "");
  await app.fire("option.changed", { name: at(app, "key") }, { match: at(app, "key") });
  await app.settle();
  expect(app.keys.has("root <M-b>")).toBe(false);
});

test("the chord is bound once, however often its option is read", async () => {
  app = await machine({ main: "src/main.ts", options: { key: "<M-a>" } });
  await app.fire("option.changed", { name: at(app, "key") }, { match: at(app, "key") });
  expect(app.called("key.set")).toHaveLength(1);
  expect(app.called("key.del")).toEqual([]);
});
