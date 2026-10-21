// The package against pumi/testing's fake app: no pumi running. `app.perf` is answered from the
// report a test names, and the panes it opens are the fake's.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";
import { heightOf, reportOf } from "../src/report.ts";

const dir = join(import.meta.dir, "..");
let app: FakeApp;
afterEach(() => app?.stop());

function series(now: number) {
  return { now, avg_10s: now, avg_60s: now, peak_60s: now, last_60s: [now, now] };
}

/** What `app.perf` answers: the app's own numbers, a second apart. */
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
    ],
    threads: [
      { name: "plugin perf", count: 1, cpu_percent: series(2) },
      { name: "exited threads", count: 0, cpu_percent: series(1) },
    ],
  };
}

const HEIGHT = heightOf(reportOf(sample()));

/** Starts the package, `app.perf` answering `report` (nothing, without one). */
async function start(opts: { options?: Record<string, unknown>; report?: unknown } = {}): Promise<FakeApp> {
  app = await FakeApp.start({
    dir,
    main: "src/main.ts",
    options: opts.options,
    answers: opts.report === undefined ? {} : { "app.perf": opts.report },
  });
  app.answer("pane.list", () => []);
  return app;
}

test("the overlay draws what the app says of itself", async () => {
  await start({ report: sample() });
  const view = app.open("overlay", { args: { height: HEIGHT }, size: { width: 868, height: HEIGHT } });
  await app.settle();
  const text = view.text();
  expect(text).toContain("performance");
  expect(text).toContain("app    cpu   14% now   14% 10s   14% 60s  peak   14%");
  expect(text).toContain("rss 300.0 MB  threads 40  up 12s  samples 12");
  expect(text).toContain("60 frames/s  avg 2.5ms  max 16.2ms  slow 1");
  expect(text).toContain("max refresh 31.5ms");
  expect(text).toContain("▶ refresh 900.0ms");
  expect(text).toContain("since gone");
  expect(text).not.toContain("no extension has run yet");
  expect(text).not.toContain("the first sample is a second away");
  expect(view.snapshot()).toMatchSnapshot();
});

test("its tables are in the terminal's font, and as wide as their columns", async () => {
  await start({ report: sample() });
  app.answer("option.get", (name: string) => (name === "guifont" ? "JetBrains_Mono:h14" : (app.options.get(name) ?? null)));
  const view = app.open("overlay", { args: { height: HEIGHT }, size: { width: 868, height: HEIGHT } });
  await app.settle();
  const root = view.find(".perf");
  expect(root.style["font-family"]).toBe("JetBrains Mono");
  expect(root.style["font-size"]).toBe("12px");
  expect(root.style["padding"]).toBe("8px");
});

test("an app that does not answer draws an empty overlay", async () => {
  await start();
  const view = app.open("overlay", { args: { height: HEIGHT }, size: { width: 868, height: HEIGHT } });
  await app.settle();
  expect(view.text()).toContain("no extension has run yet");
  expect(view.text()).toContain("the first sample is a second away");
});

test("it moves its own pane when the rows do not fit the height it was opened at", async () => {
  await start({ report: sample() });
  const view = app.open("overlay", { args: { height: 148 }, size: { width: 868, height: 148 } });
  await app.settle();
  const places = app.called("pane.setPlace");
  expect(places).toHaveLength(1);
  expect(places[0]![0]).toBe(1000 + view.surface);
  expect(places[0]![1]).toMatchObject({ height: `${HEIGHT}px`, width: "868px", anchor: "NE" });
});

test("the toggle opens it over the window, and takes it away", async () => {
  await start({ report: sample() });
  expect(await app.command("toggle")).toBe(true);
  const [opened] = app.called("pane.open");
  expect(opened).toEqual([
    "local.perf.overlay",
    { height: HEIGHT },
    {
      kind: "float",
      relative: "client",
      anchor: "NE",
      row: "44px",
      col: "12px",
      width: "868px",
      height: `${HEIGHT}px`,
      focusable: false,
      mouse: false,
      zindex: 90,
      focus: false,
    },
  ]);
  app.answer("pane.list", () => [7]);
  expect(await app.command("toggle")).toBe(false);
  expect(app.called("pane.close")).toEqual([[7, true]]);
  expect(app.notices).toEqual([]);
});

test("an open overlay moves to the corner the option says now", async () => {
  await start({ report: sample(), options: { corner: "SW" } });
  await app.command("toggle");
  app.answer("pane.list", () => [7]);
  expect(app.called("pane.open")[0]![2]).toMatchObject({ anchor: "SW", row: "32px" });
  app.options.set("local.perf.corner", "NW");
  await app.fire("option.changed", { name: "local.perf.corner" }, { match: "local.perf.corner" });
  expect(app.called("pane.setPlace").at(-1)).toEqual([
    7,
    expect.objectContaining({ anchor: "NW", row: "44px", height: `${HEIGHT}px` }),
  ]);
});

test("the trigger is bound in the global key table, and follows its option", async () => {
  await start({ report: sample() });
  expect(app.called("key.set")).toEqual([["global", "<D-M-p>", expect.objectContaining({ ref: expect.any(Number) }), {
    desc: "Toggle the performance overlay",
  }]]);
  expect(app.keys.has("global <D-M-p>")).toBe(true);
  app.options.set("local.perf.trigger", "<D-M-t>");
  await app.fire("option.changed", { name: "local.perf.trigger" }, { match: "local.perf.trigger" });
  expect(app.called("key.del")).toEqual([["global", "<D-M-p>", {}]]);
  expect(app.keys.has("global <D-M-p>")).toBe(false);
  expect(app.keys.has("global <D-M-t>")).toBe(true);
});

test("View → Performance Overlay runs the same command", async () => {
  await start({ report: sample() });
  expect(app.called("menu.add")).toEqual([
    ["View.Performance Overlay", { call: "local.perf.toggle" }, { desc: "How the app is doing: CPU, memory, frames, core plugins, threads." }],
  ]);
});
