// The rows the Agents section lists: one per agent tab, what each says, and how they group by
// view and answer a search (`src/active.ts`).
import { describe, expect, test } from "bun:test";

import { folder, latest, matching, row, type AgentRow, type SeenTab } from "../src/active.ts";

/** A tab of `claude`'s in view `@1` of project `$1`, as the window reads it. */
function seen(more: Partial<SeenTab> = {}): SeenTab {
  return {
    tab: "%1",
    agent: "claude",
    model: "opus",
    title: "Fix the parser",
    cwd: "/Users/me/Kitchen/pumi",
    view: "@1",
    viewName: null,
    project: "$1",
    projectFolder: "pumi",
    activeAt: 1_700_000_000_000,
    ...more,
  };
}

/** The row of `seen(more)`, for the tests that know it is one. */
const rowOf = (more: Partial<SeenTab> = {}) => row(seen(more))!;

describe("a row", () => {
  test("is a tab's title, its agent, its model and where it runs", () => {
    expect(rowOf()).toEqual({
      tab: "%1",
      agent: "claude",
      agentName: "Claude Code",
      model: "opus",
      title: "Fix the parser",
      folder: "pumi",
      view: "@1",
      viewName: undefined,
      project: "$1",
      projectName: "pumi",
      activeAt: 1_700_000_000_000,
    });
  });

  test("is no row's for a tab that is no agent's, or names one the catalog does not", () => {
    expect(row(seen({ agent: undefined }))).toBeUndefined();
    expect(row(seen({ agent: "" }))).toBeUndefined();
    expect(row(seen({ agent: 3 }))).toBeUndefined();
    // An agent the catalog does not know is still one: its id is what it is called.
    expect(rowOf({ agent: "acme" }).agentName).toBe("acme");
  });

  test("says the agent's name while the tab has no title, and no model while its hook said none", () => {
    expect(rowOf({ title: null, model: null }).title).toBe("Claude Code");
    expect(rowOf({ title: "", model: undefined }).model).toBeUndefined();
  });

  test("says the view's name only while the user gave it one", () => {
    expect(rowOf({ viewName: "chat" }).viewName).toBe("chat");
    expect(rowOf({ viewName: null }).viewName).toBeUndefined();
    expect(rowOf({ viewName: "" }).viewName).toBeUndefined();
  });

  test("runs a folder's name, or nothing when there is no directory", () => {
    expect(rowOf({ cwd: null }).folder).toBeUndefined();
    expect(folder("/Users/me/pumi/")).toBe("pumi");
    expect(folder(undefined)).toBeUndefined();
  });
});

describe("latest", () => {
  test("puts the agent that did something last first, whatever its tab's place", () => {
    const rows = [rowOf({ tab: "%1", activeAt: 3_000 }), rowOf({ tab: "%2", activeAt: 9_000 }), rowOf({ tab: "%3", activeAt: 5_000 })];
    expect(latest(rows).map((one) => one.tab)).toEqual(["%2", "%3", "%1"]);
  });

  test("puts a row with no stamp yet after the ones that have one, keeping their order", () => {
    const rows = [rowOf({ tab: "%1", activeAt: 2_000 }), rowOf({ tab: "%2", activeAt: undefined }), rowOf({ tab: "%3", activeAt: undefined })];
    expect(latest(rows).map((one) => one.tab)).toEqual(["%1", "%2", "%3"]);
  });

  test("leaves the rows it was given alone", () => {
    const rows = [rowOf({ tab: "%1", activeAt: 1 }), rowOf({ tab: "%2", activeAt: 2 })];
    expect(latest(rows).map((one) => one.tab)).toEqual(["%2", "%1"]);
    expect(rows.map((one) => one.tab)).toEqual(["%1", "%2"]);
  });
});

describe("matching", () => {
  const rows: AgentRow[] = [
    rowOf({ tab: "%1", title: "Fix the parser", model: "opus", viewName: "main", cwd: "/Users/me/pumi" }),
    rowOf({ tab: "%2", agent: "codex", title: "Ship the release", model: "o4", viewName: "tests", project: "$2", projectFolder: "rex", cwd: "/Users/me/rex" }),
  ];

  test("keeps every row for no search", () => {
    expect(matching(rows, "  ").map((one) => one.tab)).toEqual(["%1", "%2"]);
    expect(matching(rows, "").length).toBe(2);
  });

  test("keeps a row a word is in: its title, agent, model, view, project or folder", () => {
    expect(matching(rows, "parser").map((one) => one.tab)).toEqual(["%1"]);
    expect(matching(rows, "codex").map((one) => one.tab)).toEqual(["%2"]);
    expect(matching(rows, "o4").map((one) => one.tab)).toEqual(["%2"]);
    expect(matching(rows, "tests").map((one) => one.tab)).toEqual(["%2"]);
    expect(matching(rows, "rex").map((one) => one.tab)).toEqual(["%2"]);
    expect(matching(rows, "claude code").map((one) => one.tab)).toEqual(["%1"]);
  });

  test("keeps only the rows every word is in", () => {
    expect(matching(rows, "fix codex")).toEqual([]);
    expect(matching(rows, "nothing like it")).toEqual([]);
  });
});
