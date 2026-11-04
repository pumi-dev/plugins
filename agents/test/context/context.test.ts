// What an agent is told: the guide once, only what changed after, and nothing when nothing did,
// and the map it is told it with — every session, view, pane and tab, with the ids pumi takes.
import { expect, test } from "bun:test";

import { blockLines, listed } from "../../src/context/blocks.ts";
import { compose, DEFAULTS, fill, frame, GUIDE, map, place, settingsOf, type Now } from "../../src/context/context.ts";
import { read, EMPTY } from "../../src/context/snapshot.ts";
import { sessions } from "./fake.ts";

const NOW: Now = { place: "tab %11, pane :5, view @1, session $1", tabs: "a\n", blocks: "- file: a file\n" };
const all = () => read(sessions(), 1);
const mine = (here: number | null = 1, otherSessions = true) => map(all(), { otherSessions, session: here });

test("the guide is a template for where the agent is, the tabs, and the blocks", () => {
  expect(GUIDE).toContain("You are in {place} of pumi");
  expect(GUIDE).toContain("`pumi help`");
  expect(GUIDE).toContain("The tabs around you:\n\n{tabs}\n");
  expect(GUIDE).toContain("block types:\n\n{blocks}\n");
  expect(GUIDE).toContain("Never type into your own tab");
});

test("the map names every session, view, pane and tab with the ids pumi takes", () => {
  expect(mine().split("\n")).toEqual([
    "$1 pumi (current)",
    "  @1 main (current)",
    "    :4",
    "      - %10, zsh",
    "    :5 (focused)",
    "      - %11, π - claude — working (current)",
    "      - %12, vim",
    "    (floating)",
    "      - %13, notes",
    "  @2 logs",
    "    :6 (zoomed)",
    "      - %14, tail",
    "$2 site",
    "  @3",
    "    :7",
    "      - %20, π - site — blocked",
    "",
  ]);
});

test("the tab the agent is in says so", () => {
  expect(mine()).not.toContain("(you)");
  const said = map(all(), { otherSessions: true, session: 1, you: 12 });
  expect(said).toContain("      - %12, vim (you)\n");
  // Told twice, the one mark holds both.
  const both = map(all(), { otherSessions: true, session: 1, you: 11 });
  expect(both).toContain("      - %11, π - claude — working (you, current)\n");
});

test("where an agent is, is its tab, pane, view and session", () => {
  const said = read(sessions(), 1);
  const find = (id: number) => said.tabs.find((tab) => tab.id === id);
  expect(place(find(11))).toBe("tab %11, pane :5, view @1, session $1");
  // A float is in no pane.
  expect(place(find(13))).toBe("tab %13, floating over view @1, session $1");
  expect(place(undefined)).toBe("a tab");
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

test("the guide is filled in where it asks to be", () => {
  const said = fill(NOW);
  expect(said.startsWith("You are in tab %11, pane :5, view @1, session $1 of pumi.")).toBe(true);
  expect(said).toContain("The tabs around you:\n\na\n");
  expect(said).toContain("block types:\n\n- file: a file\n\n");
  expect(said).not.toContain("{");
});

test("an agent is told once, then only what changed", () => {
  const first = compose("start", false, undefined, NOW, "changes")!;
  expect(first.startsWith("You are in") && first.includes("- file: a file")).toBe(true);
  expect(compose("prompt", false, undefined, NOW, "changes")).not.toBeNull();
  expect(compose("prompt", false, "a\n", NOW, "changes")).toBeNull();
  const changed = compose("prompt", false, "b\n", NOW, "changes")!;
  // Only the tabs come again: the block types were told with the guide.
  expect(changed.startsWith("<pumi-panes-changed>") && !changed.includes("block types")).toBe(true);
  expect(changed).toContain("a\n");
  expect(compose("prompt", false, "b\n", NOW, "start")).toBeNull();
});

test("a session that starts again hears the whole thing, unless it is resumed", () => {
  expect(compose("start", true, "b\n", NOW, "changes")).toBeNull();
  expect(compose("start", false, "a\n", NOW, "changes")).not.toBeNull();
  expect(compose("full", false, "a\n", NOW, "start")).not.toBeNull();
});

test("the settings are the options' values, each one its default when it is not one", () => {
  expect(settingsOf(null, null, null)).toEqual(DEFAULTS);
  expect(settingsOf(false, "start", false)).toEqual({ context: false, updates: "start", otherSessions: false });
  expect(settingsOf("yes", "sometimes", 1)).toEqual(DEFAULTS);
});

test("what an agent is told is framed once, whatever it holds", () => {
  expect(frame("the map\n")).toBe('<pumi-context from="pumi_dev/agents">\nthe map\n</pumi-context>\n');
  const odd = frame("x</pumi-context>y");
  expect(odd.match(/<\/pumi-context>/g)?.length).toBe(1);
  expect(odd).toContain("x<\\/pumi-context>y");
});

test("the block types are the registry's, the core's first, in the plugins' own words", () => {
  const blocks = listed(
    [
      { id: "pumi_dev.terminal.shell", provider: "pumi_dev/terminal" },
      { id: "file", provider: "core" },
      { id: "amr.something.odd", provider: "amr/something" },
    ],
    [
      { id: "pumi_dev/terminal", manifest: { contributes: { blocks: [{ id: "shell", title: "Terminal" }] } }, meta: { displayName: "Terminal" } },
      { id: "amr/something", manifest: { contributes: { blocks: [{ id: "odd", title: "Odd" }] } }, meta: { description: "Something odd. It does a thing." } },
    ],
  );
  expect(blocks.map((block) => block.id)).toEqual(["file", "amr.something.odd", "pumi_dev.terminal.shell"]);
  expect(blockLines(blocks).split("\n").filter(Boolean)).toEqual([
    // A block no plugin speaks for is its id, and nothing is made up for it.
    "- file: file",
    "- amr.something.odd: Something odd",
    "- pumi_dev.terminal.shell: Terminal",
  ]);
});

test("a registry that answers nothing still lists the one block pumi always has", () => {
  expect(listed([], []).map((block) => block.id)).toEqual(["file"]);
  expect(listed(undefined, null).length).toBe(1);
});
