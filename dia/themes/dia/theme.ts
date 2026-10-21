// Dia as a pumi UI theme: one frosted sidebar of pinned tiles and tabs, the panes on a card beside
// it, and the tokens both are drawn in. Ported from this package's `theme.lua`, which extended the
// default theme; what it drew from there is copied into `src/` (`parts.ts`, `panes.ts`, `docks.ts`,
// `overlays.ts`) until the SDK grows `extends` or a shared default window.
//
// After the Dia browser. The sidebar is the whole chrome: the plugins' pages pinned as tiles at its
// top, your other sessions as folders, then this session's tabs as rows. The panes sit on one
// rounded card beside it, under a quiet toolbar.
import { app, defineTheme, div, icon, input, px, text, type AppPage, type AppSpace, type AppState, type AppPane, type AppTab, type El, type ThemeContext } from "pumi";
import { bottom, handle, pageBody, secondary, size } from "../../src/docks.ts";
import { overlays } from "../../src/overlays.ts";
import { panes } from "../../src/panes.ts";
import { activeTab, dot, fresh as freshWindow, iconButton, label, num, opt, pages, pointButtons, s, slot, spacer, truthy, type Cx, type State as WindowState } from "../../src/parts.ts";

/** What the theme keeps between renders: the default theme's (a drag under way, a dock's size, a
 * divider's ratio) and Dia's own, the page pinned in the sidebar. */
export interface State extends WindowState {
  /** The pinned page the sidebar shows instead of the tabs; `null` for the tabs. */
  page: string | null;
}
const fresh = (): State => ({ ...freshWindow(), page: null });

// -- the sidebar ---------------------------------------------------------------------------

/** A tab's "favicon": its agent's state when it has one, else what its first pane holds. */
function tabIcon(t: AppTab): El {
  const status = s(t, "status");
  if (status !== "" && status !== "idle") return dot(status);
  const first = t.panes[0];
  const kind = first ? s(first, "kind") : "terminal";
  const name = kind === "browser" ? "tool_web" : kind === "document" ? "code" : truthy(t.worktree) ? "git_branch" : "terminal";
  return icon(name).class("dia-favicon");
}

/** What one pane holds, as its icon: its agent's state, else its kind. */
function paneIcon(p: AppPane): El {
  const status = s(p, "status");
  if (status !== "" && status !== "idle") return dot(status);
  const kind = s(p, "kind");
  const name = kind === "browser" ? "tool_web" : kind === "document" ? "code" : "terminal";
  return icon(name).class("dia-favicon");
}

/** One pane of a split tab, as Dia draws a split view: its icon, its title and its own close,
 * side by side with the others in the tab's row. Clicking it goes to that pane. */
function segment(p: AppPane, tab: AppTab): El {
  const title = s(p, "title") || s(p, "kind");
  return div()
    .key(p.key)
    .class("dia-seg")
    .when(tab.active && p.focused, (e) => e.class("focused"))
    .when(p.id !== "", (e) => e.of(p.id))
    .title(title)
    .onClick(() => {
      if (!tab.active) app.selectTab(tab.id);
      app.focusPane(p.key);
      return true;
    })
    .child(div().class("dia-icon").child(paneIcon(p)))
    .child(label("dia-label", title))
    .child(iconButton("close", "Close Pane", () => app.closePane(p.key)).class("dia-close"));
}

