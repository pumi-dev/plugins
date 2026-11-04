// The History panel's list: what a session is called, how long ago it was, and where it falls.
import { expect, test } from "bun:test";

import { ago, groups, items, matching, titleOf, where, type PastSession } from "../src/history.ts";

const session = (title: string, cwd: string, updatedAt: number, agent = "pi"): PastSession => ({
  agent,
  name: agent === "pi" ? "Pi" : "Claude Code",
  session: `${agent}-${title}`,
  title,
  cwd,
  updatedAt,
  engine: "pi",
});

test("a session's title: pumi's own preamble taken out, one line, short", () => {
  expect(titleOf('<pumi-context from="pumi_dev/agents"><pumi>You are in a tab.</pumi></pumi-context> fix the scroll buttons')).toBe("fix the scroll buttons");
  expect(titleOf("<pumi>context</pumi>\n\nmake the queue card look like this")).toBe("make the queue card look like this");
  expect(titleOf("<pumi-context>x</pumi-context>")).toBe("New Agent Thread");
  expect(titleOf("   ")).toBe("New Agent Thread");
  const long = "a".repeat(200);
  expect(titleOf(long)).toBe(`${"a".repeat(89)}…`);
});

test("how long ago, in the rows' words", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  expect(ago(now - 10_000, now)).toBe("now");
  expect(ago(now - 5 * 60_000, now)).toBe("5m");
  expect(ago(now - 2 * 3_600_000, now)).toBe("2h");
  expect(ago(now - 3 * 86_400_000, now)).toBe("3d");
  expect(ago(now - 10 * 86_400_000, now)).toBe("1w");
  expect(ago(now - 80 * 86_400_000, now)).toBe("3mo");
});

test("today, this past week, and older: the empty ones left out", () => {
  const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
  const at = (days: number) => now - days * 86_400_000;
  const rows = [session("today", "/a", now), session("yesterday", "/b", at(1)), session("last week", "/c", at(6)), session("older", "/d", at(30))];
  const shown = groups(rows, now);
  expect(shown.map((group) => [group.title, group.sessions.map((each) => each.title)])).toEqual([
    ["Today", ["today"]],
    ["Past Week", ["yesterday", "last week"]],
    ["Older", ["older"]],
  ]);
  expect(groups([session("today", "/a", now)], now).map((group) => group.title)).toEqual(["Today"]);
  expect(groups([session("older", "/a", at(30))], now).map((group) => group.title)).toEqual(["Older"]);
});

test("a search keeps what has every word of it, in the title, the directory or the agent", () => {
  const rows = [session("fix the scroll buttons", "/work/pumi", 0, "pi"), session("queue card", "/work/mpx", 0, "claude")];
  expect(matching(rows, "")).toHaveLength(2);
  expect(matching(rows, "scroll").map((each) => each.title)).toEqual(["fix the scroll buttons"]);
  expect(matching(rows, "WORK queue").map((each) => each.title)).toEqual(["queue card"]);
  expect(matching(rows, "claude").map((each) => each.title)).toEqual(["queue card"]);
  expect(matching(rows, "nothing")).toEqual([]);
});

test("a row says where it ran by the last name of its directory", () => {
  expect(where("/work/pumi")).toBe("pumi");
  expect(where("/work")).toBe("work");
  expect(where("/")).toBe("/");
});

test("the groups as the list holds them: one flat run, each group's name before its rows", () => {
  const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
  const rows = [session("today", "/a", now), session("older", "/b", now - 30 * 86_400_000, "claude")];
  const flat = items(groups(rows, now));
  expect(flat.map((item) => (item.kind === "group" ? `# ${item.title}` : item.session.title))).toEqual(["# Today", "today", "# Older", "older"]);
  // Every item has a key of its own: a list draws them by it.
  expect(new Set(flat.map((item) => item.key)).size).toBe(flat.length);
});
