// The machine's processes: what a pane's tree of them costs. `processes()` itself asks the app
// (`system.process.list`), so it is not here: a package's test runs without one.
import { expect, test } from "bun:test";
import { usage, type Procs } from "../src/procs.ts";

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
