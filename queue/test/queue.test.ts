// The queue against pumi/testing's fake app: its four functions, a job's states, and the bar it
// keeps under the panes that have work.
import { afterEach, expect, test } from "bun:test";
import { ORIGIN, start, type Fake } from "./fake.ts";

let fake: Fake;
afterEach(() => fake?.app.stop());

/** The jobs `queue.list` says there are. */
const jobs = () => fake.app.serve("queue.list") as Promise<Record<string, any>[]>;

/** The panes the package opened, by the type it opened them as. */
function opened(type: string): any[][] {
  return fake.app.called("pane.open").filter((args) => args[0] === type);
}

/** The terminals the queue ran a job in. */
const terminals = () => opened("terminal").map((args) => args[1]);

/** The bars it put under panes. */
const bars = () => opened("local.queue.board");

/** Waits for job `id` to be `state` (a spawned job's end, which no event the test fires brings). */
async function untilJob(id: number, state: string, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    const job = (await jobs()).find((each) => each.id === id);
    if (job?.state === state) return;
    if (Date.now() > end) throw new Error(`job ${id} is ${job?.state}, not ${state}`);
    await Bun.sleep(5);
  }
}

test("a job runs in a pane of its own, and that pane's exit ends it", async () => {
  fake = await start({ [ORIGIN]: {} });
  expect(await fake.app.serve("queue.add", { command: "make deploy", name: "deploy" })).toBe(1);
  expect(terminals()).toEqual([{ command: "make deploy" }]);
  const [job] = await jobs();
  expect(job).toMatchObject({ id: 1, command: "make deploy", name: "deploy", state: "running", run: "new", bar: ORIGIN });
  // Its output stays for the user when it is over.
  expect(fake.app.called("option.set")).toContainEqual(["remain_on_exit", true, { pane: job.pane }]);

  // Its program exits with 0: the job is done, and the user is told.
  fake.says(job.pane, { dead: true, deadStatus: 0 });
  await fake.changed(job.pane, "pane_dead");
  expect(await jobs()).toMatchObject([{ state: "done", status: 0 }]);
  expect(fake.app.notices.at(-1)!.level).toBe("info");
  expect(fake.app.notices.at(-1)!.msg.startsWith("queue: deploy ✓ 0:0")).toBe(true);

  // queue.clear forgets it, and closes the pane it opened.
  expect(await fake.app.serve("queue.clear")).toBe(1);
  expect(await jobs()).toEqual([]);
  expect(fake.opened.has(job.pane)).toBe(false);
});

test("a job whose program exits with a status says so", async () => {
  fake = await start({ [ORIGIN]: {}, 5: { foreground: 51, pid: 50 } });
  await fake.app.serve("queue.add", { command: "make test", run: "pane:%5" });
  fake.says(5, { dead: true, deadStatus: 2 });
  await fake.changed(5, "pane_dead");
  expect((await jobs())[0]).toMatchObject({ state: "done", status: 2, detail: "exit 2 · 0:00" });
  expect(fake.app.notices.at(-1)!.level).toBe("warn");
  expect(fake.app.notices.at(-1)!.msg.startsWith("queue: make test exited 2 after 0:0")).toBe(true);
});

test("a pane that cannot be typed into leaves the job failed", async () => {
  fake = await start({ [ORIGIN]: {}, 7: { foreground: 71, pid: 70 } });
  fake.app.answer("pane.call", () => {
    throw new Error("no such pane");
  });
  await fake.app.serve("queue.add", { command: "x", run: "pane:%7" });
  expect((await jobs())[0]).toMatchObject({ state: "failed", detail: "%7: no such pane" });
});

test("one at a time, in the order they were added, each after its pane is done", async () => {
  // Both panes are working.
  fake = await start({ 1: { foreground: 12, pid: 11 }, 2: { foreground: 22, pid: 21 } });
  await fake.app.serve("queue.add", { command: "cargo test", after: "%1" });
  await fake.app.serve("queue.add", { command: "make deploy", after: "%2" });
  expect(terminals()).toEqual([]); // nothing runs while the panes it waits for work
  expect((await jobs()).map((job) => job.detail)).toEqual(["after %1 · done", "after %2 · done"]);

  // Pane 1's shell is back: the first job runs, and the second waits for it.
  fake.says(1, { foreground: 11 });
  await fake.changed(1);
  expect(terminals()).toEqual([{ command: "cargo test" }]);
  const [first] = await jobs();
  expect(first).toMatchObject({ state: "running" });
  expect((await jobs())[1]).toMatchObject({ state: "waiting", detail: "after %2 · done" });

  // Pane 2 is done too, but one job at a time: the second still waits.
  fake.says(2, { foreground: 21 });
  await fake.changed(2);
  expect(terminals()).toEqual([{ command: "cargo test" }]);

  // The first job's pane exits: the second starts.
  fake.says(first.pane, { dead: true, deadStatus: 0 });
  await fake.changed(first.pane, "pane_dead");
  expect((await jobs()).map((job) => job.state)).toEqual(["done", "running"]);
  expect(terminals()).toEqual([{ command: "cargo test" }, { command: "make deploy" }]);
});

