// The theme against pumi/testing: the desktop it draws for one window, the windows of its tabs,
// the Start menu it opens, and the window commands its handlers run.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { AppPane, AppState } from "pumi";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");

/** A pane of a tab, at its fractions of the tab: a terminal, unless `kind` says otherwise. */
const pane = (n: number, focused: boolean, x: number, y: number, w: number, h: number, kind = "terminal"): AppPane => ({
  key: `t:%${n}`,
  id: `%${n}`,
  view: `pane:t:%${n}`,
  kind,
  title: kind === "terminal" ? "zsh" : "README",
  status: n === 1 ? "working" : "blocked",
  cwd: "/src/pumi",
  command: kind === "terminal" ? "cargo" : "less",
  focused,
  zoomed: false,
  hidden: false,
  x,
  y,
  w,
  h,
  options: null,
  strip: [],
  winbar: [],
  winbar_bottom: [],
});

/** The window the theme draws: two tabs (one split in two), a side bar's page, a slot in the
 * status bar, two plugins, a package, two themes and two agents. */
const app = (): AppState => ({
  window: {
    id: 1,
    width: 1280,
    height: 800,
    sidebar: true,
    sidebar_width: 260,
    page: "agents",
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
  appearance: "light",
  ui_theme: "win98",
  space: { id: 3, label: "pumi", server: null },
  spaces: [{ id: 3, index: 1, label: "pumi", active: true, server: null, status: "working", tabs: 2, tab_list: [] }],
  tabs: [
    {
      id: 11,
      index: 1,
      of: "tab11",
      title: "build",
      label: null,
      active: true,
      status: "working",
      worktree: null,
      zoomed: false,
      panes: [pane(1, true, 0, 0, 0.5, 1), pane(2, false, 0.5, 0, 0.5, 1)],
      dividers: [{ path: "root", axis: "row", ratio: 0.5, x: 0.5, y: 0, w: 0, h: 1 }],
    },
    {
      id: 12,
      index: 2,
      of: "tab12",
      title: "notes",
      label: null,
      active: false,
      status: "blocked",
      worktree: null,
      zoomed: false,
      panes: [pane(3, true, 0, 0, 1, 1, "document")],
      dividers: [],
    },
  ],
  focused: "t:%1",
  pages: [
    {
      id: "agents",
      label: "Agents",
      icon: "users",
      dock: "primary",
      sections: [
        { key: "agents.list", label: "Agents", view: "section:agents.list", collapsed: false, size: 1 },
        { key: "git.changes", label: "Changes", view: "section:git.changes", collapsed: true, size: 2 },
      ],
    },
  ],
  panel_leaves: [],
  slots: {
    statusline: [{ pane: "%7", kind: "local.perf.meter", title: "Perf", icon: "", width: 80, view: "view:%7" }],
  },
  menus: {},
  plugins: [
    {
      name: "agents",
      label: "Agents",
      icon: "users",
      description: "The agents.",
      running: true,
      views: [{ id: "list", label: "Agents" }],
      commands: [],
    },
    { name: "files", label: "Files", icon: "folder", description: "Files.", running: false, views: [], commands: [] },
  ],
  packages: [
    {
      name: "queue",
      label: "Queue",
      description: "A queue.",
      version: "0.2.0",
      active: true,
      views: [{ id: "board", label: "Queue", type: "local.queue.board" }],
      contributes: null,
    },
  ],
  themes: ["default", "win98"],
  agents: [
    { pane: "%1", key: "t:%1", status: "working", agent: "claude", title: "build", name: null, cwd: "/src/pumi", space: "pumi", tab: "build" },
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
});

let started: FakeApp | undefined;
afterEach(() => started?.stop());

const mount = async (state = app()) => {
  started = await FakeApp.start({ dir });
  return started.theme("themes/win98/theme.ts", state);
};
const hasClass = (node: { props: { class?: string } }, name: string): boolean =>
  (node.props.class ?? "").split(" ").includes(name);

test("it says what it is: its name, the app's tokens, and its own as vars", async () => {
  const t = await mount();
  expect(t.error).toBeNull();
  expect(t.errors).toEqual([]);
  expect(t.meta?.name).toBe("Windows 98");
  expect(t.meta?.colors?.light?.bg).toBe("#c0c0c0");
  expect(t.meta?.colors?.light?.primary).toBe("#000080");
  // The palette's own names are the theme's, not the app's tokens.
  expect(t.meta?.vars?.face).toBe("#c0c0c0");
  expect(t.meta?.vars?.desktop).toBe("#008080");
  expect(t.meta?.colors?.light?.desktop).toBeUndefined();
  expect(t.meta?.metrics?.radius).toBe(0);
  expect(t.meta?.fonts?.font).toBe("Tahoma");
});

test("the desktop, and a window for each tab", async () => {
  const t = await mount();
  expect(t.find("#desktop").props.class).toBe("active");
  expect(t.findAll(".window").length).toBe(2);
  expect(t.text("#windows")).toContain("build");
  expect(t.text("#windows")).toContain("notes");
  // A lone pane has no strip; a split tab's panes do.
  expect(t.findAll(".pane-strip").length).toBe(2);
  expect(t.findAll(".pane").length).toBe(3);
  expect(t.find("#taskbar").props.id).toBe("taskbar");
  expect(t.text("#tray")).toContain("9:41 AM");
  expect(t.findAll(".tray-agent").length).toBe(2);
  expect(t.text("#icons")).toContain("My Computer");
  expect(t.findAll("#startmenu").length).toBe(0);
});

test("the Start menu opens with the Start button, and closes with it again", async () => {
  const t = await mount();
  await t.click("#start");
  const menu = t.text("#startmenu");
  for (const label of ["Programs", "Plugins", "Sessions", "Settings", "Find", "Help", "Run…", "Shut Down…"]) {
    expect(menu).toContain(label);
  }
  expect(t.find("#start").props.class).toContain("pressed");
  // Settings opens its own submenu.
  await t.click((n) => n.props.key === "Settings4");
  expect(t.text("#startmenu")).toContain("Control Panel");
  expect(t.text("#startmenu")).toContain("Keyboard");
  await t.click("#start");
  expect(t.findAll("#startmenu").length).toBe(0);
});

test("a Start menu item opens the page it names as an Explorer window", async () => {
  const t = await mount();
  await t.click("#start");
  await t.click((n) => n.props.key === "Programs1");
  await t.click((n) => n.props.key === "Agents4");
  expect(t.findAll(".window").length).toBe(3);
  expect(t.find(".explorer")).toBeDefined();
  expect(t.findAll("#startmenu").length).toBe(0);
  // The page's sections are its plugin's views, the first open and the rest folded.
  expect(t.findAll(".section").length).toBe(2);
  expect(t.findAll((n) => hasClass(n, "section") && hasClass(n, "open")).length).toBe(1);
  expect(t.commands).toEqual([]);
});

test("a plugin's menu item runs the window's command", async () => {
  const t = await mount();
  await t.click("#start");
  await t.click((n) => n.props.key === "Plugins2");
  await t.click((n) => n.props.key === "Plugin Settings…6");
  expect(t.commands).toEqual([{ name: "settings", args: ["plugins"] }]);
});

test("a task raises its window, and names its tab", async () => {
  const t = await mount();
  await t.click((n) => n.props.key === "tab:12" && hasClass(n, "task"));
  expect(t.commands).toEqual([{ name: "select_tab", args: [12] }]);
  expect(t.find("#desktop").props.class).toBe("active");
});

test("a window's Close button closes its tab", async () => {
  const t = await mount();
  const closes = t.findAll((n) => hasClass(n, "capbtn") && n.props.title === "Close");
  expect(closes.length).toBe(2);
  await t.click((n) => n === closes[1]);
  expect(t.commands).toEqual([{ name: "close_tab", args: [12] }]);
});

test("Run… takes a line and opens it; Shut Down asks first", async () => {
  const t = await mount();
  await t.click("#start");
  await t.click((n) => n.props.key === "Run…7");
  expect(t.text("#modal")).toContain("Type the name of a program");
  await t.dispatch("#run-input", "submit", { value: "https://pumi.dev" });
  expect(t.commands).toEqual([{ name: "open_browser", args: ["https://pumi.dev"] }]);
  expect(t.findAll("#modal").length).toBe(0);

  await t.click("#start");
  await t.click((n) => n.props.key === "Shut Down…9");
  expect(t.text("#modal")).toContain("Are you sure you want to quit pumi?");
  await t.click((n) => hasClass(n, "dialog-btn"));
  expect(t.commands).toEqual([
    { name: "open_browser", args: ["https://pumi.dev"] },
    { name: "quit", args: [] },
  ]);
});
