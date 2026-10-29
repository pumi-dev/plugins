// The rule, on its own: what counts as waiting, and when that is said. The
// app's side of it — reading every tab's `@status` and posting the notice — is main.ts.
import { expect, test } from "bun:test";
import { count, said } from "../src/count.ts";

test("a blocked agent counts; working, done, idle and no report do not", () => {
  expect(count(["blocked", "working", "blocked", "done", "idle", "error", null, undefined])).toBe(2);
  expect(count([])).toBe(0);
});

test("more waiting say so; a count that does not go up says nothing", () => {
  expect(said(0, 1)).toBe("An agent is waiting for you");
  expect(said(1, 2)).toBe("2 agents are waiting for you");
  // The same count reported again is not more waiting, and neither is one that went down.
  expect(said(2, 2)).toBeNull();
  expect(said(2, 1)).toBeNull();
  expect(said(0, 0)).toBeNull();
});

test("a count that cleared and blocked again says so again", () => {
  expect(said(1, 0)).toBeNull();
  expect(said(0, 1)).toBe("An agent is waiting for you");
});
