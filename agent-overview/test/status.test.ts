// The five states of the protocol, what they are called, and how they sort.
import { expect, test } from "bun:test";
import {
  FILTERS,
  filterLabel,
  filterMatches,
  needsYou,
  parseStatus,
  rank,
  STATUSES,
  statusLabel,
  type Status,
} from "../src/status.ts";

/** Every status there is, `unknown` last: the legend's order, then the one no program reports. */
const ALL: Status[] = [...STATUSES, "unknown"];

test("only the protocol's five words are statuses", () => {
  expect(STATUSES.map(parseStatus)).toEqual(["working", "blocked", "error", "done", "idle"]);
  expect(parseStatus("unknown")).toBeNull();
  expect(parseStatus("")).toBeNull();
  expect(parseStatus(undefined)).toBeNull();
});

test("a card calls the states by their words", () => {
  expect(STATUSES.map(statusLabel)).toEqual(["Working", "Blocked", "Failed", "Done", "Idle"]);
  expect(statusLabel("unknown")).toBe("Unknown");
});

test("what wants the user sorts first", () => {
  expect([...ALL].sort((a, b) => rank(a) - rank(b))).toEqual([
    "blocked",
    "error",
    "working",
    "done",
    "idle",
    "unknown",
  ]);
  expect(STATUSES.filter(needsYou)).toEqual(["blocked", "error"]);
});

test("the four filters narrow by state", () => {
  expect(FILTERS.map(filterLabel)).toEqual(["Overview", "Needs you", "Working", "Idle"]);
  const through = (filter: (typeof FILTERS)[number]) => ALL.filter((status) => filterMatches(filter, status));
  expect(through("all")).toEqual(ALL);
  expect(through("needs-you")).toEqual(["blocked", "error"]);
  expect(through("working")).toEqual(["working"]);
  // Done and idle are both quiet.
  expect(through("idle")).toEqual(["done", "idle"]);
});
