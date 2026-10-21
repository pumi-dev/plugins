// All Tabs: pumi's own window, with every session's tabs in the header, one group a session and no
// names; the default theme's everywhere else. Ported from this package's `theme.lua`, which
// extended the default theme, so the window it draws from there is copied into `src/` and its
// header row's grouping is there too (`src/header.ts`). Stopgaps until the SDK grows `extends` or
// a shared default window.
import { defineTheme, div, px, type El } from "pumi";
import { bottom, secondary, sidebar } from "../../src/docks.ts";
import { header } from "../../src/header.ts";
import { overlays } from "../../src/overlays.ts";
import { panes } from "../../src/panes.ts";
import { activeTab, fresh, pages, type Cx, type State } from "../../src/parts.ts";
import { statusBar } from "../../src/status.ts";

export default defineTheme<State>({
  name: "All Tabs",
  description: "pumi's own, with every session's tabs in the header: one group a session, no names.",
  settings: {
    all_sessions: {
      type: "boolean",
      default: true,
      desc: "Show every session in the header, not only the one in front.",
    },
  },
  state: fresh,
  /** The window's tree: the window, and the overlays' layer above it. */
  render(app, cx) {
    const at: Cx = { app, cx };
    return div()
      .id("pumi-root")
      .css("position", "relative")
      .wFull()
      .hFull()
      .flex()
      .flexCol()
      .child(window(at))
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
          .child(overlays(at)),
      );
  },
});

function window(cx: Cx): El {
  const app = cx.app;
  return div()
    .id("window")
    .class(app.appearance)
    .class(app.window.active ? "active" : "inactive")
    .child(header(cx))
    .child(workspace(cx))
    .child(statusBar(cx));
}

function workspace(cx: Cx): El {
  const w = cx.app.window;
  const primary = pages(cx.app, "primary");
  const second = pages(cx.app, "secondary");
  return div()
    .id("workspace")
    .when(w.sidebar && primary.length > 0, (e) => e.child(sidebar(cx, primary)))
    .child(
      div()
        .id("main")
        .child(panes(cx, activeTab(cx.app)))
        .when(w.bottom, (e) => e.child(bottom(cx))),
    )
    .when(w.secondary && second.length > 0, (e) => e.child(secondary(cx, second)));
}
