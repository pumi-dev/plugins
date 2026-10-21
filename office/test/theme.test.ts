// The office against pumi/testing, on a window of two sessions: the plan it makes of them (a pod
// for each, a desk for each tab, and a free desk), a desk dragged to where you put it, a press that
// walks you over and sits you at its monitor, "A desk for every pane", the screen a pointed-at desk
// opens, the bookshelf's pages, the rename a desk asks for, and the menus over the room.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { AppMenu, AppPane, AppSpace, AppState, AppTab } from "pumi";
import { FakeApp, type RenderedTheme, type Selector } from "pumi/testing";

const dir = join(import.meta.dir, "..");
const theme = "themes/office/theme.ts";

const PANE = (key: string, over: Partial<AppPane> = {}): AppPane => ({
  key,
  id: `%${key.slice(2)}`,
  view: `pane:${key}`,
  kind: "terminal",
  title: key,
  status: "",
  cwd: "/src/pumi",
  command: "zsh",
  focused: false,
  zoomed: false,
  hidden: false,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  options: null,
  strip: [],
  winbar: [],
  winbar_bottom: [],
  ...over,
});
const TAB = (id: number, over: Partial<AppTab> = {}): AppTab => ({
  id,
  index: 1,
  of: `tab${id}`,
  title: `tab ${id}`,
  label: null,
  active: false,
  status: "",
  worktree: null,
  zoomed: false,
  panes: [PANE(`t:%${id}`, { focused: true })],
  dividers: [],
  ...over,
});
const SPACE = (id: number, over: Partial<AppSpace> = {}): AppSpace => ({
  id,
  index: 1,
  label: `space ${id}`,
  active: false,
  server: null,
  status: "",
  tabs: 0,
  tab_list: [],
  ...over,
});

/** A window of two sessions: `pumi` with a split tab and a single one, and `site` with one. */
function office(over: Partial<AppState> = {}): AppState {
  const build = TAB(11, {
    title: "build",
    active: true,
    status: "working",
    panes: [PANE("t:%1", { focused: true, status: "working", w: 0.5 }), PANE("t:%2", { x: 0.5, w: 0.5 })],
    dividers: [{ path: "", axis: "row", ratio: 0.5, x: 0, y: 0, w: 1, h: 1 }],
  });
  const notes = TAB(12, { index: 2, title: "notes", panes: [PANE("t:%3", { focused: true, title: "vim" })] });
  const pumi = SPACE(3, { label: "pumi", active: true, status: "working", tabs: 2, tab_list: [build, notes] });
  const site = SPACE(4, { index: 2, label: "site", tabs: 1, tab_list: [TAB(21)] });
  return {
    window: {
      id: 1,
      width: 1280,
      height: 800,
      sidebar: false,
      sidebar_width: 260,
      page: null,
      secondary: false,
      secondary_width: 300,
      secondary_page: null,
      bottom: false,
      bottom_height: 220,
      bottom_page: null,
      bottom_leaf: null,
      fullscreen: false,
      active: true,
    },
    appearance: "dark",
    ui_theme: "office",
    space: { id: 3, label: "pumi", server: null },
    spaces: [pumi, site],
    tabs: [build, notes],
    focused: "t:%1",
    pages: [
      {
        id: "agents",
        label: "Agents",
        icon: "sparkle",
        dock: "primary",
        sections: [{ key: "agents.list", label: "Agents", view: "section:agents.list", collapsed: false, size: 1 }],
      },
      {
        id: "problems",
        label: "Problems",
        icon: "warning",
        dock: "panel",
        sections: [
          { key: "lang.problems", label: "Problems", view: "section:lang.problems", collapsed: false, size: 1 },
          { key: "git.log", label: "History", view: "section:git.log", collapsed: true, size: 1 },
        ],
      },
    ],
    panel_leaves: [],
    slots: {},
    menus: {},
    plugins: [],
    packages: [],
    themes: ["office", "default"],
    agents: [
      { pane: "%1", key: "t:%1", status: "working", agent: "claude", title: "build", name: null, cwd: null, space: "pumi", tab: "build" },
      { pane: "%3", key: "t:%3", status: "blocked", agent: "codex", title: null, name: "notes", cwd: null, space: "pumi", tab: "notes" },
    ],
    notice: null,
    error: null,
    safe: false,
    platform: "macos",
    menu: null,
    picker: null,
    renaming: null,
    popover: null,
    clock: "9:41 AM",
    settings: {},
    ...over,
  };
}