/** A tab of the session: a row of its own, or a split tab's panes side by side in it. */
function tab(t: AppTab, state: AppState): El {
  const id = t.id;
  const renaming = state.renaming === `tab:${id}`;
  const shown = t.panes.filter((p) => !p.hidden);
  const split = shown.length > 1 && !renaming;
  const worktree = opt(t, "worktree");
  return div()
    .key(`tab${id}`)
    .class("dia-row")
    .class("dia-tab")
    .when(t.active, (e) => e.class("active"))
    .when(split, (e) => e.class("split"))
    .of(t.of)
    .title(truthy(worktree) ? `Worktree ${worktree}` : t.title)
    .draggable({ tab: id })
    .onDrop((e) => {
      const d = e.dragged as { tab?: number; pane?: string } | null;
      if (truthy(d?.tab) && d!.tab !== id) app.moveTab(d!.tab!, id);
      if (truthy(d?.pane)) app.movePaneToTab(d!.pane!, id);
      return true;
    })
    .onClick(() => {
      app.selectTab(id);
      return true;
    })
    .onDoubleClick(() => {
      app.startRename(`tab:${id}`);
      return true;
    })
    .onMouseDown((e) => {
      if (e.data.button === "middle") {
        app.closeTab(id);
        return true;
      }
      return false;
    })
    .onContextMenu((e) => {
      app.tabMenu(id, num(e, "wx"), num(e, "wy"));
      return true;
    })
    .when(split, (e) => e.children(shown.map((p) => segment(p, t))))
    .when(!split, (e) => e.child(div().class("dia-icon").child(tabIcon(t))))
    .when(!split, (e) =>
      e.child(
        renaming
          ? input(opt(t, "label") ?? t.title)
              .class("dia-rename")
              .focusable()
              .onSubmit((ev) => {
                app.renameTab(id, ev.value);
                return true;
              })
          : label("dia-label", t.title),
      ),
    )
    .when(!split, (e) => e.child(iconButton("close", "Close Tab", () => app.closeTab(id)).class("dia-close")));
}

/** A session, as one of Dia's folders: the current one open, the rest a click away. */
function folder(space: AppSpace): El {
  const status = s(space, "status");
  const busy = status !== "" && status !== "idle";
  return div()
    .key(`space${space.id}`)
    .class("dia-row")
    .class("dia-folder")
    .when(space.active, (e) => e.class("current"))
    .title(`${space.tabs} ${space.tabs === 1 ? "tab" : "tabs"}`)
    .onClick(() => {
      if (!space.active) app.selectSpace(space.id);
      return true;
    })
    .onContextMenu(() => {
      app.projects();
      return true;
    })
    .child(
      div()
        .class("dia-icon")
        .child(busy ? dot(status) : icon(space.active ? "folder_open" : "folder").class("dia-favicon")),
    )
    .child(label("dia-label", space.label))
    .child(icon(space.active ? "chevron_down" : "chevron_right").class("dia-chevron"));
}

/** The plugins' pages, pinned: four to a row, the open one lifted. */
function tiles(docked: AppPage[], state: State): El | null {
  if (docked.length === 0) return null;
  return div()
    .id("dia-tiles")
    .children(
      docked.map((p) =>
        div()
          .key(p.id)
          .class("dia-tile")
          .when(state.page === p.id, (e) => e.class("active"))
          .title(p.label)
          .onClick(() => {
            state.page = state.page === p.id ? null : p.id;
            return true;
          })
          .child(icon(p.icon ?? "package")),
      ),
    );
}

/** A pinned page, in the sidebar where the tabs would be. */
function pinned(page: AppPage, cx: ThemeContext<State>): El {
  return div()
    .id("dia-page")
    .child(
      div()
        .class("dia-page-head")
        .child(label("dia-page-title", page.label))
        .child(spacer())
        .child(
          iconButton("close", "Back to Tabs", () => {
            cx.state.page = null;
          }),
        ),
    )
    .child(pageBody(page, "primary", cx));
}

/** The folders, the new tab and the tabs, one under the other. */
function tabList(state: AppState): El {
  return div()
    .id("dia-list")
    .children(state.spaces.map((space) => folder(space)))
    .child(div().class("dia-sep"))
    .child(
      div()
        .class("dia-row")
        .class("dia-new")
        .onClick(() => {
          app.run("new_tab");
          return true;
        })
        .onContextMenu((e) => {
          app.newMenu(num(e, "wx"), num(e, "wy"), 0, 0);
          return true;
        })
        .child(div().class("dia-icon").child(icon("plus").class("dia-favicon")))
        .child(label("dia-label", "New Tab")),
    )
    .children(state.tabs.map((t) => tab(t, state)));
}

/** The agents waiting, as counts: a press goes to the next one. */
function agents(state: AppState): El {
  const count = (status: string) => state.agents.filter((a) => a.status === status).length;
  return div()
    .id("agents-summary")
    .children(
      ["blocked", "working", "done", "error"]
        .filter((status) => count(status) > 0)
        .map((status) =>
          div()
            .key(status)
            .class("agent-count")
            .title(`${count(status)} ${status}`)
            .onClick(() => {
              app.run("next_agent");
              return true;
            })
            .child(dot(status))
            .child(text(String(count(status)))),
        ),
    );
}

