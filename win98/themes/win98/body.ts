// What a window holds: a tab's panes, and a dock page's sections. The Lua theme borrowed these
// from the default theme's components (`C.Panes`, `C.PaneStrip`, `C.PageBody`, `C.Slot`); a TS
// theme has none to borrow, so they are drawn here, with the default theme's classes (so the
// default's base.css styles them) and win98's own on top (style.css).
import {
  app,
  div,
  icon,
  input,
  native,
  px,
  relative,
  text,
  type AppPane,
  type AppPage,
  type AppSection,
  type AppState,
  type AppTab,
  type AppDivider,
  type El,
  type ElementEvent,
  type Side,
  type ThemeContext,
} from "pumi";
import type { State } from "./theme.ts";

const cls = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(" ");
const word = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
const spacer = (): El => div().class("spacer");
const dot = (status: string): El => div().class("dot").when(status !== "", (e) => e.class(`status-${status}`));

/** An icon that is a button: a press runs `click`, and stops there. */
const iconButton = (name: string, title: string, click: () => void): El =>
  div()
    .class("icon-button")
    .title(title)
    .onClick(() => {
      click();
      return true;
    })
    .child(icon(name));

/** A pane a plugin draws, at its own width if it has one. */
const ownedView = (v: { view: string; pane: string; width: number | null }, classNames: string): El =>
  native(v.view)
    .key(word(v.pane))
    .class(classNames)
    .whenSome(typeof v.width === "number" ? v.width : undefined, (e, w) => e.w(px(w)));

// -- a tab's panes ----------------------------------------------------------------------------

/** The panes of a tab: each at its fraction of the tab, with its strip and its body, and the
 * dividers between them. The id is where its dividers' drags measure from. */
export function panes(tab: AppTab, state: AppState, cx: ThemeContext<State>, id: string): El {
  if (tab.panes.length === 0) return div().id(id).class("panes").child(empty("This view is empty", [["New Terminal", "split_vertical"], ["Open File…", "open_file"]]));
  return div()
    .id(id)
    .class("panes")
    .when(tab.zoomed, (e) => e.class("zoomed"))
    .of(tab.of)
    .children(tab.panes.filter((p) => !p.hidden).map((p) => pane(p, tab, state)))
    .children(tab.dividers.map((d) => divider(d, tab, cx, id)));
}

function empty(message: string, actions: [string, string][]): El {
  return div()
    .class("empty")
    .child(icon("pumi").class("empty-icon"))
    .child(text(message).class("empty-title"))
    .child(
      div()
        .class("empty-actions")
        .children(
          actions.map(([name, command]) =>
            div()
              .class("button")
              .onClick(() => {
                app.run(command);
                return true;
              })
              .child(text(name)),
          ),
        ),
    );
}

function pane(p: AppPane, tab: AppTab, state: AppState): El {
  return div()
    .key(p.key)
    .class("pane")
    .when(p.focused, (e) => e.class("focused"))
    .when(p.zoomed, (e) => e.class("zoomed"))
    .class(`kind-${p.kind || "terminal"}`)
    .of(p.id)
    .left(relative(p.x))
    .top(relative(p.y))
    .w(relative(p.w))
    .h(relative(p.h))
    .onMouseDown(() => {
      if (!p.focused) app.focusPane(p.key);
      return false;
    })
    .onDrop((e) => {
      const moved = (e.dragged as { pane?: string } | undefined)?.pane;
      if (moved && moved !== p.key) app.movePane(moved, p.key, dropSide(e));
      return true;
    })
    .child(
      div()
        .class("pane-cell")
        .when(p.x > 0.0001, (e) => e.class("has-left"))
        .when(p.y > 0.0001, (e) => e.class("has-top"))
        .child(paneStrip(p, tab, state))
        .children(p.winbar.map((v) => ownedView(v, "winbar")))
        .child(native(p.view).class("pane-body"))
        .children(p.winbar_bottom.map((v) => ownedView(v, "winbar winbar-bottom"))),
    );
}

/** Which edge of the pane under the pointer a dropped pane goes beside; none in its middle (the
 * two swap). */
function dropSide(e: ElementEvent): Side | null {
  const under = e.data.current;
  if (!under || under.width === 0) return null;
  const fx = ((e.data.x ?? 0) - under.x) / under.width;
  const fy = ((e.data.y ?? 0) - under.y) / under.height;
  if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) return null;
  let best: [number, Side | null] = [2, null];
  for (const [side, edge] of [
    ["left", fx],
    ["right", 1 - fx],
    ["up", fy],
    ["down", 1 - fy],
  ] as [Side, number][]) {
    if (edge < best[0]) best = [edge, side];
  }
  return best[1];
}

