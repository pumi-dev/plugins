// Copied from pumi's default theme (`runtime/bun/examples/default-theme/themes/classic/panes.ts`),
// which alltabs extends and does not replace. A stopgap until the SDK grows `extends` or a shared
// default window.
//
// The panes of the tab in front: each with its strip, its winbars and its body, the dividers
// between them, and what an empty tab says (src/ui/shell/default_theme/panes.rs).
import { app, div, icon, native, text, type AppDivider, type AppPane, type AppState, type AppTab, type El, type ElementEvent, type Side } from "pumi";
import { pointButtons } from "./header.ts";
import { b, dot, dragged, iconButton, label, list, num, opt, ownedView, pct, renameField, s, spacer, truthy, word, type Cx } from "./parts.ts";

export function panes(cx: Cx, tab: AppTab | undefined): El {
  if (!tab) return div().id("panes").child(empty("No view open", [["New Terminal", "new_tab"]]));
  if (tab.panes.length === 0) {
    return div().id("panes").child(
      empty("This view is empty", [
        ["New Terminal", "split_vertical"],
        ["Open File…", "open_file"],
      ]),
    );
  }
  return div()
    .id("panes")
    .class("panes")
    .when(tab.zoomed, (e) => e.class("zoomed"))
    .of(tab.of)
    .children(tab.panes.filter((p) => !p.hidden).map((p) => pane(p, tab, cx)))
    .children(tab.dividers.map((d) => divider(d, tab, cx)));
}

function empty(message: string, actions: [string, string][]): El {
  return div()
    .class("empty")
    .child(icon("pumi").class("empty-icon"))
    .child(label("empty-title", message))
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

/** Which edge of the pane under the pointer a dropped pane goes beside; none in its middle (the
 * two swap). */
function dropSide(e: ElementEvent): Side | null {
  const t = e.data.current;
  if (!t || t.width === 0) return null;
  const [fx, fy] = [(num(e, "x") - t.x) / t.width, (num(e, "y") - t.y) / t.height];
  if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) return null;
  let best: [number, Side | null] = [2, null];
  for (const [side, d] of [
    ["left", fx],
    ["right", 1 - fx],
    ["up", fy],
    ["down", 1 - fy],
  ] as [Side, number][]) {
    if (d < best[0]) best = [d, side];
  }
  return best[1];
}

function pane(p: AppPane, tab: AppTab, cx: Cx): El {
  const key = p.key;
  const focused = p.focused;
  const [x, y] = [p.x, p.y];
  return div()
    .key(word(key))
    .class("pane")
    .when(focused, (e) => e.class("focused"))
    .when(p.zoomed, (e) => e.class("zoomed"))
    .class(`kind-${opt(p, "kind") ?? "terminal"}`)
    .of(p.id)
    .left(pct(x))
    .top(pct(y))
    .w(pct(p.w))
    .h(pct(p.h))
    .onMouseDown(() => {
      if (!focused) app.focusPane(key);
      return false;
    })
    .onDrop((e) => {
      const moved = dragged(e).pane;
      if (truthy(moved) && moved !== key) app.movePane(moved!, key, dropSide(e));
      return true;
    })
    .child(
      div()
        .class("pane-cell")
        .when(x > 0.0001, (e) => e.class("has-left"))
        .when(y > 0.0001, (e) => e.class("has-top"))
        .child(paneStrip(p, tab, cx.app))
        .children(p.winbar.map((v) => ownedView(v, "winbar")))
        .child(native(p.view).class("pane-body"))
        .children(p.winbar_bottom.map((v) => ownedView(v, "winbar winbar-bottom"))),
    );
}

/** A pane's plugin views in its strip, at its start or not. */
const stripViews = (p: AppPane, start: boolean): El[] =>
  p.strip.filter((v) => b(v, "start") === start).map((v) => ownedView(v, "strip-view"));

function paneStrip(p: AppPane, tab: AppTab, state: AppState): El {
  const key = p.key;
  const items = state.menus.PaneStrip ?? [];
  const renaming = state.renaming === `pane:${word(key)}`;
  const title = s(p, "title") || s(p, "kind");
  const id = p.id;
  return div()
    .class("pane-strip")
    .of(id)
    .draggable({ pane: key })
    .onDoubleClick(() => {
      app.focusPane(key);
      app.zoom();
      return true;
    })
    .onContextMenu((e) => {
      app.paneMenu(key, num(e, "wx"), num(e, "wy"));
      return true;
    })
    .children(pointButtons(items, "PaneStrip", id, true))
    .children(stripViews(p, true))
    .child(dot(p.status))
    .child(renaming ? renameField("pane-rename", title, (v) => app.renamePane(key, v)) : label("pane-title", title))
    .child(spacer())
    .child(
      div()
        .class("pane-buttons")
        .children(stripViews(p, false))
        .children(pointButtons(items, "PaneStrip", id, false))
        .child(iconButton("split", "Split Right", () => app.split(key, "right")))
        .child(iconButton("split_down", "Split Down", () => app.split(key, "down")))
        .when(list(tab, "panes").length > 1, (e) =>
          e.child(
            iconButton(p.zoomed ? "minimize" : "maximize", "Zoom", () => {
              app.focusPane(key);
              app.zoom();
            }),
          ),
        )
        .child(iconButton("close", "Close Pane", () => app.closePane(key))),
    );
}

/** The edge between two panes, dragged to share their space: the ratio follows live, and is
 * kept when the drag ends. */
function divider(d: AppDivider, tab: AppTab, { cx }: Cx): El {
  const row = d.axis === "row";
  const { x, y, w, h, ratio } = d;
  const path = word(d.path);
  const tabId = tab.id;
  const e = div()
    .key(`div${path}`)
    .class("divider")
    .class(row ? "vertical" : "horizontal");
  const placed = row ? e.left(pct(x + w * ratio)).top(pct(y)).h(pct(h)) : e.top(pct(y + h * ratio)).left(pct(x)).w(pct(w));
  return placed
    .onDrag((ev) => {
      const area = cx.rect("panes");
      if (!area) return true;
      const st = cx.state;
      const now = st.ratios[path] ?? ratio;
      const delta = row ? num(ev, "dx") / (w * area.width) : num(ev, "dy") / (h * area.height);
      const next = Math.min(0.95, Math.max(0.05, now + delta));
      st.ratios[path] = next;
      app.setRatio(tabId, path, next, false);
      return true;
    })
    .onDragEnd(() => {
      const st = cx.state;
      const r = st.ratios[path];
      if (r !== undefined) app.setRatio(tabId, path, r, true);
      st.ratios = {};
      return false;
    });
}

