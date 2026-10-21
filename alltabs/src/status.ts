// Copied from pumi's default theme (`runtime/bun/examples/default-theme/themes/classic/status.ts`),
// which alltabs extends and does not replace. A stopgap until the SDK grows `extends` or a shared
// default window.
//
// The status bar: the docks' page buttons, where you are, the agents waiting, the statusline
// slot, the notice and the clock (src/ui/shell/default_theme/status.rs).
import { app, div, text, type AppState, type El } from "pumi";
import { dockButtons } from "./docks.ts";
import { activeTab, dot, label, opt, pages, slot, spacer, type Cx } from "./parts.ts";

function agents(state: AppState): El {
  const count = (status: string) => state.agents.filter((a) => a.status === status).length;
  return div()
    .id("agents-summary")
    .children(
      ["blocked", "working", "done", "error"]
        .filter((status) => count(status) > 0)
        .map((status) => {
          const n = count(status);
          return div()
            .key(status)
            .class("agent-count")
            .title(`${n} ${status}`)
            .onClick(() => {
              app.run("next_agent");
              return true;
            })
            .child(dot(status))
            .child(text(String(n)));
        }),
    );
}

export function statusBar(cx: Cx): El {
  const state = cx.app;
  const tab = activeTab(state);
  const space = state.space?.label ?? "";
  const place = tab ? `${space}  ·  ${tab.title}` : space;
  return div()
    .id("status-bar")
    .child(dockButtons(cx, "primary"))
    .when(pages(state, "primary").length > 0, (e) => e.child(div().class("status-sep")))
    .child(label("status-item", place))
    .child(agents(state))
    .child(spacer())
    .children(slot(state, "statusline", "status-view"))
    .whenSome(opt(state, "notice"), (e, notice) => e.child(label("status-item notice", notice)))
    .child(label("status-item clock", state.clock))
    .child(dockButtons(cx, "panel"))
    .child(dockButtons(cx, "secondary"));
}
