// A job and its waits, on their own: no app, and the pane's facts as the test says they are
// (`Facts` is what a pane reports of itself, which the queue only reads).
import { expect, test } from "bun:test";
import {
  Armed,
  clock,
  detail,
  firstLine,
  holds,
  home,
  paneId,
  parseJob,
  shown,
  type Facts,
  type Job,
} from "../src/job.ts";

/** What a pane says of itself; nothing unless a test says it. */
const facts = (said: Partial<Facts> = {}): Facts => ({ dead: false, agent: null, atRest: false, ...said });

test("a bare command is a job", () => {
  const job = parseJob(1, "make test", 0, 5);
  expect(job.command).toBe("make test");
  expect(job.label).toBe("make test");
  expect(job.after).toBeNull(); // no wait: it is the queue's order that holds it
  expect(job.run).toEqual({ kind: "new" });
  expect(job.state).toEqual({ kind: "waiting" });
  expect(home(job)).toBe(5); // the pane whose caller added it
});

test("a table says what it waits for and where it runs", () => {
  const job = parseJob(2, { command: "cargo test", after: "%3", run: "pane:%7", name: "tests" }, 0, 9);
  expect(job.after).toEqual({ pane: 3, on: "done" });
  expect(job.run).toEqual({ kind: "pane", pane: 7 });
  expect(job.label).toBe("tests");
  expect(home(job)).toBe(3); // the pane it waits for

  expect(parseJob(3, { command: "x", after: { pane: 4, on: "exit" } }, 0, 9).after).toEqual({ pane: 4, on: "exit" });
  expect(parseJob(4, { command: "x", run: "shell" }, 0, 9).run).toEqual({ kind: "shell" });
  expect(parseJob(5, { command: "x", cwd: "/tmp" }, 0, 9).cwd).toBe("/tmp");
});

test("a wait needs a pane and a known word", () => {
  expect(() => parseJob(1, { command: "x", after: "later" }, 0, 9)).toThrow("`after` needs a pane");
  expect(() => parseJob(1, { command: "x", after: { pane: 3, on: "soon" } }, 0, 9)).toThrow("no wait `soon`");
  expect(() => parseJob(1, { run: "new" }, 0, 9)).toThrow("needs a `command`");
  expect(() => parseJob(1, { command: "x", run: "somewhere" }, 0, 9)).toThrow("no place `somewhere`");
  expect(() => parseJob(1, { command: "x", run: ["sh"] }, 0, 9)).toThrow("is `new`, `shell` or a pane");
});

test("a pane is written either way", () => {
  expect(paneId("%12")).toBe(12);
  expect(paneId(12)).toBe(12);
  expect(paneId({ pane: 12 })).toBe(12);
  expect(paneId({ id: 12 })).toBe(12);
  expect(paneId("pi")).toBeNull();
  expect(paneId(null)).toBeNull();
});

test("a plain command in a shell is done when the shell is back", () => {
  const busy = facts({ atRest: false });
  const back = facts({ atRest: true });
  expect(holds(busy, "done")).toBe(false); // still running
  expect(holds(back, "done")).toBe(true);
  expect(holds(facts({ dead: true }), "idle")).toBe(true); // a program that exited is not running
});

test("an agent's turn ends on its own report", () => {
  const working = facts({ agent: "working" });
  const done = facts({ agent: "done" });
  const blocked = facts({ agent: "blocked" });
  expect(holds(working, "done")).toBe(false); // a working agent is not done
  expect(holds(blocked, "done")).toBe(false); // a blocked agent is waiting for a person
  expect(holds(done, "done")).toBe(true); // its turn ended, though it still has the terminal
  expect(holds(done, "idle")).toBe(false); // it is not back at a prompt
  expect(holds(facts({ agent: "blocked", dead: true }), "exit")).toBe(true);
});

test("a pane typed into is not done until it was busy or the grace passed", () => {
  const armed = new Armed();
  armed.stamp(3, 1_000);
  expect(armed.held(3)).toBe(true);
  // Still at rest straight away: the shell has not started it yet.
  armed.observe(3, true, 1_100);
  expect(armed.held(3)).toBe(true);
  // Busy: from now on, at rest means done.
  armed.observe(3, false, 1_200);
  expect(armed.held(3)).toBe(false);

  // A command too quick to see (`true`): the grace settles it.
  const quick = new Armed();
  quick.stamp(4, 1_000);
  quick.observe(4, true, 1_000 + Armed.GRACE - 1);
  expect(quick.held(4)).toBe(true);
  quick.observe(4, true, 1_000 + Armed.GRACE);
  expect(quick.held(4)).toBe(false);
});

test("a clock reads like one", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(42_000)).toBe("0:42");
  expect(clock(60_000)).toBe("1:00");
  expect(clock(3_723_000)).toBe("1:02:03");
});

test("a label is the first line of the command", () => {
  expect(firstLine("make test\nmake run")).toBe("make test");
  expect(firstLine("x".repeat(200))).toHaveLength(72);
  expect(firstLine("x".repeat(200)).endsWith("…")).toBe(true);
});

test("a job says what it waits for, where it runs, and how it went", () => {
  const waiting = parseJob(1, { command: "cargo test", after: "%3" }, 0, 9);
  expect(detail(waiting, 0)).toBe("after %3 · done");
  expect(detail(parseJob(2, "next one", 0, 9), 0)).toBe("next");

  const running: Job = { ...waiting, state: { kind: "running", pane: 7, at: 0 } };
  expect(detail(running, 42_000)).toBe("in %7 · 0:42");
  expect(detail({ ...running, state: { kind: "running", pane: null, at: 0 } }, 1_000)).toBe("running · 0:01");

  expect(detail({ ...waiting, state: { kind: "done", status: 0, took: 3_000 } }, 0)).toBe("ok · 0:03");
  expect(detail({ ...waiting, state: { kind: "done", status: 2, took: 3_000 } }, 0)).toBe("exit 2 · 0:03");
  expect(detail({ ...waiting, state: { kind: "done", status: null, took: 0 } }, 0)).toBe("closed · 0:00");
  expect(detail({ ...waiting, state: { kind: "failed", why: "no pane %9\nthe rest" } }, 0)).toBe("no pane %9");
  expect(detail({ ...waiting, state: { kind: "cancelled" } }, 0)).toBe("cancelled");
});

test("a job that is over stays in its bar a little longer", () => {
  const job: Job = { ...parseJob(1, "x", 0, 9), state: { kind: "done", status: 0, took: 0 }, ended: 1_000 };
  expect(shown(job, 1_000)).toBe(true);
  expect(shown(job, 10_999)).toBe(true);
  expect(shown(job, 11_000)).toBe(false);
  expect(shown({ ...job, state: { kind: "waiting" } }, 999_999)).toBe(true);
});
