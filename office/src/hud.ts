// The bar along the bottom: you and the session you are in, what makes a desk, the plugins and
// Settings, how many sessions and desks there are, the statusline's views, the agents waiting and
// the clock.
import { app, div, icon, text, type AppState, type El, type ThemeContext } from "pumi";
import { sprite } from "./art.ts";
import { dot, label, slot, spacer } from "./parts.ts";
import { desksOf, perPane } from "./plan.ts";
import { keep, type OfficeState } from "./state.ts";

/** A button of the bar: its icon, its name, and what a press does. */
function button(name: string, title: string, press: () => void, active = false): El {
  return div()
    .class("hud-button")
    .when(active, (e) => e.class("active"))
    .title(title)
    .onClick(() => {
      press();
      return true;
    })
    .child(icon(name))
    .child(text(title));
}

/** A count: its dot, and how many. */
function count(cls: string, status: string, n: number, title: string, press?: () => void): El {
  return div()
    .class(`hud-count ${cls}`)
    .title(title)
    .when(press !== undefined, (e) =>
      e.onClick(() => {
        press!();
        return true;
      }),
    )
    .child(dot(status))
    .child(text(String(n)));
}

export function hud(cx: ThemeContext<OfficeState>): El {
  const st = cx.state;
  const state: AppState = cx.app;
  const working = state.agents.filter((a) => a.status === "working").length;
  const blocked = state.agents.filter((a) => a.status === "blocked").length;
  const per = perPane(state);
  let desks = 0;
  for (const space of state.spaces) for (const tab of space.tab_list ?? []) desks += desksOf(tab, per).length;
  const moved = Object.keys(st.desks).length > 0;
  return div()
    .id("hud")
    .child(
      div()
        .class("hud-me")
        .onClick(() => {
          app.projects();
          return true;
        })
        .child(div().class("hud-avatar").child(sprite("person1", "hud-avatar-art")))
        .child(
          div()
            .class("hud-who")
            .child(label("hud-name", "You"))
            .child(label("hud-space", state.space?.label ?? "No session")),
        ),
    )
    .child(div().class("hud-sep"))
    .child(button("plus", "New desk", () => app.run("new_tab")))
    .child(
      button("split", "A desk for every pane", () => app.setSetting("desk_per_pane", !per), per),
    )
    .child(
      button(
        "package",
        "Plugins",
        () => {
          st.shelf = !st.shelf;
        },
        st.shelf,
      ),
    )
    .child(button("settings", "Settings", () => app.settings()))
    .when(moved, (e) =>
      e.child(
        button("blocks", "Tidy up", () => {
          st.desks = {};
          keep(st);
        }),
      ),
    )
    .child(spacer())
    .child(
      label("hud-count rooms", `${state.spaces.length} sessions · ${desks} desks`).title("Sessions and desks"),
    )
    .children(slot(state, "statusline", "hud-view"))
    .when(working > 0, (e) => e.child(count("working", "working", working, `${working} working`)))
    .when(blocked > 0, (e) =>
      e.child(count("blocked", "blocked", blocked, `${blocked} blocked`, () => app.run("next_agent"))),
    )
    .child(label("hud-clock", state.clock));
}
