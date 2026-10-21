// Windows 98, as a pumi UI theme (theme.lua's `render(app)`, ported): each tab is a window on a
// teal desktop, the dock's pages open as Explorer windows from the Start menu, and the Start menu
// lists the plugins, packages, sessions and themes. The Lua extended the default theme for its
// panes, its page bodies and its slots' views (`C.Panes`, `C.PageBody`, `C.Slot`): those are
// drawn here (body.ts), with the default theme's classes; base.css is the default theme's CSS,
// until themes can extend.
import {
  app,
  defineTheme,
  div,
  img,
  input,
  px,
  text,
  type AppCorePlugin,
  type AppPage,
  type AppState,
  type AppTab,
  type El,
  type ElementEvent,
  type ThemeContext,
} from "pumi";
import { overlays, type OverlayState } from "../../src/overlays.ts";
import { pageBody, panes, slotViews } from "./body.ts";

/** The taskbar's height: a window made full takes the desktop above it. */
const TASKBAR = 28;

/** Where a window is, and whether it is folded to a task or made full. */
interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
  min?: boolean;
  max?: boolean;
}

/** What the theme keeps between renders: Windows' places and order, the open pages, the menus,
 * the dialogs, and the overlays' highlight. */
export interface State extends OverlayState {
  win: Record<string, Place>;
  order: string[];
  open: Record<string, boolean>;
  menu: boolean;
  /** The open submenu at each depth: `path[0]` is a Start menu row (1-based), `path[1]` its
   * submenu's, and so on. */
  path: number[];
  /** The menu bar open on a window: its window's key, and its menu (1-based). */
  bar: { win: string; menu: number } | null;
  dialog: "run" | "shutdown" | "about" | null;
  /** The window on top. */
  top: string | null;
  selected: string | null;
  selectedTab: number | null;
  lastRun: string;
  /** The ratios of the dividers being dragged, by path. */
  ratios: Record<string, number>;
}

const fresh = (): State => ({
  win: {},
  order: [],
  open: {},
  menu: false,
  path: [],
  bar: null,
  dialog: null,
  top: null,
  selected: null,
  selectedTab: null,
  lastRun: "",
  ratios: {},
  menuHl: null,
  menuFor: "",
});

const cls = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(" ");
const spacer = (): El => div().class("spacer");

/** Win98's places and sizes, the theme's own palette, and its look: square corners, thin borders
 * and Tahoma. The palette's private names (`face`, `light`, `shadow`, …) are `vars`, which
 * style.css reads, not `colors`: those are the app's tokens, which Settings, the menus, the
 * pickers and every plugin draw in. */
const TOKENS: Record<string, string> = {
  bg: "#c0c0c0",
  window: "#c0c0c0",
  chrome_surface: "#c0c0c0",
  chrome_selected: "#dfdfdf",
  chrome_border: "#808080",
  text: "#000000",
  chrome_muted: "#404040",
  faint: "#808080",
  accent: "#000080",
  surface: "#c0c0c0",
  surface_text: "#000000",
  muted: "#404040",
  placeholder: "#808080",
  hover: "#dfdfdf",
  active: "#b5b5b5",
  border: "#808080",
  border_variant: "#dfdfdf",
  element: "#ffffff",
  element_disabled: "#c0c0c0",
  editor: "#ffffff",
  input_hover: "#000000",
  focus_ring: "#000080",
  selection: "#a6caf0",
  row_selected: "#a6caf0",
  primary: "#000080",
  primary_hover: "#1084d0",
  primary_active: "#000060",
  primary_foreground: "#ffffff",
  danger_hover: "#c00000",
  danger_active: "#800000",
  danger_foreground: "#ffffff",
  success: "#008000",
  warning: "#808000",
  error: "#c00000",
  overlay: "#00000033",
  tab_bar: "#c0c0c0",
  tab_active: "#c0c0c0",
  tab_text: "#000000",
  tab_active_text: "#000000",
};

