// Measuring the terminals: what is heavy, what being heavy does, and the panes put to sleep.
import { afterEach, expect, test } from "bun:test";
import type { FakeApp } from "pumi/testing";
import type { Procs } from "../src/procs.ts";
import { Watches } from "../src/watches.ts";
import { machine } from "./machine.ts";

let app: FakeApp;
afterEach(() => app?.stop());

/** A machine's processes: `costs` by pid, each a child of pid 1. */
function procsOf(costs: Record<number, { cpu: number; rss: number }>): Procs {
  return new Map(Object.entries(costs).map(([pid, cost]) => [Number(pid), { ppid: 1, ...cost }]));
}

const busy = procsOf({ 42: { cpu: 200, rss: 1024 * 1024 } });
const idle = procsOf({ 42: { cpu: 1, rss: 1024 * 1024 } });

test("a terminal heavy for `sustain` checks is marked and said once", async () => {
  app = await machine({ panes: [3], pids: { 3: 42 } });
  const watches = new Watches();
  await watches.check(busy);
  await watches.check(busy);
  expect(app.notices).toEqual([]);
  await watches.check(busy);
  expect(app.notices).toEqual([{ msg: "%3 is heavy: 200% cpu, 1 MB", level: "warn" }]);
  expect(app.called("option.set")).toEqual([["@heavy", "200% cpu, 1 MB", { pane: 3 }]]);
  // Said once: it stays alert until it is not heavy any more.
  await watches.check(busy);
  expect(app.notices.length).toBe(1);
});

test("one check that is not heavy starts the count over", async () => {
  app = await machine({ panes: [3], pids: { 3: 42 } });
  const watches = new Watches();
  await watches.check(busy);
  await watches.check(busy);
  await watches.check(idle);
  await watches.check(busy);
  expect(app.notices).toEqual([]);
  await watches.check(busy);
  await watches.check(busy);
  expect(app.notices.length).toBe(1);
});

test("memory is the other bar: 4096 MB unless the option says otherwise", async () => {
  app = await machine({ panes: [3], pids: { 3: 42 }, options: { sustain: 1 } });
  const watches = new Watches();
  await watches.check(procsOf({ 42: { cpu: 0, rss: 4096 * 1_048_576 } }));
  expect(app.notices).toEqual([]);
  await watches.check(procsOf({ 42: { cpu: 0, rss: 4096 * 1_048_576 + 1 } }));
  expect(app.notices).toEqual([{ msg: "%3 is heavy: 0% cpu, 4096 MB", level: "warn" }]);
});

test("auto_sleep suspends the terminal it finds heavy", async () => {
  app = await machine({ panes: [3], pids: { 3: 42 }, options: { sustain: 1, auto_sleep: true } });
  const watches = new Watches();
  await watches.check(busy);
  expect(app.called("pane.call")).toEqual([[3, "input", { bytes: [26] }]]);
  expect(app.called("option.set")).toEqual([
    ["@heavy", "200% cpu, 1 MB", { pane: 3 }],
    ["@heavy", "asleep", { pane: 3 }],
  ]);
  // Asleep, it is not measured again as heavy: one notice, one ctrl+z.
  await watches.check(busy);
  expect(app.notices.length).toBe(1);
  expect(app.called("pane.call").length).toBe(1);
});

test("a terminal that closed is forgotten", async () => {
  app = await machine({ panes: [3], pids: { 3: 42 }, options: { sustain: 2 } });
  const watches = new Watches();
  await watches.check(busy);
  app.answer("pane.list", []);
  await watches.check(busy);
  app.answer("pane.list", [3]);
  await watches.check(busy);
  // One check in a row, not two: what was found of it went with the pane.
  expect(app.notices).toEqual([]);
  await watches.check(busy);
  expect(app.notices.length).toBe(1);
});

test("a terminal that closed is not asleep any more", async () => {
  app = await machine({ panes: [3], pids: { 3: 42 }, options: { sustain: 1, auto_sleep: true } });
  const watches = new Watches();
  await watches.check(busy);
  app.answer("pane.list", []);
  await watches.check(busy);
  app.answer("pane.list", [3]);
  await watches.check(busy);
  // Slept again: it was not still known to be asleep.
  expect(app.called("pane.call")).toEqual([
    [3, "input", { bytes: [26] }],
    [3, "input", { bytes: [26] }],
  ]);
  expect(app.notices.length).toBe(2);
});

test("a terminal with no program is not measured", async () => {
  app = await machine({ panes: [3], options: { sustain: 1 } });
  const watches = new Watches();
  await watches.check(busy);
  expect(app.notices).toEqual([]);
});

test("sleep suspends the foreground job, and marks the pane asleep", async () => {
  app = await machine({ panes: [3], pids: { 3: 42 } });
  const watches = new Watches();
  await watches.sleep(3);
  expect(app.called("pane.call")).toEqual([[3, "input", { bytes: [26] }]]);
  expect(app.called("option.set")).toEqual([["@heavy", "asleep", { pane: 3 }]]);
});

test("wake types fg, and takes the mark away", async () => {
  app = await machine({ panes: [3], pids: { 3: 42 } });
  const watches = new Watches();
  await watches.wake(3);
  expect(app.called("pane.call")).toEqual([[3, "input", { text: "fg\r" }]]);
  expect(app.called("option.set")).toEqual([["@heavy", null, { pane: 3 }]]);
});