test("a job typed into a terminal is armed, and over when its shell is back", async () => {
  fake = await start({ 5: { foreground: null, pid: 50 } });
  await fake.app.serve("queue.add", { command: "true", run: "pane:%5" });
  expect(fake.app.called("pane.call")).toEqual([[5, "input", { text: "true\r" }]]);
  expect((await jobs())[0]).toMatchObject({ state: "running", pane: 5, run: "%5" });

  // At rest straight away: the shell has not started it yet, so it is not done.
  fake.says(5, { foreground: 50 });
  await fake.changed(5);
  expect((await jobs())[0].state).toBe("running");

  // Seen busy: from now on, at rest means done.
  fake.says(5, { foreground: 51 });
  await fake.changed(5);
  expect((await jobs())[0].state).toBe("running");
  fake.says(5, { foreground: 50 });
  await fake.changed(5);
  expect((await jobs())[0]).toMatchObject({ state: "done", detail: "closed · 0:00" });
});

test("a job that has not started can be cancelled, and nothing else can", async () => {
  fake = await start({ 1: { foreground: 12, pid: 11 } });
  await fake.app.serve("queue.add", { command: "a", after: "%1" });
  await fake.app.serve("queue.add", { command: "b", after: "%1" });
  expect(terminals()).toEqual([]);

  expect(await fake.app.serve("queue.cancel", { id: 2 })).toBe(true);
  expect(await jobs()).toMatchObject([{ state: "waiting" }, { state: "cancelled", detail: "cancelled" }]);
  await expect(fake.app.serve("queue.cancel", { id: 2 })).rejects.toMatchObject({
    kind: "invalid_params",
    message: "job 2 is not waiting",
  });
  await expect(fake.app.serve("queue.cancel", {})).rejects.toMatchObject({ message: "queue.cancel needs an `id`" });
  // A pane is written either way, as `after` and `run` are.
  expect(await fake.app.serve("queue.cancel", "%1")).toBe(true);
  expect((await jobs()).map((job) => job.state)).toEqual(["cancelled", "cancelled"]);
});

test("a job whose pane closed is free to run, and one naming a pane that is not there is refused", async () => {
  fake = await start({ 1: { foreground: 12, pid: 11 }, [ORIGIN]: {} });
  await expect(fake.app.serve("queue.add", { command: "x", after: "%4" })).rejects.toMatchObject({
    kind: "not_found",
    message: "no pane %4",
  });
  await fake.app.serve("queue.add", { command: "deploy", after: "%1" });
  expect(terminals()).toEqual([]);

  // The pane it waits for closes: what it was doing is over.
  await fake.app.fire("pane.closed", { pane: 1, type: "terminal" }, { match: "local.terminal", pane: 1 });
  expect((await jobs())[0]).toMatchObject({ state: "running", after: null, bar: ORIGIN });
  expect(terminals()).toEqual([{ command: "deploy" }]);
});

test("a job in the app runs sh -c, keeps its last line, and says it is over", async () => {
  fake = await start({});
  await fake.app.serve("queue.add", { command: "echo hello", run: "shell" });
  expect((await jobs())[0]).toMatchObject({ state: "running", run: "shell", pane: null });
  await untilJob(1, "done");
  expect((await jobs())[0]).toMatchObject({ status: 0, tail: "hello" });
  expect(fake.app.notices[0].level).toBe("info");
  expect(fake.app.notices[0].msg.startsWith("queue: echo hello ✓ 0:0")).toBe(true);
  expect(terminals()).toEqual([]); // headless: it opened nothing
});

test("queue.notify off: a job that is over says nothing", async () => {
  fake = await start({ [ORIGIN]: {} }, { notify: false });
  await fake.app.serve("queue.add", { command: "echo hello", run: "shell" });
  await untilJob(1, "done");
  expect(fake.app.notices).toEqual([]);
});

test("a bar goes under each pane that has work, as tall as its jobs", async () => {
  fake = await start({ [ORIGIN]: {}, 5: { foreground: 51, pid: 50 } });
  await fake.app.serve("queue.add", { command: "one", run: "pane:%5" });
  expect(bars()).toEqual([
    ["local.queue.board", { pane: ORIGIN }, { kind: "slot", slot: "winbar.bottom", owner: ORIGIN, order: 10, focus: false }],
  ]);
  // Its title and a row a job.
  const bar = [...fake.opened].find(([, pane]) => pane.type === "local.queue.board")![0];
  expect(fake.app.called("option.set")).toContainEqual(["@rows", 2, { pane: bar }]);

  // Two jobs for one pane: its title and two rows, but `queue.rows` is the cap.
  fake = await start({ [ORIGIN]: {}, 5: { foreground: 51, pid: 50 }, 6: { foreground: 61, pid: 60 } }, { rows: 2 });
  await fake.app.serve("queue.add", { command: "one", run: "pane:%5" });
  await fake.app.serve("queue.add", { command: "two", run: "pane:%6" });
  expect(fake.app.called("option.set").filter((args) => args[0] === "@rows").at(-1)![1]).toBe(2);

  // A bar left somewhere else (an older version's) is nobody's now.
  fake.opened.set(777, { type: "local.queue.board", place: { kind: "tiled" } });
  expect(await fake.app.serve("queue.cancel", { id: 2 })).toBe(true);
  expect(fake.opened.has(777)).toBe(false);
  expect((await jobs()).map((job) => job.state)).toEqual(["running", "cancelled"]);
});
