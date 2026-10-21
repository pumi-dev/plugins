// Dia against pumi/testing: for each window in fixtures/apps.json (the app the default theme's
// fixtures describe, in Dia) the tree it draws (the snapshots `bun test` writes the first time;
// `bun test -u` takes what it draws now), and what its clicks run.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { AppState } from "pumi";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");
const cases: { name: string; app: AppState }[] = await Bun.file(join(import.meta.dir, "fixtures/apps.json")).json();

let app: FakeApp | undefined;
afterEach(() => app?.stop());

/** The theme mounted on a fresh window whose `app` is `state`. */
const mount = async (state: AppState) => {
  app = await FakeApp.start({ dir });
  const t = await app.theme("themes/dia/theme.ts", state);
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

test("it says what it is: its name, its colours, its metrics and its backdrop", async () => {
  const t = await mount(cases[0]!.app);
  expect(t.meta?.name).toBe("Dia");
  expect(t.meta?.colors?.dark?.dia_top).toBe("#2b3540");
  expect(t.meta?.colors?.light?.dia_top).toBe("#e4edf4");
  expect(t.meta?.metrics).toEqual({ radius: 8, radius_sm: 6, radius_lg: 12, control_height: 28 });
  expect(t.meta?.backdrop).toBe("blurred");
});

test("a tile pins its page in the sidebar, and its close gives the tabs back", async () => {
  const t = await mount(cases[0]!.app);
  /** The tiles, and which of them is the page the sidebar shows. */
  const lit = () =>
    t
      .findAll(".dia-tile")
      .filter((n) => (n.props.class ?? "").includes("active"))
      .map((n) => n.props.key);
  expect(t.findAll("#dia-page").length).toBe(0);
  await t.click((n) => n.props.key === "agents");
  expect(lit()).toEqual(["agents"]);
  expect(t.text("#dia-page")).toContain("Agents");
  expect(t.findAll("#dia-list").length).toBe(0);
  await t.click((n) => n.props.title === "Back to Tabs");
  expect(t.findAll("#dia-page").length).toBe(0);
  expect(lit()).toEqual([]);
  expect(t.findAll("#dia-list").length).toBe(1);
});

test("its rows run the window's commands", async () => {
  const t = await mount(cases[0]!.app);
  await t.click((n) => n.props.key === "tab12");
  await t.click((n) => n.props.key === "space4");
  await t.click(".dia-new");
  await t.click("#toggle-sidebar");
  await t.click("#dia-settings");
  await t.click((n) => n.props.title === "Sessions");
  await t.dispatch((n) => n.props.key === "tab12", "doubleClick");
  await t.dispatch((n) => n.props.key === "tab12", "mouseDown", { button: "middle" });
  await t.dispatch((n) => n.props.key === "tab12", "contextMenu", { wx: 5, wy: 6 });
  await t.click((n) => n.props.key === "t:%2");
  await t.click((n) => n.props.class === "icon-button dia-close" && n.parent?.props.key === "t:%2");
  expect(t.commands).toEqual([
    { name: "select_tab", args: [12] },
    { name: "select_space", args: [4] },
    { name: "run", args: ["new_tab"] },
    { name: "toggle", args: ["sidebar"] },
    { name: "settings", args: [] },
    { name: "projects", args: [] },
    { name: "start_rename", args: ["tab:12"] },
    { name: "close_tab", args: [12] },
    { name: "tab_menu", args: [12, 5, 6] },
    { name: "focus_pane", args: ["t:%2"] },
    { name: "close_pane", args: ["t:%2"] },
  ]);
});

test("a patch of the app draws again: a tab renamed", async () => {
  const t = await mount(cases[0]!.app);
  const next = structuredClone(cases[0]!.app);
  next.tabs[1]!.title = "todo";
  await t.push(next);
  expect(t.text((n) => n.props.key === "tab12")).toContain("todo");
});

test("the menu, the picker and the popover it draws run theirs", async () => {
  const t = await mount(cases[1]!.app);
  expect(t.find("#menu").props.class).toBe("menu menu-tab");
  expect(t.findAll(".menu-item").length).toBe(3);
  expect(t.findAll(".picker-row").length).toBe(5);
  expect(t.text("#popover")).toContain("Opening…");
  await t.click("text=Rename");
  expect(t.commands).toEqual([
    { name: "close_menu", args: [] },
    { name: "start_rename", args: ["tab:12"] },
  ]);
});
