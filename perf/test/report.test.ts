// The report as the overlay draws it: what a plugin's row says, how tall the float is, and the
// units its numbers are written in. No app: `app.perf`'s answer is a plain object here.
import { expect, test } from "bun:test";
import {
  EMPTY,
  EXTENSIONS,
  GRAPH,
  PAD,
  FRAME,
  GAP,
  LINE,
  SPACER,
  appLine,
  bytes,
  duration,
  extensionCells,
  fixed,
  graphLine,
  heightOf,
  level,
  load,
  memoryLine,
  percent,
  reportOf,
  rowsOf,
  threadCells,
  uiLine,
  width,
} from "../src/report.ts";

function series(now: number) {
  return { now, avg_10s: now, avg_60s: now, peak_60s: now, last_60s: [now, now] };
}

function sample() {
  return {
    samples: 12,
    process: { cpu_percent: series(14), rss: 300 << 20, threads: 40, uptime: 12 },
    frames: { per_second: series(60), ui_percent: series(5), avg: 2.5, max: 16.25, slow: 1 },
    extensions: [
      {
        name: "git",
        running: true,
        busy_percent: series(60),
        cpu_percent: series(3),
        calls_per_second: series(1),
        ui_ms_per_second: series(0),
        queued: 0,
        memory: 2048,
        calls: 4,
        max: 31.5,
        max_kind: "refresh",
        current: null,
      },
      {
        name: "files",
        running: true,
        busy_percent: series(1),
        cpu_percent: series(1),
        calls_per_second: series(1),
        ui_ms_per_second: series(0),
        queued: 0,
        memory: 0,
        calls: 9,
        max: 1,
        max_kind: "key",
        current: { kind: "refresh", elapsed: 900 },
      },
      { name: "palette", running: false, calls: 0 },
    ],
    threads: [
      { name: "plugin perf", count: 1, cpu_percent: series(2) },
      { name: "exited threads", count: 0, cpu_percent: series(1) },
    ],
  };
}

test("a report reads as drawn", () => {
  const r = reportOf(sample());
  expect([r.samples, r.rss, r.extensions.length, r.threads.length]).toEqual([12, 300 << 20, 3, 2]);
  const git = r.extensions[0]!;
  expect(git.call).toBe("max refresh 31.5ms");
  expect(level(git)).toBe("hot");
  expect(r.extensions[1]!.call).toBe("▶ refresh 900.0ms");
  expect(level(r.extensions[2]!)).toBe("off");
  expect(extensionCells(r.extensions[2]!)[0]).toBe("palette (off)");
  expect(extensionCells(git).length + 1).toBe(EXTENSIONS.length);
  expect(threadCells(r.threads[1]!)[5]).toBe("since gone");
  expect(appLine(r).startsWith("app    cpu   14% now")).toBe(true);
  expect(memoryLine(r)).toContain("rss 300.0 MB");
  expect(uiLine(r)).toContain("60 frames/s  avg 2.5ms  max 16.2ms  slow 1");
});

test("a row is louder as it queues and as it waits on the main thread", () => {
  const quiet = reportOf(sample()).extensions[0]!;
  expect(level({ ...quiet, running: false })).toBe("off");
  expect(level({ ...quiet, queued: 10 })).toBe("hot");
  expect(level({ ...quiet, uiMs: { ...quiet.uiMs, avg10s: 8 } })).toBe("busy");
  expect(level(quiet)).toBe("hot");
  expect(level({ ...quiet, busy: { ...quiet.busy, avg10s: 1 }, cpu: { ...quiet.cpu, avg10s: 2 } })).toBe("quiet");
  expect(level({ ...quiet, busy: { ...quiet.busy, avg10s: 12 }, cpu: { ...quiet.cpu, avg10s: 2 } })).toBe("busy");
});

test("a report is as tall as its rows", () => {
  const r = reportOf(sample());
  // Title, three lines, a heading, three plugins; a heading and two threads.
  expect(rowsOf(r)).toEqual({ rows: 11, spacers: 2 });
  expect(rowsOf(EMPTY)).toEqual({ rows: 7, spacers: 1 });
  expect(heightOf(r)).toBeGreaterThan(heightOf(EMPTY));
  expect(heightOf(EMPTY)).toBe(2 * PAD + FRAME + 7 * LINE + SPACER + 7 * GAP);
  expect(width()).toBeGreaterThan(800);
  expect(width()).toBeLessThan(900);
});

test("an app that does not answer is a report with nothing in it", () => {
  for (const nothing of [null, undefined, {}, { samples: "twelve" }]) {
    const r = reportOf(nothing);
    expect(r.samples).toBe(0);
    expect(r.extensions).toEqual([]);
    expect(rowsOf(r)).toEqual({ rows: 7, spacers: 1 });
  }
});

test("a graph is right aligned and always as wide", () => {
  const young = { now: 0, avg10s: 0, avg60s: 0, peak60s: 100, last60s: [100, 50] };
  expect([...graphLine(young)].length).toBe(GRAPH);
  expect(graphLine(young).endsWith("█▄")).toBe(true);
  const full = { now: 0, avg10s: 0, avg60s: 0, peak60s: 0, last60s: new Array(60).fill(0) };
  expect([...graphLine(full)].length).toBe(GRAPH);
  // A minute is one character the sample, however many samples there are.
  const second = { ...young, last60s: new Array(30).fill(100) };
  expect([...graphLine(second)].length).toBe(GRAPH);
  expect(graphLine(second).endsWith("█".repeat(30))).toBe(true);
});

test("units read well", () => {
  expect([bytes(512), bytes(4096), bytes(3 << 20)]).toEqual(["512 B", "4 KB", "3.0 MB"]);
  expect([duration(1500), duration(2.5), duration(0.04)]).toEqual(["1.50s", "2.5ms", "40µs"]);
  expect([percent(14.4), percent(14.5)]).toEqual(["14%", "14%"]);
  expect([load(9), load(10), load(50)]).toEqual(["quiet", "busy", "hot"]);
  // A tie goes to the even digit, as Rust's `{:.N}` formats it.
  expect(fixed(16.25, 1)).toBe("16.2");
  expect(fixed(16.35, 1)).toBe("16.4");
});