/** A pane's strip: its title, its status and its buttons; dragged by it, a pane goes beside
 * another. A lone pane with nothing in its strip has none — the window's caption names it. */
function paneStrip(p: AppPane, tab: AppTab, state: AppState): El | null {
  if (tab.panes.length < 2 && p.strip.length === 0) return null;
  const renaming = state.renaming === `pane:${p.key}`;
  const title = p.title || p.kind;
  const start = p.strip.filter((v) => v.start);
  const end = p.strip.filter((v) => !v.start);
  return div()
    .class("pane-strip")
    .of(p.id)
    .draggable({ pane: p.key })
    .onDoubleClick(() => {
      app.focusPane(p.key);
      app.zoom();
      return true;
    })
    .children(start.map((v) => ownedView(v, "strip-view")))
    .child(dot(p.status))
    .child(renaming ? renameField(title, (to) => app.renamePane(p.key, to)) : text(title).class("pane-title"))
    .child(spacer())
    .child(
      div()
        .class("pane-buttons")
        .children(end.map((v) => ownedView(v, "strip-view")))
        .child(iconButton("split", "Split Right", () => app.split(p.key, "right")))
        .child(iconButton("split_down", "Split Down", () => app.split(p.key, "down")))
        .when(tab.panes.length > 1, (e) =>
          e.child(
            iconButton(p.zoomed ? "minimize" : "maximize", "Zoom", () => {
              app.focusPane(p.key);
              app.zoom();
            }),
          ),
        )
        .child(iconButton("close", "Close Pane", () => app.closePane(p.key))),
    );
}

/** A name edited in place: Enter or a press elsewhere ends it, renaming only when the name
 * changed; Escape (the app's) leaves it as it was. */
function renameField(value: string, rename: (to: string) => void): El {
  const done = (e: ElementEvent) => {
    if (e.value !== value) rename(e.value);
    else app.finishRename();
    return true;
  };
  return input(value).class("pane-rename").focusable().onSubmit(done).onBlur(done);
}

/** The edge between two panes, dragged to share their space: the ratio follows live, and is kept
 * when the drag ends. */
function divider(d: AppDivider, tab: AppTab, cx: ThemeContext<State>, id: string): El {
  const row = d.axis === "row";
  const path = word(d.path);
  const e = div()
    .key(`div${path}`)
    .class("divider")
    .class(row ? "vertical" : "horizontal");
  const placed = row
    ? e.left(relative(d.x + d.w * d.ratio)).top(relative(d.y)).h(relative(d.h))
    : e.top(relative(d.y + d.h * d.ratio)).left(relative(d.x)).w(relative(d.w));
  return placed
    .onDrag((ev) => {
      const area = cx.rect(id);
      if (!area) return true;
      const now = cx.state.ratios[path] ?? d.ratio;
      const delta = row ? (ev.data.dx ?? 0) / (d.w * area.width) : (ev.data.dy ?? 0) / (d.h * area.height);
      const next = Math.min(0.95, Math.max(0.05, now + delta));
      cx.state.ratios[path] = next;
      app.setRatio(tab.id, path, next, false);
      return true;
    })
    .onDragEnd(() => {
      const held = cx.state.ratios[path];
      if (held !== undefined) app.setRatio(tab.id, path, held, true);
      cx.state.ratios = {};
      return false;
    });
}

// -- a dock page in a window ------------------------------------------------------------------

/** A page's sections, each a plugin's view: the first open, the others open or folded, and a
 * header that folds one. */
export function pageBody(page: AppPage | undefined): El {
  if (!page) return div().class("page-empty").child(text("No plugins running. Turn one on in Settings."));
  const stacked = page.sections.length > 1;
  return div()
    .key(page.id)
    .class("page")
    .children(page.sections.map((sec, i) => section(sec, stacked, i === 0)));
}

function section(sec: AppSection, stacked: boolean, first: boolean): El {
  const open = !stacked || first || !sec.collapsed;
  return div()
    .key(sec.key)
    .id(`section-${sec.key}`)
    .class("section")
    .when(open, (e) => e.class("open"))
    .when(open && stacked, (e) => e.flexGrow(sec.size))
    .when(stacked, (e) =>
      e.child(
        div()
          .class("section-header")
          .onClick(() => {
            if (!first) app.toggleSection(sec.key);
            return true;
          })
          .when(!first, (h) => h.child(icon(open ? "chevron_down" : "chevron_right").class("chevron")))
          .child(text(sec.label).class("section-label")),
      ),
    )
    .when(open, (e) => e.child(native(sec.view).class("section-body")));
}

/** The views the app places in a slot (`statusline` is the tray's), each drawn by its plugin. */
export function slotViews(state: AppState, name: string, classNames: string): El[] {
  return (state.slots[name] ?? []).map((v) => ownedView(v, `slot-view ${classNames}`));
}