let app: FakeApp | undefined;
afterEach(() => app?.stop());

async function mount(state = office(), layout?: Record<string, [number, number, number, number]>): Promise<RenderedTheme> {
  app = await FakeApp.start({ dir });
  const t = await app.theme(theme, state, layout ? { layout } : {});
  expect(t.error).toBeNull();
  expect(t.errors).toEqual([]);
  return t;
}

const at = (t: RenderedTheme, key: string) => t.find((n) => n.props.key === key).style;
const deskKeys = (t: RenderedTheme): string[] =>
  t.findAll(".desk").map((n) => String(n.props.key)).filter((k) => !k.startsWith("free-desk"));
/** The nodes `match` finds that are inside the node with CSS id (or key) `id`. */
const within = (t: RenderedTheme, id: string, match: Selector) =>
  t.findAll(match).filter((n) => {
    for (let p = n.parent; p; p = p.parent) if (p.props.id === id || p.props.key === id) return true;
    return false;
  });
/** A node with all of `names` among its classes. */
const cls =
  (...names: string[]): Selector =>
  (n) =>
    names.every((c) => (n.props.class ?? "").split(" ").includes(c));

test("it says what it is", async () => {
  const t = await mount();
  expect(t.meta?.name).toBe("Office");
  expect(t.meta?.attach).toBe("all");
  expect(t.meta?.settings?.desk_per_pane).toMatchObject({ type: "boolean", default: false });
  expect(t.meta?.colors?.dark?.floor).toBe("#efe3cf");
  expect(t.meta?.metrics?.radius).toBe(7);
});

test("the plan: a pod for each session, a desk for each tab, and a free desk", async () => {
  const t = await mount();
  expect(t.findAll(".pod").length).toBe(2);
  expect(deskKeys(t)).toEqual(["desk11", "desk12", "desk21"]);
  // Two pods of a row: 396 and 220 wide, centred on a floor of 1280, 160 above the wall.
  expect(at(t, "desk11")).toMatchObject({ left: "345px", top: "250px" });
  expect(at(t, "desk12")).toMatchObject({ left: "345px", top: "406px" });
  expect(at(t, "free-desk3")).toMatchObject({ left: "521px", top: "250px" });
  expect(at(t, "desk21")).toMatchObject({ left: "759px", top: "250px" });
  expect(at(t, "free-desk4")).toMatchObject({ left: "759px", top: "406px" });
  // A desk's small screen is its pane in front, live; the free desks have none.
  expect(t.findAll(".screen").length).toBe(3);
  expect(within(t, "desk11", cls("screen")).length).toBe(1);
  expect(within(t, "desk11", cls("desk-pane"))[0]!.props.key).toBe("panet:%1");
});

test("a window with no session is an empty floor, with you in the middle of it", async () => {
  const t = await mount(office({ spaces: [], tabs: [], space: null, focused: null, agents: [] }));
  expect(t.findAll(".pod").length).toBe(0);
  expect(t.findAll(".desk").length).toBe(0);
  expect(t.find("#you").style.transform).toBe("translate(628px, 56px)");
  expect(t.text(cls("hud-space"))).toBe("No session");
  expect(t.text(cls("hud-count", "rooms"))).toBe("0 sessions · 0 desks");
});

test("a desk dragged stays where you put it, and where you left it is kept", async () => {
  const t = await mount();
  const desk = (n: { props: { key?: string } }) => n.props.key === "desk11";
  await t.dispatch(desk, "mouseDown", {});
  await t.dispatch(desk, "drag", { dx: 40, dy: 20 });
  expect(t.find(desk).props.class).toContain("moving");
  await t.dispatch(desk, "dragEnd", {});
  expect(at(t, "desk11")).toMatchObject({ left: "385px", top: "270px" });
  expect(t.find(desk).props.class).not.toContain("moving");
  expect(app?.storage.get("office")).toMatchObject({ desks: { desk11: { x: 385, y: 270 } } });
});

