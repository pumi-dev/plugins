// What an agent is told: the guide once, only what changed after, and nothing when nothing did
// (core/agents/src/context/mod.rs `compose`), and the map it is told it with.
import { expect, test } from "bun:test";

import { compose, DEFAULTS, GUIDE, map, onFor, switches } from "../src/context.ts";
import { read } from "../src/snapshot.ts";
import { EMPTY } from "../src/snapshot.ts";
import { state } from "./fake.ts";

const PANES = "<pumi-panes>\na\n</pumi-panes>\n";

test("the guide is the template the core ships", () => {
  expect(GUIDE.startsWith("<pumi>")).toBe(true);
  expect(GUIDE).toContain("never type into your own pane");
  expect(GUIDE).toContain("<pumi-panes>");
});

test("an agent is told once, then only what changed", () => {
  const first = compose("prompt", false, undefined, "a\n", "changes")!;
  expect(first.startsWith(GUIDE) && first.includes(PANES)).toBe(true);
  expect(compose("prompt", false, "a\n", "a\n", "changes")).toBeNull();
  const changed = compose("prompt", false, "a\n", "b\n", "changes")!;
  expect(changed.startsWith("<pumi-panes-changed>") && !changed.includes(GUIDE)).toBe(true);
  expect(compose("prompt", false, "a\n", "b\n", "start")).toBeNull();
});

test("a session that starts again hears the whole thing, unless it is resumed", () => {
  expect(compose("start", true, "b\n", "b\n", "changes")).toBeNull();
  expect(compose("start", false, "a\n", "a\n", "changes")).not.toBeNull();
  expect(compose("full", false, "a\n", "a\n", "start")).not.toBeNull();
});

test("the map names every space, tab and pane with the ids pumi takes", () => {
  const said = map(read(state()), { otherSessions: true, space: 1 });
  expect(said.split("\n")).toEqual([
    "$1 pumi (current)",
    "  @10 Tab 1",
    "    %100 zsh — /Users/me/Kitchen/pumi",
    "  @11 editor",
    "    %101 π - claude — /Users/me/Kitchen/pumi — working",
    "    %102 vim — /Users/me/Kitchen/pumi/src",
    "$2 site",
    "  @20 Tab 1",
    "    %200 π - site — /Users/me/work/site — blocked",
    "",
  ]);
});

test("other sessions stay out of the map when the option is off", () => {
  const said = map(read(state()), { otherSessions: false, space: 1 });
  expect(said).not.toContain("$2");
  expect(said).toContain("%101");
});

test("an agent is told only when the master switch and its own are on", () => {
  const off = { ...DEFAULTS, targets: {} };
  expect(onFor("claude", off)).toBe(false);
  const on = { ...off, targets: { claude: true } };
  expect(onFor("claude", on)).toBe(true);
  expect(onFor("pi", on)).toBe(false);
  expect(onFor("claude", { ...on, context: false })).toBe(false);
});

test("a targets table keeps only what says a boolean", () => {
  expect(switches({ claude: true, pi: false, codex: "yes", nope: null })).toEqual({ claude: true, pi: false });
  expect(switches(null)).toEqual({});
});

test("an empty pumi still writes a map", () => {
  expect(map(EMPTY, { otherSessions: true, space: null })).toBe("\n");
});
