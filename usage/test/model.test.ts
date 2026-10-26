// The words the panel uses: a window's share, when it resets, how it is pacing, and how
// urgent it is at the shares the user chose.

import { describe, expect, test } from "bun:test";

import {
  DAY,
  HOUR,
  MINUTE,
  SESSION,
  WEEK,
  ago,
  ahead,
  band,
  clock,
  countdown,
  describeWindows,
  expected,
  left,
  percent,
  resetText,
  tightest,
  type Window,
} from "../src/model.ts";

const window = (used: number, over: Partial<Window> = {}): Window => ({ kind: "session", title: "Session", used, ...over });

test("a share is a percentage from 0 to 100, whatever arrives", () => {
  expect(percent(42)).toBe(42);
  expect(percent(-3)).toBe(0);
  expect(percent(120)).toBe(100);
  expect(percent(Number.NaN)).toBe(0);
  expect(left(37)).toBe(63);
});

test("the tightest window wins, and a tie keeps the service's order", () => {
  expect(tightest([])).toBeUndefined();
  expect(tightest(undefined)).toBeUndefined();
  const session = window(10, { title: "Session" });
  const weekly = window(80, { kind: "weekly", title: "Weekly" });
  expect(tightest([session, weekly])).toBe(weekly);
  expect(tightest([window(50, { title: "A" }), window(50, { title: "B" })])?.title).toBe("A");
});

test("a countdown says the biggest useful unit, and rounds minutes", () => {
  expect(countdown(-5)).toBe("now");
  expect(countdown(0)).toBe("now");
  expect(countdown(20 * 1000)).toBe("<1m");
  expect(countdown(1 * MINUTE)).toBe("1m");
  expect(countdown(42 * MINUTE)).toBe("42m");
  expect(countdown(2 * HOUR)).toBe("2h");
  expect(countdown(2 * HOUR + 53 * MINUTE)).toBe("2h 53m");
  expect(countdown(6 * DAY)).toBe("6d");
  expect(countdown(6 * DAY + 4 * HOUR)).toBe("6d 4h");
});

test("a clock names the local time, and the day when it is not today", () => {
  const now = new Date(2026, 1, 19, 9, 30).getTime();
  const at = (hours: number, days = 0) => new Date(2026, 1, 19 + days, hours, 0).getTime();
  expect(clock(at(14), now)).toBe("14:00");
  expect(clock(at(9, 1), now)).toBe("tomorrow 09:00");
  expect(clock(at(9, 3), now)).toBe("Sun 09:00");
  expect(clock(at(9, 20), now)).toBe("Mar 11");
});

test("a reset is said as the setting asks, or not at all", () => {
  const now = 1_000_000_000_000;
  const w = window(40, { resetsAt: now + 2 * HOUR + 53 * MINUTE });
  expect(resetText(w, now, "countdown")).toBe("2h 53m");
  expect(resetText(w, now, "off")).toBeUndefined();
  expect(resetText(window(40), now, "countdown")).toBeUndefined();
  expect(resetText(w, now, "clock")).toBe(clock(w.resetsAt!, now));
});

test("a window's pace is how much of its length has gone by", () => {
  const now = 10 * HOUR;
  const half = window(40, { length: SESSION, resetsAt: now + SESSION / 2 });
  expect(expected(half, now)).toBeCloseTo(50, 5);
  expect(ahead(half, now)).toBe(false);
  expect(ahead(window(60, { length: SESSION, resetsAt: now + SESSION / 2 }), now)).toBe(true);
  expect(expected(window(40), now)).toBeUndefined();
  // A window already past its reset has gone by entirely, rather than more than that.
  expect(expected(window(40, { length: WEEK, resetsAt: now - HOUR }), now)).toBe(100);
});

test("urgency follows the shares the user chose", () => {
  expect(band(0, 70, 90)).toBe("normal");
  expect(band(69.9, 70, 90)).toBe("normal");
  expect(band(70, 70, 90)).toBe("warning");
  expect(band(90, 70, 90)).toBe("critical");
  expect(band(100, 70, 90)).toBe("critical");
});

test("how long ago a read was, in the same words", () => {
  const now = 100 * MINUTE;
  expect(ago(undefined, now)).toBe("never");
  expect(ago(now - 30 * 1000, now)).toBe("just now");
  expect(ago(now - 3 * MINUTE, now)).toBe("3m ago");
  expect(ago(now + MINUTE, now)).toBe("just now");
});

test("each window is named with its share and its reset", () => {
  const now = 0;
  const lines = describeWindows(
    {
      provider: "claude",
      name: "Claude",
      account: {},
      windows: [window(42, { resetsAt: 2 * HOUR }), window(12.4, { kind: "weekly", title: "Weekly", resetsAt: 6 * DAY })],
    },
    now,
    "countdown",
  );
  expect(lines).toEqual(["Session: 42% used, resets in 2h", "Weekly: 12% used, resets in 6d"]);
  expect(describeWindows(undefined, now, "countdown")).toEqual([]);
});
