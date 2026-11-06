// What an agent is told: the guide once, only what changed after, and nothing when nothing did,
// and the map it is told it with — every session, view, pane and tab, with the ids pumi takes.
import { expect, test } from "bun:test";

import { compose, DEFAULTS, GUIDE, map, onFor, switches } from "../src/context.ts";
import { read, EMPTY } from "../src/snapshot.ts";
import { sessions } from "./fake.ts";

const PANES = "<pumi-panes>\na\n</pumi-panes>\n";
const all = () => read(sessions(), 1);
const mine = (here: number | null = 1, otherSessions = true) => map(all(), { otherSessions, session: here });

test("the guide is the template the core ships", () => {
  expect(GUIDE.startsWith("<pumi>")).toBe(true);
  expect(GUIDE).toContain("never type into your own tab");
  expect(GUIDE).toContain("<pumi-panes>");
});

test("the map names every session, view, pane and tab with the ids pumi takes", () => {
  expect(mine().split("\n")).toEqual([
    "$1 pumi (current)",
    "  @1 main (current)",
    "    :4",
    "      %10 zsh — /Users/me/Kitchen/pumi",
    "    :5 (focused)",
    "      %11 π - claude — /Users/me/Kitchen/pumi — working (current)",
    "      %12 vim — /Users/me/Kitchen/pumi/src",
    "    (floating)",
    "      %13 notes — /Users/me/tmp",
    "  @2 logs",
    "    :6 (zoomed)",
    "      %14 tail — /var/log",
    "$2 site",
    "  @3",
    "    :7",
    "      %20 π - site — /Users/me/work/site — blocked",
    "",
  ]);
});

test("the map marks where the user is, even when the agent is elsewhere", () => {
  // The agent is in `$2`; the user is in `$1`, which is what the markers say.
  const said = map(all(), { otherSessions: true, session: 2, current: 1 });
  expect(said.split("\n")[0]).toBe("$1 pumi (current)");
  expect(said).toContain("    :5 (focused)");
  expect(said).toContain("$2 site\n");
});

test("other sessions stay out of the map when the option is off", () => {
  const said = mine(1, false);
  expect(said).not.toContain("$2");
  expect(said).toContain("%11");
});

test("a map of nothing is a newline", () => {
  expect(map(EMPTY, { otherSessions: true, session: null })).toBe("\n");
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

test("an agent is told unless it is turned off, and never with the master switch off", () => {
  expect(onFor("claude", DEFAULTS)).toBe(true);
  const off = { ...DEFAULTS, targets: { codex: false } };
  expect(onFor("codex", off)).toBe(false);
  expect(onFor("claude", off)).toBe(true);
  expect(onFor("claude", { ...DEFAULTS, targets: { claude: true } })).toBe(true);
  expect(onFor("claude", { ...DEFAULTS, context: false })).toBe(false);
});

test("a targets table keeps only what says a boolean", () => {
  expect(switches({ claude: true, pi: false, codex: "yes", nope: null })).toEqual({ claude: true, pi: false });
  expect(switches(null)).toEqual({});
});
