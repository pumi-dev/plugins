// The bar a pane shows: what it draws, a row a job, and what its rows do.
import { afterEach, expect, test } from "bun:test";
import type { RenderedView } from "pumi/testing";
import { start, type Fake } from "./fake.ts";

let fake: Fake;
afterEach(() => fake?.app.stop());

/** Two jobs waiting for pane 4, which is working: everything the bar shows is its own state. */
async function waiting(): Promise<Fake> {
  const started = await start({ 4: { foreground: 42, pid: 41 } });
  await started.app.serve("queue.add", { command: "cargo test", after: "%4" });
  await started.app.serve("queue.add", { command: "make deploy", after: "%4", name: "deploy" });
  fake = started;
  return started;
}

/** The bar under pane `pane`, `height` pixels tall, as the app opens it. */
async function bar(pane = 4, height = 96): Promise<RenderedView> {
  const view = fake.app.open("board", { args: { pane }, size: { width: 600, height } });
  await fake.app.settle();
  return view;
}

test("the bar is a title and a row a job, and the app takes everything it sends", async () => {
  await waiting();
  const v = await bar();
  expect(v.text("#queue-title")).toBe("queue2 waiting");
  expect(v.findAll((node) => node.props.id?.startsWith("queue-job-")).map((node) => v.text((each) => each === node))).toEqual([
    "·cargo testafter %4 · done✕",
    "·deployafter %4 · done✕",
  ]);
  expect(v.errors).toEqual([]);
  expect(v.snapshot()).toMatchSnapshot();
});

test("one row is the whole queue in a line", async () => {
  await waiting();
  const v = await bar(4, 24);
  expect(v.findAll("#queue-title")).toEqual([]);
  expect(v.text("#queue-line")).toBe("·cargo test+1after %4 · done");
});

test("a bar with nothing under its pane says so", async () => {
  await waiting();
  const v = await bar(7);
  expect(v.text("#queue-bar")).toBe("queue0 over");
});

test("a row goes to its pane", async () => {
  await waiting();
  const v = await bar();
  await v.click("#queue-job-2");
  expect(fake.app.called("pane.select")).toEqual([[{ to: 4 }]]);
});

test("✕ cancels a job that has not started", async () => {
  await waiting();
  const v = await bar();
  await v.click("#queue-cancel-2");
  expect(await fake.app.serve("queue.list")).toMatchObject([
    { id: 1, state: "waiting" },
    { id: 2, state: "cancelled" },
  ]);
  // The row says so, and the press did not go on to the row (which would select its pane).
  expect(v.text("#queue-job-2")).toBe("×deploycancelled");
  expect(fake.app.called("pane.select")).toEqual([]);
});
