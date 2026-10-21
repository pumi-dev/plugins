// Copied from pumi's default theme (`runtime/bun/examples/default-theme/themes/classic/header.ts`),
// which alltabs extends: its own is the tabs row, every session's tabs in groups. A stopgap until
// the SDK grows `extends` or a shared default window.
//
// The header: the session, the tabs, the titlebar slots and the toolbar
// (src/ui/shell/default_theme/header.rs).
import { app, div, icon, text, type AppPointItem, type AppState, type AppTab, type El } from "pumi";
import { b, dot, dragged, iconButton, label, num, opt, renameField, s, slot, spacer, truthy, word, type Cx } from "./parts.ts";

export function header({ app: state }: Cx): El {
  const lights = state.platform === "macos" && !state.window.fullscreen;
  return div()
    .id("header")
    .onDoubleClick((e) => {
      if (e.target?.id === "header") app.run("zoom_window");
      return false;
    })
    .when(lights, (e) => e.child(div().class("traffic-lights")))
    .child(spaceButton(state))
    .child(div().class("header-sep"))
    .children(slot(state, "titlebar.left", ""))
    .child(tabs(state))
    .child(spacer())
    .children(slot(state, "titlebar.right", ""))
    .child(toolbar(state));
}

function spaceButton(state: AppState): El {
  const name = state.space?.label ?? "No session";
  return div()
    .id("space")
    .title("Sessions")
    .onClick(() => {
      app.projects();
      return true;
    })
    .child(label("space-label", name))
    .child(icon("chevron_up_down").class("space-chevron"));
}

function tabs(state: AppState): El {
  return div()
    .id("tabs")
    .children(everySession(state) ? tabGroups(state) : state.tabs.map((t) => tab(t, state)))
    .child(iconButton("plus", "New Tab", () => app.run("new_tab")).id("new-tab"))
    .child(
      div()
        .id("new-menu")
        .class("icon-button")
        .title("New…")
        .onClick((e) => {
          const r = e.data.current;
          if (r) app.newMenu(r.x + num(e, "ox"), r.y + num(e, "oy"), r.width, r.height);
          return true;
        })
        .child(icon("chevron_down")),
    );
}

/** Whether the header shows every session's tabs (`all_sessions`, on until it is turned off). */
function everySession(state: AppState): boolean {
  return state.settings["all_sessions"] !== false;
}

/** Every session's tabs, one group a session, a separator between them: a session's tabs that are
 * not the one in front draw as tabs of that session, and none of them is `active`. */
function tabGroups(state: AppState): El[] {
  const groups: El[] = [];
  for (const space of state.spaces) {
    if (space.tab_list.length === 0) continue;
    if (groups.length > 0) groups.push(div().class("tab-group-sep"));
    groups.push(
      div()
        .key(`group${space.id}`)
        .class("tab-group")
        .when(space.active, (e) => e.class("active"))
        .title(space.label)
        .children(space.tab_list.map((t) => tab(space.active ? t : { ...t, active: false }, state))),
    );
  }
  return groups;
}

function tab(t: AppTab, state: AppState): El {
  const id = t.id;
  const renaming = state.renaming === `tab:${word(id)}`;
  const worktree = opt(t, "worktree");
  const title = t.title;
  return div()
    .key(`tab${word(id)}`)
    .class("tab")
    .when(t.active, (e) => e.class("active"))
    .of(t.of)
    .whenSome(worktree, (e, w) => e.title(`Worktree ${w}`))
    .draggable({ tab: id })
    .onDrop((e) => {
      const d = dragged(e);
      if (truthy(d.tab) && d.tab !== id) app.moveTab(d.tab!, id);
      if (truthy(d.pane)) app.movePaneToTab(d.pane!, id);
      return true;
    })
    .onClick(() => {
      app.selectTab(id);
      return true;
    })
    .onDoubleClick(() => {
      app.startRename(`tab:${word(id)}`);
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
    .child(dot(t.status))
    .when(worktree !== undefined, (e) => e.child(icon("git_branch").class("tab-icon")))
    .child(
      renaming
        ? renameField("tab-rename", opt(t, "label") ?? title, (v) => app.renameTab(id, v))
        : text(title).class("tab-title"),
    )
    .child(iconButton("close", "Close Tab", () => app.closeTab(id)).class("tab-close"));
}

/** A point's items as buttons (`ToolBar`, `PaneStrip`): those that go at the start, or the rest;
 * separators either way. */
export function pointButtons(items: AppPointItem[], point: string, pane: string | null, start: boolean): El[] {
  const out: El[] = [];
  for (const item of items) {
    const path = item.path;
    if (item.separator) {
      out.push(div().key(path).class("point-sep"));
      continue;
    }
    if (b(item, "start") !== start) continue;
    const enabled = b(item, "enabled");
    const itemLabel = item.label;
    const name = opt(item, "icon");
    out.push(
      div()
        .key(path)
        .class("icon-button point-button")
        .when(b(item, "checked"), (e) => e.class("checked"))
        .when(!enabled, (e) => e.class("disabled"))
        .title(opt(item, "desc") ?? itemLabel)
        .onClick((e) => {
          if (enabled) app.choose(point, path, pane, num(e, "wx"), num(e, "wy"));
          return true;
        })
        .child(name !== undefined ? icon(name) : label("point-label", itemLabel)),
    );
  }
  return out;
}

function toolbar(state: AppState): El {
  const w = state.window;
  const items = state.menus.ToolBar ?? [];
  return div()
    .id("toolbar")
    .children(pointButtons(items, "ToolBar", null, true))
    .children(slot(state, "ToolBar", "toolbar-view"))
    .children(pointButtons(items, "ToolBar", null, false))
    .child(toggle("toggle-sidebar", "layout_sidebar_left", "Side Bar", w.sidebar, "sidebar"))
    .child(toggle("toggle-panel", "layout_panel_bottom", "Panel", w.bottom, "bottom"))
    .child(toggle("toggle-secondary", "layout_sidebar_right", "Secondary Side Bar", w.secondary, "secondary"))
    .child(iconButton("settings", "Settings", () => app.settings()).id("open-settings"));
}
const toggle = (id: string, name: string, title: string, active: boolean, what: "sidebar" | "secondary" | "bottom"): El =>
  iconButton(name, title, () => app.toggle(what))
    .id(id)
    .when(active, (e) => e.class("active"));
