import { expect, test } from "bun:test";
import { BESIDE, claims, opening } from "../src/open.ts";

test("open from the + menu goes where the menu says, beside its tab", () => {
  expect(opening({ tab: "%3", place: { kind: "tiled", pane: ":2" } })).toEqual({ args: {}, place: { kind: "tiled", pane: ":2" } });
  expect(opening({ tab: "%3", place: { kind: "tiled", split: "down" } })).toEqual({ args: {}, place: { kind: "tiled", split: "down", beside: "%3" } });
});

test("open from a call takes the launch and nothing else", () => {
  expect(opening(undefined)).toEqual({ args: {}, place: { ...BESIDE } });
  expect(opening({ command: ["make"], cwd: "/src", url: "x" })).toEqual({ args: { command: ["make"], cwd: "/src" }, place: { ...BESIDE } });
});

test("the first run claims new tabs only while nothing is chosen", () => {
  expect(claims("", false)).toBe(true);
  expect(claims(null, null)).toBe(true);
  expect(claims("", true)).toBe(false);
  expect(claims("pumi_dev.agents.chat", false)).toBe(false);
});
