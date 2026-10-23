// The list's rows: what the attention section says, which rows a space and a tab get, what a
// search keeps, and what a fold hides — the shape core/agents/src/sidebar.rs builds.
import { expect, test } from "bun:test";

import { read } from "../src/snapshot.ts";
import { detail, OPEN, rows, spaceLabel, tabLabel, title, type Row, type Shape } from "../src/tree.ts";
import { state } from "./fake.ts";

const snap = () => read(state());
const shape = (over: Partial<Shape> = {}): Shape => ({ ...OPEN, ...over });

/** A row said in one line, so a test can read the whole list at a glance. */
function said(rows: Row[]): string[] {
  return rows.map((row) => {
    switch (row.kind) {
      case "space":
        return `space ${spaceLabel(row.space)}${row.folded ? " (folded)" : ""}`;
      case "tab":
        return `tab ${row.label}${row.detail === "" ? "" : `: ${row.detail}`} [${row.disclosure}]`;
      case "pane":
        return `${" ".repeat(row.depth)}pane ${title(row.pane)}${row.agent ? " (agent)" : ""}`;
      case "attention-header":
        return `attention ${row.lead} ${row.count}`;
      case "attention":
        return `wants ${title(row.pane)}: ${row.said}`;
      case "note":
        return `note ${row.text}`;
    }
  });
}

test("a space with one tab is that tab's panes; a space with two names its tabs", () => {
  expect(said(rows(snap(), shape()))).toEqual([
    "attention blocked 1",
    "wants π - site: needs permission · Bash(npm publish)? · site",
    "space pumi",
    "tab Tab 1: zsh [space]",
    "tab editor: 2 panes [open]",
    " pane π - claude (agent)",
    " pane vim",
    "space site",
    "pane π - site (agent)",
  ]);
});

test("a space's name is its own, or its id when it has none", () => {
  const given = state();
  given.spaces[0]!.label = "";
  expect(spaceLabel(read(given).spaces[0]!)).toBe("$1");
});

test("a tab with no name is its number, as the core says it", () => {
  expect(tabLabel(snap().tabs.find((tab) => tab.id === 10)!)).toBe("Tab 1");
  expect(tabLabel(snap().tabs.find((tab) => tab.id === 11)!)).toBe("editor");
});

test("a pane's title is its label, its stripped title, the agent, else its directory", () => {
  const panes = snap().panes;
  expect(title(panes.find((pane) => pane.id === 101)!)).toBe("π - claude");
  expect(detail(panes.find((pane) => pane.id === 101)!)).toBe("pumi");
  const bare = { ...panes[0]!, title: "", stripped: "", label: "", agent: "", cwd: "/Users/me/work/" };
  // The title is the whole directory then, so the detail has nothing to add to it.
  expect([title(bare), detail(bare)]).toEqual(["/Users/me/work", ""]);
  expect(detail({ ...bare, title: "work" })).toBe("");
});

test("a fold hides a space's tabs and panes, and says so", () => {
  const said = rows(snap(), shape({ spaces: new Set([1]) })).map((row) => row.kind);
  expect(said).toEqual(["attention-header", "attention", "space", "space", "pane"]);
  expect(rows(snap(), shape({ spaces: new Set([1]) }))[2]).toMatchObject({ kind: "space", folded: true });
});

test("a fold of a tab that holds two panes leaves one row, with each pane's mark", () => {
  const list = rows(snap(), shape({ tabs: new Set([11]) }));
  const tab = list.find((row) => row.kind === "tab" && row.tab.id === 11)!;
  expect(tab).toMatchObject({ disclosure: "closed", marks: ["working", "idle"] });
  expect(said(list).filter((line) => line.includes("pane"))).toEqual(["pane π - site (agent)"]);
});

test("a search keeps what matches, drops the spaces it emptied, and folds nothing", () => {
  expect(said(rows(snap(), shape({ query: "vim" })))).toEqual(["space pumi", "tab editor: 2 panes [open]", " pane vim"]);
  expect(said(rows(snap(), shape({ query: "SITE" })))).toEqual([
    "space site",
    "pane π - site (agent)",
  ]);
});

test("a search that matches nothing says so", () => {
  expect(said(rows(snap(), shape({ query: "nothing at all" })))).toEqual(["note No agents match your search."]);
});

test("a tab's name matches the whole tab, panes and all", () => {
  expect(said(rows(snap(), shape({ query: "editor" })))).toEqual([
    "space pumi",
    "tab editor: 2 panes [open]",
    " pane π - claude (agent)",
    " pane vim",
  ]);
});

test("the attention section folds to its header, and a quiet pumi has none", () => {
  expect(said(rows(snap(), shape({ attention: true })).slice(0, 1))).toEqual(["attention blocked 1"]);
  const quiet = state();
  quiet.panes[3]!.options["@agent_status"] = "working";
  quiet.panes[3]!.options["@program_status"] = [{ id: "", state: "working" }];
  expect(rows(read(quiet), shape()).some((row) => row.kind.startsWith("attention"))).toBe(false);
});

test("an empty pumi says there are no agents yet", () => {
  expect(said(rows(read({ spaces: [], tabs: [], panes: [] }), shape()))).toEqual(["note No agents yet"]);
});