/** On macOS, where the window's own buttons are drawn when they are not in a header. */
const lights = (state: AppState): boolean => state.platform === "macos" && !state.window.fullscreen;

function sidebar(state: AppState, cx: ThemeContext<State>): El {
  const st = cx.state;
  const docked = pages(state, "primary");
  const open = docked.find((p) => p.id === st.page);
  if (!open) st.page = null;
  const w = state.window;
  return div()
    .id("dia-sidebar")
    .w(px(size(st, "sidebar", w.sidebar_width)))
    .child(
      div()
        .id("dia-top")
        .onDoubleClick((e) => {
          if (e.target?.id === "dia-top") app.run("zoom_window");
          return false;
        })
        .when(lights(state), (e) => e.child(div().class("traffic-lights")))
        .child(spacer())
        .children(slot(state, "titlebar.left", ""))
        .child(iconButton("chevron_up_down", "Sessions", () => app.projects()).id("space")),
    )
    .child(tiles(docked, st))
    .children(slot(state, "sidebar.head", "sidebar-head"))
    .child(open ? pinned(open, cx) : tabList(state))
    .child(
      div()
        .id("dia-foot")
        .child(agents(state))
        .child(spacer())
        .children(slot(state, "statusline", "status-view")),
    )
    .child(handle("sidebar", "right", w.sidebar_width, st));
}

// -- the card ------------------------------------------------------------------------------

function toolbar(state: AppState, cx: ThemeContext<State>): El {
  const w = state.window;
  const tab = activeTab(state);
  const focused = state.focused;
  const items = state.menus.ToolBar ?? [];
  return div()
    .id("dia-toolbar")
    .when(!w.sidebar, (e) => e.class("no-sidebar"))
    .onDoubleClick((e) => {
      if (e.target?.id === "dia-toolbar") app.run("zoom_window");
      return false;
    })
    .when(!w.sidebar && lights(state), (e) => e.child(div().class("traffic-lights")))
    .child(iconButton("layout_sidebar_left", "Side Bar", () => app.toggle("sidebar")).id("toggle-sidebar"))
    .whenSome(focused, (e, key) => e.child(iconButton("split", "Split Right", () => app.split(key, "right"))))
    .whenSome(focused, (e, key) => e.child(iconButton("split_down", "Split Down", () => app.split(key, "down"))))
    .when(tab !== undefined && tab.panes.length > 1, (e) =>
      e.child(iconButton(tab!.zoomed ? "minimize" : "maximize", "Zoom", () => app.zoom())),
    )
    .children(pointButtons(items, "ToolBar", null, true))
    .child(spacer())
    .children(slot(state, "ToolBar", "toolbar-view"))
    .children(pointButtons(items, "ToolBar", null, false))
    .children(slot(state, "titlebar.right", ""))
    .whenSome(state.notice, (e, notice) => e.child(label("dia-notice", notice)))
    .when(pages(state, "secondary").length > 0, (e) =>
      e.child(
        iconButton("layout_sidebar_right", "Secondary Side Bar", () => app.toggle("secondary"))
          .id("toggle-secondary")
          .when(w.secondary, (b) => b.class("active")),
      ),
    )
    .child(
      div()
        .id("dia-settings")
        .title("Settings")
        .onClick(() => {
          app.settings();
          return true;
        })
        .child(icon("settings"))
        .child(text("Settings")),
    );
}

function card(state: AppState, cx: ThemeContext<State>): El {
  const at: Cx = { app: state, cx };
  return div()
    .id("dia-card")
    .child(toolbar(state, cx))
    .child(panes(at, activeTab(state)))
    .when(state.window.bottom, (e) => e.child(bottom(at)));
}

function window(state: AppState, cx: ThemeContext<State>): El {
  const w = state.window;
  return div()
    .id("window")
    .class("dia")
    .class(state.appearance)
    .class(w.active ? "active" : "inactive")
    .when(!w.sidebar, (e) => e.class("bare"))
    .when(w.sidebar, (e) => e.child(sidebar(state, cx)))
    .child(card(state, cx))
    .when(w.secondary && pages(state, "secondary").length > 0, (e) => e.child(secondary({ app: state, cx })));
}