/** The Windows 98 palette's own names: bevels, the desktop, the caption, the checker. */
const OWN: Record<string, string> = {
  desktop: "#008080",
  face: "#c0c0c0",
  light: "#dfdfdf",
  white: "#ffffff",
  shadow: "#808080",
  dark: "#0a0a0a",
  black: "#000000",
  ink: "#000000",
  highlight: "#000080",
  checker: "#e8e8e8",
  title: "#000080",
  title2: "#1084d0",
  inactive: "#808080",
  inactive2: "#b5b5b5",
  tip: "#ffffe1",
};

// -- the pieces every part is made of ---------------------------------------------------------

const image = (name: string, classNames?: string): El => img(`images/${name}.svg`).class(cls("px", classNames));

/** A Windows 98 push button: two bevels around what it holds. */
function button(
  t: {
    id?: string;
    key?: string;
    class?: string;
    pressed?: boolean;
    disabled?: boolean;
    of?: string;
    title?: string;
    onclick?: (e: ElementEvent) => void;
  },
  ...kids: (El | null)[]
): El {
  return div()
    .whenSome(t.id, (e, id) => e.id(id))
    .whenSome(t.key, (e, key) => e.key(key))
    .class(cls("btn", t.class, t.pressed && "pressed", t.disabled && "disabled"))
    .whenSome(t.of, (e, of) => e.of(of))
    .whenSome(t.title, (e, title) => e.title(title))
    .onClick((ev) => {
      if (!t.disabled && t.onclick) t.onclick(ev);
      return true;
    })
    .child(div().class("btn-in").children(kids));
}

const captionButton = (label: string, title: string, onclick: () => void): El =>
  button({ class: "capbtn", title, onclick }, text(label).class("capbtn-label"));

/** A menu closes, and so does everything it opened. */
function closeMenus(S: State) {
  S.menu = false;
  S.path = [];
  S.bar = null;
}

// -- windows' places --------------------------------------------------------------------------

function raise(S: State, key: string) {
  S.order = S.order.filter((k) => k !== key);
  S.order.push(key);
}

function place(S: State, key: string, n: number, desk: { w: number; h: number }): Place {
  const known = S.win[key];
  if (known) return known;
  const at = { x: 96 + 28 * (n % 8), y: 24 + 26 * (n % 8), w: Math.min(720, desk.w - 160), h: Math.min(460, desk.h - 140) };
  S.win[key] = at;
  return at;
}

// -- menus ------------------------------------------------------------------------------------

/** A menu's item: an icon, a label, what it runs, and its own items when it opens a submenu. */
interface Item {
  icon?: string;
  label?: string;
  run?: () => void;
  items?: (Item | "-")[];
  checked?: boolean;
  disabled?: boolean;
}

/** A menu: a raised box of items, each `{ icon, label, run, items, checked, disabled }`, or `'-'`
 * for a separator. `depth` is how deep it is. */
function menu(S: State, items: (Item | "-")[], depth: number, classNames?: string): El {
  return div()
    .class(cls("raised", "menu", classNames))
    .onClick(() => true)
    .child(
      div()
        .class("raised-in menu-in")
        .children(
          items.map((item, n) => {
            const i = n + 1;
            if (item === "-") return div().key(`sep${i}`).class("menu-sep");
            const open = S.path[depth - 1] === i;
            return div()
              .key(`${item.label ?? ""}${i}`)
              .class(cls("menu-item", open && "open", item.disabled && "disabled"))
              .onMouseEnter(() => {
                S.path.length = depth - 1;
                if (item.items) S.path[depth - 1] = i;
                return false;
              })
              .onClick(() => {
                if (item.disabled) return true;
                if (item.items) {
                  S.path.length = depth - 1;
                  S.path[depth - 1] = i;
                  return true;
                }
                closeMenus(S);
                item.run?.();
                return true;
              })
              .child(div().class("menu-check").when(item.checked, (e) => e.child(text("✓"))))
              .child(item.icon ? image(item.icon, "menu-icon") : div().class("menu-icon"))
              .child(text(item.label ?? "").class("menu-label"))
              .when(item.items !== undefined, (e) => e.child(text("▶").class("menu-arrow")))
              .when(open && item.items !== undefined, (e) => e.child(menu(S, item.items!, depth + 1, "submenu")));
          }),
        ),
    );
}

