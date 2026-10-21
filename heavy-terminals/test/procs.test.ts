// The machine's processes: what the API lists, and what a pane's tree of them costs.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";
import { processes, usage, type Procs } from "../src/procs.ts";

const dir = join(import.meta.dir, "..");
let app: FakeApp;
afterEach(() => app?.stop());

test("a pane costs what it and its children cost", () => {
  const procs: Procs = new Map([
    [10, { ppid: 1, cpu: 2, rss: 1000 }],
    [11, { ppid: 10, cpu: 3, rss: 2000 }],
    [12, { ppid: 11, cpu: 4, rss: 3000 }],
    [13, { ppid: 1, cpu: 9, rss: 9000 }],
    [14, { ppid: 14, cpu: 1, rss: 10 }],
  ]);
  expect(usage(procs, 10)).toEqual({ cpu: 9, rss: 6000 });
  expect(usage(procs, 13)).toEqual({ cpu: 9, rss: 9000 });
  expect(usage(procs, 99)).toEqual({ cpu: 0, rss: 0 });
  // A process that is its own parent is nobody's child, so it neither loops nor counts.
  expect(usage(procs, 14)).toEqual({ cpu: 1, rss: 10 });
});

test("the processes are the ones the API lists", async () => {
  app = await FakeApp.start({
    dir,
    answers: {
      "system.process.list": [
        { pid: 42, ppid: 1, cpu: 12.5, rss: 2048 * 1024, command: "zsh" },
        { pid: 43, ppid: 42, cpu: 0, rss: 0, command: "make" },
        { pid: 44, cpu: 3 },
        { pid: 45, ppid: 1 },
      ],
    },
  });
  expect([...(await processes())]).toEqual([
    [42, { ppid: 1, cpu: 12.5, rss: 2048 * 1024 }],
    [43, { ppid: 42, cpu: 0, rss: 0 }],
    [45, { ppid: 1, cpu: 0, rss: 0 }],
  ]);
});

test("a machine that cannot be measured is empty, not an error", async () => {
  app = await FakeApp.start({
    dir,
    answers: {
      "system.process.list": () => {
        throw new Error("no ps");
      },
    },
  });
  expect((await processes()).size).toBe(0);
});