// Dia's own colours, and then the app's tokens, so Settings, the menus and every plugin are drawn
// in them too: a light set and a dark one.
const dark: Record<string, string> = {
  dia_top: "#2b3540",
  dia_bottom: "#394854",
  dia_card: "#202327",
  dia_tile: "#ffffff12",
  dia_tile_hover: "#ffffff1c",
  dia_tile_active: "#ffffff2b",
  dia_row_hover: "#ffffff0f",
  dia_row_active: "#1d2024",
  dia_ink: "#eef1f4",
  dia_ink_muted: "#b9c2cb",
  dia_orb: "#8fa6c4",
  dia_orb2: "#4d607a",
  dia_ask: "#2a2d31",
  dia_line: "#ffffff12",
  window: "#2b3540",
  bg: "#1a1d21",
  chrome_surface: "#ffffff14",
  chrome_selected: "#ffffff2e",
  chrome_border: "#ffffff0f",
  text: "#eef1f4",
  chrome_muted: "#b2bac2",
  faint: "#7f8892",
  accent: "#78aef5",
  surface: "#24282d",
  hover: "#ffffff12",
  active: "#ffffff1f",
  border: "#ffffff17",
  border_variant: "#ffffff0d",
  element: "#ffffff14",
  focus_ring: "#78aef5",
  surface_text: "#e3e7eb",
  muted: "#a3acb5",
  placeholder: "#6c757e",
  editor: "#202327",
  selection: "#2f4a6e",
  row_selected: "#ffffff2e",
  primary: "#5b9bf0",
  primary_hover: "#6ea8f3",
  primary_active: "#4a8be0",
  primary_foreground: "#ffffff",
  success: "#7cc58f",
  warning: "#e6b450",
  error: "#ef6b6b",
  overlay: "#15181bd9",
  "terminal.background": "#202327",
};
const light: Record<string, string> = {
  dia_top: "#e4edf4",
  dia_bottom: "#d2dfe9",
  dia_card: "#ffffff",
  dia_tile: "#ffffff8c",
  dia_tile_hover: "#ffffffbf",
  dia_tile_active: "#ffffff",
  dia_row_hover: "#0000000a",
  dia_row_active: "#ffffff",
  dia_ink: "#1b2127",
  dia_ink_muted: "#56616b",
  dia_orb: "#9db6d8",
  dia_orb2: "#6d86ab",
  dia_ask: "#f6f8fa",
  dia_line: "#00000012",
  window: "#e4edf4",
  bg: "#fbfcfd",
  chrome_surface: "#fffffff5",
  chrome_selected: "#fffffff2",
  chrome_border: "#00000012",
  text: "#1b2127",
  chrome_muted: "#56616b",
  faint: "#86909a",
  accent: "#4a8fe7",
  surface: "#f6f8fa",
  hover: "#0000000d",
  active: "#00000017",
  border: "#0000001a",
  border_variant: "#00000010",
  element: "#0000000f",
  focus_ring: "#4a8fe7",
  surface_text: "#1f262d",
  muted: "#5f6a74",
  placeholder: "#9aa4ad",
  editor: "#ffffff",
  selection: "#c4dcfb",
  row_selected: "#fffffff2",
  primary: "#4a8fe7",
  primary_hover: "#5d9cec",
  primary_active: "#3b7fd6",
  primary_foreground: "#ffffff",
  success: "#3f9b5a",
  warning: "#c98a12",
  error: "#d9534f",
  overlay: "#e6edf3d9",
  "terminal.background": "#ffffff",
};

export default defineTheme<State>({
  name: "Dia",
  description: "One frosted sidebar of pinned tiles, folders and tabs; the panes on a card beside it.",
  backdrop: "blurred",
  state: fresh,
  colors: { dark, light },
  // Soft, like Dia: round cards, rounder tiles, comfortable rows.
  metrics: { radius: 8, radius_sm: 6, radius_lg: 12, control_height: 28 },
  /** The window, and what opens over it. */
  render(state, cx) {
    return div()
      .id("pumi-root")
      .css("position", "relative")
      .wFull()
      .hFull()
      .flex()
      .flexCol()
      .child(window(state, cx))
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
          .child(overlays({ app: state, cx })),
      );
  },
});