// -- what the Start menu lists ----------------------------------------------------------------

/** The dock page a plugin's view is on: its own page, or the page with a section of its views. */
function pageOf(state: AppState, plugin: AppCorePlugin): AppPage | undefined {
  for (const page of state.pages) {
    if (page.id === plugin.name) return page;
    for (const section of page.sections) if (section.key.startsWith(`${plugin.name}/`)) return page;
  }
  return undefined;
}

function openPage(S: State, page: AppPage) {
  S.open[`page:${page.id}`] = true;
  raise(S, `page:${page.id}`);
}

function pluginsMenu(state: AppState, S: State): (Item | "-")[] {
  const items: (Item | "-")[] = state.plugins.map((plugin) => {
    const page = pageOf(state, plugin);
    return {
      icon: "plugin",
      label: plugin.label || plugin.name,
      checked: plugin.running,
      disabled: !plugin.running,
      run: () => (page ? openPage(S, page) : app.settings("plugins")),
    };
  });
  if (state.packages.length > 0) {
    items.push("-");
    for (const pkg of state.packages) {
      const views: Item[] = (pkg.views ?? []).map((v) => ({
        icon: "dos",
        label: v.label,
        run: () => app.openView(v.type, {}, { kind: "tab" }),
      }));
      items.push({
        icon: "folder",
        label: pkg.label || pkg.name || "",
        checked: pkg.active === true,
        ...(views.length > 0 ? { items: views } : {}),
        run: () => app.settings("packages"),
      });
    }
  }
  items.push("-");
  items.push({ icon: "settings", label: "Plugin Settings…", run: () => app.settings("plugins") });
  return items;
}

function sessionsMenu(state: AppState): (Item | "-")[] {
  return [
    ...state.spaces.map((space) => ({
      icon: "folder",
      label: space.label,
      checked: space.active,
      run: () => app.selectSpace(space.id),
    })),
    "-",
    { icon: "documents", label: "New Session…", run: () => app.run("new_workspace") },
    { icon: "find", label: "Open Session…", run: () => app.projects() },
  ];
}

const themesMenu = (state: AppState): Item[] =>
  state.themes.map((name) => ({ label: name, checked: name === state.ui_theme, run: () => app.setTheme(name) }));

function programsMenu(state: AppState, S: State): (Item | "-")[] {
  const items: (Item | "-")[] = [
    { icon: "dos", label: "MS-DOS Prompt", run: () => app.run("new_tab") },
    { icon: "globe", label: "Internet Explorer", run: () => app.openBrowser() },
  ];
  if (state.pages.length > 0) items.push("-");
  for (const page of state.pages) items.push({ icon: "folder", label: page.label, run: () => openPage(S, page) });
  return items;
}

function startItems(state: AppState, S: State): (Item | "-")[] {
  return [
    { icon: "dos", label: "Programs", items: programsMenu(state, S) },
    { icon: "plugin", label: "Plugins", items: pluginsMenu(state, S) },
    { icon: "documents", label: "Sessions", items: sessionsMenu(state) },
    {
      icon: "settings",
      label: "Settings",
      items: [
        { icon: "settings", label: "Control Panel", run: () => app.settings() },
        { icon: "computer", label: "Themes", items: themesMenu(state) },
        { icon: "dos", label: "Keyboard", run: () => app.settings("keys") },
      ],
    },
    { icon: "find", label: "Find", run: () => app.run("palette::Toggle") },
    { icon: "help", label: "Help", run: () => app.run("help") },
    { icon: "run", label: "Run…", run: () => (S.dialog = "run") },
    "-",
    { icon: "shutdown", label: "Shut Down…", run: () => (S.dialog = "shutdown") },
  ];
}

function startMenu(state: AppState, S: State): El {
  return div().id("startmenu").child(
    div().class("raised").child(
      div()
        .class("raised-in start-in")
        // Read bottom to top: the line turned a quarter anticlockwise.
        .child(
          div().class("banner").child(text("98").class("banner-thin")).child(text("Windows").class("banner-bold")),
        )
        .child(menu(S, startItems(state, S), 1, "start-items")),
    ),
  );
}

