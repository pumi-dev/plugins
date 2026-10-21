// The package as it starts: the functions it provides, and the measuring it begins on its own.
import { afterEach, expect, test } from "bun:test";
import type { FakeApp } from "pumi/testing";
import { machine } from "./machine.ts";

let app: FakeApp;
afterEach(() => app?.stop());

/** The package's own `name` (`amresyd.heavy_terminals.` in the app, `local.heavy_terminals.` here). */
const at = (app: FakeApp, name: string) => `${app.init.prefix}${name}`;

test("sleep suspends the pane it is given", async () => {
  app = await machine({ main: "src/main.ts", panes: [3], pids: { 3: 42 } });
  await app.serve(at(app, "sleep"), 3);
  expect(app.called("pane.call")).toEqual([[3, "input", { bytes: [26] }]]);
  expect(app.called("option.set")).toEqual([["@heavy", "asleep", { pane: 3 }]]);
});

test("sleep reads a pane named as a user command names one, `%3`", async () => {
  app = await machine({ main: "src/main.ts", panes: [3], pids: { 3: 42 } });
  await app.serve(at(app, "sleep"), "%3");
  expect(app.called("pane.call")).toEqual([[3, "input", { bytes: [26] }]]);
});

test("sleep with no pane sleeps the current one", async () => {
  app = await machine({ main: "src/main.ts", panes: [3], pids: { 3: 42 } });
  app.answer("pane.current", 7);
  await app.serve(at(app, "sleep"));
  expect(app.called("pane.call")).toEqual([[7, "input", { bytes: [26] }]]);
});

test("sleep with no pane to sleep says so", async () => {
  app = await machine({ main: "src/main.ts" });
  app.answer("pane.current", () => {
    throw new Error("no pane");
  });
  await expect(app.serve(at(app, "sleep"))).rejects.toThrow("no pane to put to sleep");
});

test("wake types fg in the pane it is given", async () => {
  app = await machine({ main: "src/main.ts", panes: [3], pids: { 3: 42 } });
  await app.serve(at(app, "wake"), { pane: 4 });
  expect(app.called("pane.call")).toEqual([[4, "input", { text: "fg\r" }]]);
  expect(app.called("option.set")).toEqual([["@heavy", null, { pane: 4 }]]);
});

test("the package measures every terminal as it starts", async () => {
  app = await machine({
    main: "src/main.ts",
    panes: [3],
    pids: { 3: 42 },
    options: { sustain: 1 },
    processes: [{ pid: 42, ppid: 1, cpu: 200, rss: 0 }],
  });
  await app.settle();
  expect(app.notices).toEqual([{ msg: "%3 is heavy: 200% cpu, 0 MB", level: "warn" }]);
  expect(app.called("option.set")).toEqual([["@heavy", "200% cpu, 0 MB", { pane: 3 }]]);
});
