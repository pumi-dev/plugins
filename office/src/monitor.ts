// The monitor: a desk you sat at, its tab's real panes — where you type — over the room. Standing up
// (a press outside it) closes it.
import { app, div, native, text, type AppDivider, type AppPane, type AppTab, type El, type ThemeContext } from "pumi";
import { dot, iconButton, label, num, pct, spacer } from "./parts.ts";
import type { OfficeState } from "./state.ts";

/** The desk you sat at: the tab's panes, live, and the bar that splits them and stands you up. */
export function monitor(cx: ThemeContext<OfficeState>): El | null {
  const st = cx.state;
  const tab = cx.app.tabs.find((t) => t.id === st.sitting);
  if (!tab) {
    st.sitting = null;
    return null;
  }
  return div()
    .id("monitor-backdrop")
    .onClick(() => {
      st.sitting = null;
      return true;
    })
    .child(
      div()
        .id("monitor")
        .onClick(() => true)
        .child(
          div()
            .class("monitor-bar")
            .child(dot(tab.status || ""))
            .child(label("monitor-title", tab.title))
            .child(spacer())
            .child(iconButton("split", "Split Right", () => app.split(null, "right")))
            .child(iconButton("split_down", "Split Down", () => app.split(null, "down")))
            .child(
              div()
                .class("stand")
                .onClick(() => {
                  st.sitting = null;
                  return true;
                })
                .child(text("Stand up")),
            ),
        )
        .child(div().class("monitor-screen").child(panes(cx, tab))),
    )
    .child(div().class("monitor-stand"));
}

/** A tab's panes, laid out as the tab is, each with its strip and its live body; or a note that the
 * tab holds nothing. */
function panes(cx: ThemeContext<OfficeState>, tab: AppTab): El {
  if (tab.panes.length === 0) {
    return div().id("panes").child(
      div()
        .class("empty")
        .child(label("empty-title", "This view is empty"))
        .child(
          div()
            .class("button")
            .onClick(() => {
              app.run("split_vertical");
              return true;
            })
            .child(text("New Terminal")),
        ),
    );
  }
  return div()
    .id("panes")
    .class("panes")
    .class("panes-office")
    .of(tab.of)
    .children(tab.panes.filter((p) => !p.hidden).map((p) => pane(p, tab)))
    .children(tab.dividers.map((d) => divider(cx, d, tab)));
}

function pane(p: AppPane, tab: AppTab): El {
  const key = p.key;
  const focused = p.focused;
  return div()
    .key(key)
    .class("pane")
    .when(focused, (e) => e.class("focused"))
    .when(p.zoomed, (e) => e.class("zoomed"))
    .class(`kind-${p.kind || "terminal"}`)
    .of(p.id)
    .left(pct(p.x))
    .top(pct(p.y))
    .w(pct(p.w))
    .h(pct(p.h))
    .onMouseDown(() => {
      if (!focused) app.focusPane(key);
      return false;
    })
    .child(
      div()
        .class("pane-cell")
        .when(p.x > 0.0001, (e) => e.class("has-left"))
        .when(p.y > 0.0001, (e) => e.class("has-top"))
        .child(strip(p, tab))
        .child(native(p.view).class("pane-body")),
    );
}

/** A pane's strip: its status, its title, and what its buttons do. */
function strip(p: AppPane, tab: AppTab): El {
  const key = p.key;
  return div()
    .class("pane-strip")
    .of(p.id)
    .onDoubleClick(() => {
      app.focusPane(key);
      app.zoom();
      return true;
    })
    .onContextMenu((e) => {
      app.paneMenu(key, num(e, "wx"), num(e, "wy"));
      return true;
    })
    .child(dot(p.status))
    .child(label("pane-title", p.title || p.kind))
    .child(spacer())
    .child(
      div()
        .class("pane-buttons")
        .child(iconButton("split", "Split Right", () => app.split(key, "right")))
        .child(iconButton("split_down", "Split Down", () => app.split(key, "down")))
        .when(tab.panes.length > 1, (e) =>
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

/** The edge between two panes, dragged to share their space: the ratio follows live, and is kept
 * when the drag ends. */
function divider(cx: ThemeContext<OfficeState>, d: AppDivider, tab: AppTab): El {
  const row = d.axis === "row";
  const path = d.path;
  const e = div()
    .key(`div${path}`)
    .class("divider")
    .class(row ? "vertical" : "horizontal");
  const placed = row
    ? e.left(pct(d.x + d.w * d.ratio)).top(pct(d.y)).h(pct(d.h))
    : e.top(pct(d.y + d.h * d.ratio)).left(pct(d.x)).w(pct(d.w));
  return placed
    .onDrag((ev) => {
      const area = cx.rect("panes");
      if (!area) return true;
      const st = cx.state;
      const now = st.ratios[path] ?? d.ratio;
      const delta = row ? num(ev, "dx") / (d.w * area.width) : num(ev, "dy") / (d.h * area.height);
      const next = Math.min(0.95, Math.max(0.05, now + delta));
      st.ratios[path] = next;
      app.setRatio(tab.id, path, next, false);
      return true;
    })
    .onDragEnd(() => {
      const st = cx.state;
      const ratio = st.ratios[path];
      if (ratio !== undefined) app.setRatio(tab.id, path, ratio, true);
      st.ratios = {};
      return false;
    });
}