// -- windows ----------------------------------------------------------------------------------

interface MenuBar {
  label: string;
  items: (Item | "-")[];
}

interface WindowSpec {
  key: string;
  title: string;
  icon?: string;
  active?: boolean;
  of?: string;
  menus?: MenuBar[];
  body: El;
  status?: string;
  onfocus?: () => void;
  onclose?: () => void;
}

/** A window: its caption (dragged to move, twice pressed to make it full), its menu bar, its body,
 * its status line, and its grip (dragged to resize). Pressing it raises it. */
function window_(S: State, t: WindowSpec, desk: { w: number; h: number }, n: number): El | null {
  const s = place(S, t.key, n, desk);
  if (s.min) return null;
  const bar = S.bar && S.bar.win === t.key ? S.bar.menu : null;
  const win = div()
    .key(t.key)
    .class(cls("window", "raised", t.active && "active"))
    .whenSome(t.of, (e, of) => e.of(of))
    .left(px(s.max ? 0 : s.x))
    .top(px(s.max ? 0 : s.y))
    .w(px(s.max ? desk.w : s.w))
    .h(px(s.max ? desk.h - TASKBAR : s.h))
    .onMouseDown(() => {
      raise(S, t.key);
      t.onfocus?.();
      return false;
    });
  return win
    .child(
      div()
        .class("raised-in window-in")
        .child(
          div()
            .class("caption")
            .onDrag((ev) => {
              if (!s.max) {
                s.x += ev.data.dx ?? 0;
                s.y = Math.max(0, s.y + (ev.data.dy ?? 0));
              }
              return true;
            })
            .onDoubleClick(() => {
              s.max = !s.max;
              return true;
            })
            .child(t.icon ? image(t.icon, "caption-icon") : null)
            .child(text(t.title).class("caption-title"))
            .child(spacer())
            .child(captionButton("_", "Minimize", () => (s.min = true)))
            .child(
              captionButton(s.max ? "❐" : "□", s.max ? "Restore" : "Maximize", () => {
                s.max = !s.max;
              }),
            )
            .child(div().class("capgap"))
            .child(captionButton("✕", "Close", () => t.onclose?.())),
        )
        .when(t.menus !== undefined, (e) =>
          e.child(
            div()
              .class("menubar")
              .children(
                t.menus!.map((m, i) => {
                  const open = bar === i + 1;
                  return div()
                    .key(m.label)
                    .class(cls("menubar-item", open && "open"))
                    .onClick(() => {
                      S.bar = open ? null : { win: t.key, menu: i + 1 };
                      S.path = [];
                      S.menu = false;
                      return true;
                    })
                    .onMouseEnter(() => {
                      if (S.bar && S.bar.win === t.key) {
                        S.bar.menu = i + 1;
                        S.path = [];
                      }
                      return false;
                    })
                    .child(text(m.label))
                    .when(open, (e) => e.child(menu(S, m.items, 1, "dropdown")));
                }),
              ),
          ),
        )
        .child(div().class("client sunken").child(div().class("sunken-in client-in").child(t.body)))
        .when(t.status !== undefined, (e) =>
          e.child(div().class("window-status").child(div().class("sunken status-field").child(text(t.status!)))),
        ),
    )
    .when(!s.max, (e) =>
      e.child(
        div().class("grip").onDrag((ev) => {
          s.w = Math.max(220, s.w + (ev.data.dx ?? 0));
          s.h = Math.max(140, s.h + (ev.data.dy ?? 0));
          return true;
        }),
      ),
    );
}

