// The rule, on its own: which states are said, what the notice says, and when it is news. The
// app's side of it — reading every tab's `@status` and posting the notice — is main.ts.
import { expect, test } from "bun:test";
import { headline, isStatus, level, news, urgency, wanted, where, who } from "../src/notice.ts";

test("the states with news in them are blocked, done and error", () => {
  for (const word of ["blocked", "done", "error"]) expect(isStatus(word)).toBe(true);
  for (const word of ["working", "idle", "", "running", "Blocked"]) expect(isStatus(word)).toBe(false);
});

test("each switch says for its own state, and none of the others", () => {
  const off = { blocked: false, done: false, error: false };
  const on = { blocked: true, done: true, error: true };
  const only = { blocked: false, done: true, error: false };
  expect(wanted("blocked", off)).toBe(false);
  expect(wanted("blocked", on)).toBe(true);
  expect(wanted("done", only)).toBe(true);
  expect(wanted("blocked", only)).toBe(false);
  expect(wanted("error", only)).toBe(false);
});

test("an agent is called by its name, and pi is pi", () => {
  expect(who("claude")).toBe("Claude");
  expect(who("codex")).toBe("Codex");
  expect(who("pi")).toBe("pi");
  expect(who("PI")).toBe("pi");
  expect(who(" Droid ")).toBe("Droid");
  // A tab with no agent, or one whose name says nothing, is still someone.
  expect(who(null)).toBe("An agent");
  expect(who("")).toBe("An agent");
  expect(who("  ")).toBe("An agent");
});

test("the title says what happened to whom", () => {
  expect(headline("blocked", "claude")).toBe("Claude is waiting for you");
  expect(headline("done", "pi")).toBe("pi is done");
  expect(headline("error", null)).toBe("An agent failed");
});

test("a wait is the loudest a notice is; a finished turn is ordinary", () => {
  expect(urgency("blocked")).toBe("critical");
  expect(urgency("error")).toBe("critical");
  expect(urgency("done")).toBe("normal");
});

test("the level heads the notice: a failure an error, a wait a warning, a result plain", () => {
  expect(level("blocked")).toBe("warn");
  expect(level("error")).toBe("error");
  expect(level("done")).toBe("info");
});

test("the body is the tab's title, else its folder, else the tab", () => {
  expect(where(3, "π - Fixing the keymap - pumi", "/Users/amr/Kitchen/pumi")).toBe("π - Fixing the keymap - pumi");
  expect(where(3, "", "/Users/amr/Kitchen/pumi/")).toBe("pumi");
  expect(where(3, null, null)).toBe("Tab %3");
  expect(where(3, "  \n ", "")).toBe("Tab %3");
});

test("a title from a terminal starts on its first line that says something", () => {
  expect(where(3, "\n  ✳ Migrate billing webhooks  \nmore", null)).toBe("✳ Migrate billing webhooks");
});

test("a long title is cut to one line of a notice, not a paragraph", () => {
  const long = "x".repeat(400);
  const body = where(3, long, null);
  expect(body.length).toBe(140);
  expect(body.endsWith("…")).toBe(true);
});

test("a state is news when it is not the one just told, or the same one long after", () => {
  const quiet = 2000;
  const now = 10_000;
  expect(news("done", undefined, now, quiet)).toBe(true);
  expect(news("done", { status: "blocked", at: now - 1 }, now, quiet)).toBe(true);
  // The same state a moment later is the one still on the screen.
  expect(news("done", { status: "done", at: now - 1 }, now, quiet)).toBe(false);
  expect(news("done", { status: "done", at: now - quiet }, now, quiet)).toBe(true);
});