test("a click walks you over, and sits you at the desk's monitor", async () => {
  const t = await mount();
  await t.click((n) => n.props.key === "desk11");
  expect(t.commands).toEqual([
    { name: "select_space", args: [3] },
    { name: "select_tab", args: [11] },
  ]);
  // You walk to the spot beside the chair; the walk's timer then sits you down.
  expect(t.find("#you").props.class).toContain("walking");
  expect(t.find("#you").style.transform).toBe("translate(467px, 320px)");
  await Bun.sleep(700);
  await app!.settle();
  expect(t.find("#you").props.class ?? "").not.toContain("walking");
  expect(t.find("#monitor")).toBeDefined();
  expect(t.text(".monitor-title")).toBe("build");
  expect(within(t, "monitor", cls("pane")).length).toBe(2);
  // Standing up closes it.
  await t.click("#monitor-backdrop");
  expect(t.findAll("#monitor").length).toBe(0);
});

test("a press on the floor walks you there, without sitting you down", async () => {
  const t = await mount(office(), { floor: [0, 0, 1280, 744] });
  // Where the app laid the floor out reaches the theme's handlers on the next event.
  await t.push(t.state, { floor: [0, 0, 1280, 744] });
  await t.click("#floor", { x: 600, y: 400 });
  expect(t.find("#you").style.transform).toBe("translate(600px, 400px)");
  expect(t.find("#you").props.class).toContain("walking");
});

test("pointing at a desk opens its screen, big", async () => {
  const t = await mount();
  expect(t.findAll(cls("screen", "open")).length).toBe(0);
  await t.dispatch((n) => n.props.key === "desk11", "mouseEnter", {});
  const open = t.find(cls("screen", "open"));
  expect(open.style.width).toBe("720px");
  expect(t.text(".screen-title")).toBe("pumi  ·  build");
  // The same screen, big: every pane of the tab in it, where the small one had the pane in front.
  expect(within(t, "desk11", cls("desk-pane")).length).toBe(2);
  await t.dispatch((n) => n.props.key === "desk11", "mouseLeave", {});
  expect(t.findAll(cls("screen", "open")).length).toBe(0);
});

test("a desk for every pane splits the split tab's desks", async () => {
  const t = await mount();
  expect(t.text((n) => n.props.class === "hud-count rooms")).toBe("2 sessions · 3 desks");
  await t.push(office({ settings: { desk_per_pane: true } }));
  expect(t.errors).toEqual([]);
  // Every visible pane is a desk of its own, a single-pane tab's too.
  expect(deskKeys(t)).toEqual(["desk11:t:%1", "desk11:t:%2", "desk12:t:%3", "desk21:t:%21"]);
  expect(t.text((n) => n.props.class === "hud-count rooms")).toBe("2 sessions · 4 desks");
});

test("the bar sets the setting the desks read", async () => {
  const t = await mount();
  await t.click((n) => n.props.title === "A desk for every pane");
  expect(t.commands).toEqual([{ name: "set_setting", args: ["desk_per_pane", true] }]);
});

test("the bookshelf shows the plugins' pages", async () => {
  const t = await mount();
  await t.click((n) => n.props.key === "shelf");
  expect(t.findAll(".book").map((n) => n.props.key)).toEqual(["agents", "problems"]);
  expect(within(t, "shelf", cls("section")).length).toBe(1);
  await t.click((n) => n.props.key === "problems");
  expect(t.find(cls("book", "active")).props.key).toBe("problems");
  expect(within(t, "shelf", cls("section")).length).toBe(2);
});

test("a desk renamed in the middle of the room runs rename_tab", async () => {
  const t = await mount(office({ renaming: "tab:11" }));
  expect(t.text(".rename-title")).toBe("Rename desk");
  await t.dispatch(".rename-input", "submit", { value: "  build  " });
  expect(t.commands).toEqual([{ name: "rename_tab", args: [11, "build"] }]);
});

test("a menu over the room runs its item's command", async () => {
  const menu: AppMenu = {
    id: "tab",
    x: 10,
    y: 20,
    under: null,
    items: [
      { label: "Rename…", cmd: "start_rename", args: ["tab:11"], disabled: false, checked: false, separator: false, heading: false },
    ],
  };
  const t = await mount(office({ menu }));
  expect(within(t, "menu", cls("menu-item")).length).toBe(1);
  await t.click(".menu-item");
  expect(t.commands).toEqual([
    { name: "close_menu", args: [] },
    { name: "start_rename", args: ["tab:11"] },
  ]);
});