function tabWindow(state: AppState, tab: AppTab, cx: ThemeContext<State>, desk: { w: number; h: number }, n: number): El | null {
  const S = cx.state;
  const focused = tab.panes.find((p) => p.focused);
  const key = `tab:${tab.id}`;
  return window_(
    S,
    {
      key,
      of: tab.of,
      title: tab.title,
      icon: tab.worktree ? "folder" : "dos",
      active: tab.active && S.top === key,
      onfocus: () => {
        if (!tab.active) app.selectTab(tab.id);
        S.top = key;
      },
      onclose: () => app.closeTab(tab.id),
      menus: [
        {
          label: "File",
          items: [
            { icon: "dos", label: "New Window", run: () => app.run("new_tab") },
            { label: "Split Right", run: () => app.split(focused ? focused.key : null, "right") },
            { label: "Split Down", run: () => app.split(focused ? focused.key : null, "down") },
            "-",
            {
              label: "Rename…",
              run: () => {
                app.selectTab(tab.id);
                app.startRename(`tab:${tab.id}`);
              },
            },
            {
              label: "Close Pane",
              disabled: focused === undefined,
              run: () => (focused ? app.closePane(focused.key) : undefined),
            },
            { label: "Close", run: () => app.closeTab(tab.id) },
          ],
        },
        {
          label: "Edit",
          items: [
            { label: "Clear", run: () => app.run("clear_pane") },
            { label: "Reopen Closed", run: () => app.run("reopen_closed") },
          ],
        },
        {
          label: "View",
          items: [
            { label: "Zoom Pane", checked: tab.zoomed, run: () => app.zoom() },
            { label: "Next Pane", run: () => app.run("cycle_pane_next") },
            { label: "Full Screen", checked: state.window.fullscreen, run: () => app.run("fullscreen") },
          ],
        },
        {
          label: "Help",
          items: [
            { icon: "help", label: "Help Topics", run: () => app.run("help") },
            { label: "About pumi", run: () => (S.dialog = "about") },
          ],
        },
      ],
      body: panes(tab, state, cx, `panes-${tab.id}`),
      status: focused ? focused.cwd || focused.kind : undefined,
    },
    desk,
    n,
  );
}

function pageWindow(page: AppPage, cx: ThemeContext<State>, desk: { w: number; h: number }, n: number): El | null {
  const S = cx.state;
  const key = `page:${page.id}`;
  return window_(
    S,
    {
      key,
      title: page.label,
      icon: "folder",
      active: S.top === key,
      onfocus: () => (S.top = key),
      onclose: () => delete S.open[key],
      menus: [{ label: "File", items: [{ label: "Close", run: () => delete S.open[key] }] }],
      body: div().class("explorer").child(pageBody(page)),
    },
    desk,
    n,
  );
}

// -- the desktop ------------------------------------------------------------------------------

function desktopIcons(state: AppState, S: State): El {
  const first = state.pages[0];
  const icons: [string, string, () => void][] = [
    ["computer", "My Computer", () => app.settings()],
    ["documents", "Sessions", () => app.projects()],
    ["dos", "MS-DOS Prompt", () => app.run("new_tab")],
    ["globe", "Internet Explorer", () => app.openBrowser()],
  ];
  if (first) icons.push(["folder", first.label, () => openPage(S, first)]);
  icons.push(["recycle", "Recycle Bin", () => app.run("reopen_closed")]);
  return div()
    .id("icons")
    .children(
      icons.map(([icon, name, open]) =>
        div()
          .key(name)
          .class(cls("desk-icon", S.selected === name && "selected"))
          .onClick(() => {
            S.selected = name;
            closeMenus(S);
            return true;
          })
          .onDoubleClick(() => {
            open();
            return true;
          })
          .child(image(icon, "desk-glyph"))
          .child(text(name).class("desk-label")),
      ),
    );
}

// -- the taskbar ------------------------------------------------------------------------------

function task(
  S: State,
  t: { key: string; title: string; icon: string; pressed?: boolean; of?: string; status?: string; onclick: () => void },
): El {
  return button(
    {
      key: t.key,
      class: cls("task", t.status && t.status !== "" && `status-${t.status}`),
      of: t.of,
      pressed: t.pressed,
      title: t.title,
      onclick: () => {
        t.onclick();
        closeMenus(S);
      },
    },
    image(t.icon, "task-icon"),
    text(t.title).class("task-title"),
  );
}

