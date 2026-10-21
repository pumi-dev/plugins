// The package against pumi/testing's fake app: no pumi running. `pane.list` and `@agent_status`
// are answered from what the test says the panes are.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");
let app: FakeApp;
afterEach(() => app?.stop());

/** Starts the package on panes 1, 2, 3, each with the agent state `states` gives it. */
async function start(states: Record<number, string>, options: Record<string, unknown> = {}): Promise<FakeApp> {
  const started = await FakeApp.start({ dir, main: "src/main.ts", options });
  started.answer("pane.list", Object.keys(states).map(Number));
  started.answer("option.get", (name: string, at?: { pane?: number }) =>
    name === "@agent_status" ? (states[at?.pane ?? 0] ?? null) : (started.options.get(name) ?? null),
  );
  app = started;
  return started;
}

/** What the app does when an agent reports itself: `@agent_status` changed on its pane. */
async function reported(pane: number) {
  await app.fire("option.changed", { name: "@agent_status" }, { match: "@agent_status", pane });
}

test("a blocked agent is counted, said once, and kept in @attention", async () => {
  await start({ 1: "working", 2: "blocked", 3: "idle" });
  await reported(2);
  expect(app.notices).toEqual([{ msg: "An agent is waiting for you", level: "warn" }]);
  expect(app.options.get("@attention")).toBe(1);
  expect(app.called("option.set").at(-1)).toEqual(["@attention", 1, {}]);
});

test("more waiting say so again; a count that does not go up does not", async () => {
  const states = { 1: "working", 2: "blocked", 3: "working" };
  await start(states);
  await reported(2);
  // The same state reported again is not more waiting.
  await reported(2);
  expect(app.notices).toHaveLength(1);
  states[1] = "blocked";
  await reported(1);
  expect(app.notices.at(-1)).toEqual({ msg: "2 agents are waiting for you", level: "warn" });
  expect(app.options.get("@attention")).toBe(2);
});

test("@attention clears when nothing waits, and a fresh block says so again", async () => {
  const states = { 1: "blocked", 2: "working" };
  await start(states);
  await reported(1);
  states[1] = "working";
  await reported(1);
  expect(app.options.get("@attention")).toBeNull();
  expect(app.notices).toHaveLength(1);
  states[2] = "blocked";
  await reported(2);
  expect(app.notices).toHaveLength(2);
});

test("bounce none keeps @attention but says nothing", async () => {
  await start({ 1: "blocked" }, { bounce: "none" });
  await reported(1);
  expect(app.notices).toEqual([]);
  expect(app.options.get("@attention")).toBe(1);
});

test("a closed pane is counted again", async () => {
  const states: Record<number, string> = { 1: "blocked", 2: "blocked" };
  await start(states);
  await reported(1);
  expect(app.options.get("@attention")).toBe(2);
  delete states[2];
  app.answer("pane.list", [1]);
  await app.fire("pane.closed", { pane: 2 }, { match: "local.terminal" });
  expect(app.options.get("@attention")).toBe(1);
  expect(app.notices).toHaveLength(1);
});

test("two agents blocked at once say it once", async () => {
  const states: Record<number, string> = { 1: "working", 2: "working" };
  await start(states);
  // Both panes report in the same turn: two events before the first look is done.
  states[1] = "blocked";
  states[2] = "blocked";
  await Promise.all([reported(1), reported(2)]);
  expect(app.notices).toEqual([{ msg: "2 agents are waiting for you", level: "warn" }]);
  expect(app.options.get("@attention")).toBe(2);
});
