// All Tabs against pumi/testing: for each window in fixtures/apps.json, the tree it draws (the
// snapshots `bun test` writes the first time; `bun test -u` takes what it draws now), that every
// session's tabs are in the header as one group a session with no session named, and what its
// clicks run.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { AppState } from "pumi";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");
const cases: { name: string; app: AppState }[] = await Bun.file(join(import.meta.dir, "fixtures/apps.json")).json();
/** The window with two sessions of two tabs each, and the one with none. */
const twoSessions = cases[0]!.app;

let app: FakeApp | undefined;
afterEach(() => app?.stop());

/** The theme mounted on a fresh window whose `app` is `state`. */
const mount = async (state: AppState) => {
  app = await FakeApp.start({ dir });
  const t = await app.theme("themes/alltabs/theme.ts", state);
  expect(t.error).toBeNull();
  return t;
};

for (const c of cases) {
  test(`it draws the window: ${c.name}`, async () => {
    const t = await mount(c.app);
    expect(t.errors).toEqual([]);
    expect(t.snapshot()).toMatchSnapshot();
  });
}

test("it says what it is: its name and its setting", async () => {
  const t = await mount(twoSessions);
  expect(t.meta?.name).toBe("All Tabs");
  expect(t.meta?.description).toBe("pumi's own, with every session's tabs in the header: one group a session, no names.");
  expect(t.meta?.settings?.all_sessions).toEqual({
    type: "boolean",
    default: true,
    desc: "Show every session in the header, not only the one in front.",
  });
});

test("every session's tabs are in the header, one group a session, a separator between", async () => {
  const t = await mount(twoSessions);
  const tabRow = t.find("#tabs");
  /** What the header's rows are, in the order they are drawn. */
  const rows = (tabRow.children ?? []).map((n) => n.props.class?.split(" ")[0] ?? n.props.id);
  expect(rows).toEqual(["tab-group", "tab-group-sep", "tab-group", "icon-button", "icon-button"]);

  const groups = t.findAll(".tab-group");
  expect(groups.map((n) => n.props.key)).toEqual(["group3", "group4"]);
  expect(groups.map((n) => n.props.title)).toEqual(["pumi", "site"]);
  expect(groups.filter((n) => (n.props.class ?? "").includes("active")).map((n) => n.props.key)).toEqual(["group3"]);

  expect(t.text((n) => n.props.key === "group3")).toBe("buildnotes");
  expect(t.text((n) => n.props.key === "group4")).toBe("deploylogs");
});

test("a session that is not the one in front names no tab of it `active`", async () => {
  const t = await mount(twoSessions);
  const inGroup = (key: string) =>
    t.findAll(".tab").filter((n) => (n.parent?.props.key ?? "") === key);
  expect(inGroup("group3").filter((n) => (n.props.class ?? "").includes("active")).map((n) => n.props.key)).toEqual(["tab11"]);
  expect(inGroup("group4").filter((n) => (n.props.class ?? "").includes("active"))).toEqual([]);
  expect(inGroup("group4").map((n) => n.props.key)).toEqual(["tab21", "tab22"]);
});

test("a session's name is not drawn in the header, only its group's title", async () => {
  const t = await mount(twoSessions);
  for (const [key, name] of [["group3", "pumi"], ["group4", "site"]] as const) {
    const group = t.find((n) => n.props.key === key);
    expect(t.text((n) => n.props.key === key)).not.toContain(name);
    expect(group.props.title).toBe(name);
  }
});

test("the all_sessions setting off: the tabs of the session in front, as the default theme draws them", async () => {
  const t = await mount(twoSessions);
  await t.push({ ...twoSessions, settings: { all_sessions: false } });
  expect(t.findAll(".tab-group")).toEqual([]);
  expect(t.findAll(".tab-group-sep")).toEqual([]);
  expect(t.findAll(".tab").map((n) => n.props.key)).toEqual(["tab11", "tab12"]);
  expect(t.find("#tabs").children?.length).toBe(4);
});

test("its tabs run the window's commands: another session's tab too", async () => {
  const t = await mount(twoSessions);
  await t.click((n) => n.props.key === "tab22");
  await t.click((n) => n.props.key === "tab12");
  await t.click("#new-tab");
  expect(t.commands).toEqual([
    { name: "select_tab", args: [22] },
    { name: "select_tab", args: [12] },
    { name: "run", args: ["new_tab"] },
  ]);
});