function taskbar(state: AppState, cx: ThemeContext<State>): El {
  const S = cx.state;
  const tasks: El[] = [];
  for (const tab of state.tabs) {
    const key = `tab:${tab.id}`;
    const s = S.win[key] ?? ({} as Place);
    tasks.push(
      task(S, {
        key,
        title: tab.title,
        icon: "dos",
        of: tab.of,
        status: tab.status,
        pressed: tab.active && S.top === key && !s.min,
        onclick: () => {
          if (tab.active && S.top === key && !s.min) s.min = true;
          else {
            s.min = false;
            raise(S, key);
            S.top = key;
            app.selectTab(tab.id);
          }
        },
      }),
    );
  }
  for (const page of state.pages) {
    const key = `page:${page.id}`;
    if (!S.open[key]) continue;
    const s = S.win[key] ?? ({} as Place);
    tasks.push(
      task(S, {
        key,
        title: page.label,
        icon: "folder",
        pressed: S.top === key && !s.min,
        onclick: () => {
          if (S.top === key && !s.min) s.min = true;
          else {
            s.min = false;
            raise(S, key);
            S.top = key;
          }
        },
      }),
    );
  }
  const working = state.agents.filter((a) => a.status === "working").length;
  const blocked = state.agents.filter((a) => a.status === "blocked").length;
  return div()
    .id("taskbar")
    .child(
      button(
        {
          id: "start",
          pressed: S.menu,
          onclick: () => {
            S.menu = !S.menu;
            S.path = [];
            S.bar = null;
          },
        },
        image("flag", "start-flag"),
        text("Start").class("start-label"),
      ),
    )
    .child(div().class("bar-sep"))
    .child(
      div()
        .id("quick")
        .child(
          button(
            { class: "quick", title: "MS-DOS Prompt", onclick: () => app.run("new_tab") },
            image("dos", "quick-icon"),
          ),
        )
        .child(
          button(
            { class: "quick", title: "Internet Explorer", onclick: () => app.openBrowser() },
            image("globe", "quick-icon"),
          ),
        ),
    )
    .child(div().class("bar-sep"))
    .child(div().id("tasks").children(tasks))
    .child(
      div()
        .id("tray")
        .class("sunken")
        .children(slotViews(state, "statusline", "tray-view"))
        .when(working > 0, (e) =>
          e.child(div().class("tray-agent working").title(`${working} working`).child(text(String(working)))),
        )
        .when(blocked > 0, (e) =>
          e.child(
            div()
              .class("tray-agent blocked")
              .title(`${blocked} blocked`)
              .onClick(() => {
                app.run("next_agent");
                return true;
              })
              .child(text(String(blocked))),
          ),
        )
        .child(text(state.clock).class("clock")),
    );
}

// -- dialogs ----------------------------------------------------------------------------------

function dialogWindow(title: string, body: El, buttons: El[], close: () => void, width = 340): El {
  return div().id("modal").onClick(() => true).child(
    div()
      .class("raised dialog")
      .w(px(width))
      .child(
        div().class("raised-in window-in").child(
          div()
            .class("caption")
            .child(text(title).class("caption-title"))
            .child(spacer())
            .child(captionButton("✕", "Close", close)),
        )
          .child(body)
          .child(div().class("dialog-buttons").children(buttons)),
      ),
  );
}

const dialogButton = (label: string, run: () => void, isDefault = false): El =>
  button({ class: cls("dialog-btn", isDefault && "default"), onclick: () => run() }, text(label));

/** The dialog open, if one is: Run, Shut Down, or About. */
function dialog(state: AppState, cx: ThemeContext<State>): El | null {
  const S = cx.state;
  const close = () => {
    S.dialog = null;
  };
  if (S.dialog === "shutdown") {
    return dialogWindow(
      "Shut Down Windows",
      div()
        .class("dialog-body")
        .child(image("shutdown", "dialog-icon"))
        .child(
          div()
            .class("dialog-text")
            .child(text("Are you sure you want to quit pumi?"))
            .child(text("Your sessions keep running in the server.").class("dim")),
        ),
      [dialogButton("Yes", () => app.quit(), true), dialogButton("No", close)],
      close,
    );
  }
  if (S.dialog === "run") {
    return dialogWindow(
      "Run",
      div()
        .class("dialog-body")
        .child(image("run", "dialog-icon"))
        .child(
          div()
            .class("dialog-text")
            .child(text("Type the name of a program, folder, or Internet resource, and pumi will open it for you."))
            .child(
              div()
                .class("run-row")
                .child(text("Open:"))
                .child(
                  input(S.lastRun).id("run-input").class("run-input sunken").focusable().onSubmit((ev) => {
                    S.lastRun = ev.value;
                    runLine(S, ev.value);
                    return true;
                  }),
                ),
            ),
        ),
      [dialogButton("Cancel", close)],
      close,
      380,
    );
  }
  if (S.dialog === "about") {
    return dialogWindow(
      "About pumi",
      div()
        .class("dialog-body")
        .child(image("computer", "dialog-icon"))
        .child(
          div()
            .class("dialog-text")
            .child(text("pumi").class("bold"))
            .child(text("A terminal workspace."))
            .child(text(`${state.plugins.length} plugins, ${state.packages.length} packages`).class("dim")),
        ),
      [dialogButton("OK", close, true)],
      close,
    );
  }
  return null;
}

/** What Run opens: a page, a folder, or a command line in a new window. */
function runLine(S: State, line: string) {
  S.dialog = null;
  const wanted = line.trim();
  if (wanted === "") return;
  if (/^https?:\/\//.test(wanted) || /^www\./.test(wanted)) app.openBrowser(wanted);
  else if (/^[/~]/.test(wanted)) app.openPath(wanted);
  else app.call("pumi_cmd", `new-window ${JSON.stringify(wanted)}`);
}

// -- the screen -------------------------------------------------------------------------------

function desktop(state: AppState, cx: ThemeContext<State>): El {
  const S = cx.state;
  const desk = { w: state.window.width, h: state.window.height };
  // Windows: every tab's, and every open page's, in the order they were raised.
  const wins = new Map<string, () => El | null>();
  let n = 0;
  for (const tab of state.tabs) {
    n += 1;
    const key = `tab:${tab.id}`;
    const at = n;
    wins.set(key, () => tabWindow(state, tab, cx, desk, at));
    if (tab.active && S.selectedTab !== tab.id) {
      S.selectedTab = tab.id;
      raise(S, key);
      S.top = key;
    }
  }
  for (const page of state.pages) {
    n += 1;
    const key = `page:${page.id}`;
    if (S.open[key]) {
      const at = n;
      wins.set(key, () => pageWindow(page, cx, desk, at));
    }
  }
  // New windows on top, then the raised order without what has gone.
  for (const key of wins.keys()) if (!S.win[key]) raise(S, key);
  S.order = S.order.filter((key) => wins.has(key));
  const drawn = S.order.map((key) => wins.get(key)!());
  return div()
    .id("desktop")
    .class(state.window.active ? "active" : "inactive")
    .onClick(() => {
      closeMenus(S);
      S.selected = null;
      return false;
    })
    .child(desktopIcons(state, S))
    .child(div().id("windows").children(drawn))
    .child(taskbar(state, cx))
    .when(S.menu, (e) => e.child(startMenu(state, S)))
    .child(dialog(state, cx))
    .child(
      div()
        .id("pumi-overlays")
        .css("position", "absolute")
        .left(px(0))
        .top(px(0))
        .wFull()
        .hFull()
        .css("pointer-events", "none")
        .css("z-index", "1000")
        .child(overlays(state, cx)),
    );
}

export default defineTheme<State>({
  name: "Windows 98",
  description: "A teal desktop, a window for each tab, and a Start menu of your plugins.",
  state: fresh,
  colors: { dark: TOKENS, light: TOKENS },
  metrics: {
    radius: 0,
    radius_sm: 0,
    radius_lg: 0,
    border: 1,
    font_size: 11,
    font_size_sm: 10,
    control_height: 22,
    spacing: 3,
  },
  fonts: { font: "Tahoma" },
  vars: OWN,
  render(state, cx) {
    return desktop(state, cx);
  },
});
