// Office: pumi as a little pixel office, after Gather. Every session is a pod on the floor with its
// name on it, and every tab in it is a desk whose little screen shows that tab's pane in front,
// live — so the whole app is in the room at once. Point at a desk and its screen opens beside it,
// big and readable; click it and you walk over and sit at its computer (the real panes, where you
// type). Click anywhere on the floor to walk there. The bookshelf holds the plugins' pages, the
// coffee machine is Settings, the door mat is the way to your other sessions, and a desk you have
// split has a row of coffee cups on it. One desk holds a whole tab; turn on "A desk for every pane"
// (Settings → Office Settings, or the bar) and every pane of a split gets a desk, an agent and a
// screen of its own instead.
//
// The app pushes what changed in the window as patches, and the theme draws again when it hears of
// one — so the office keeps no clock of its own: a desk's screen is the app's own preview and moves
// without a redraw. The one timer is the walk (state.ts): the sprite moves by its CSS transition,
// and the timer only ends the walk, where sitting down happens.
import { defineTheme, div } from "pumi";
import { hud } from "../../src/hud.ts";
import { monitor } from "../../src/monitor.ts";
import { overlays } from "../../src/overlays.ts";
import { plan } from "../../src/plan.ts";
import { rename, room } from "../../src/room.ts";
import { shelf } from "../../src/shelf.ts";
import { fresh, restore, stand, type OfficeState } from "../../src/state.ts";

/** The office's colours: the room's own, and the app's tokens set to the office's blue for what is
 * chosen and what to press. */
const COLORS = {
  floor: "#efe3cf",
  wall: "#6c74a8",
  ink: "#2b2d42",
  paper: "#ffffff",
  pill: "#1d1f2bd9",
  hud: "#1d1f2b",
  hud_text: "#e9eaf2",
  hud_muted: "#9a9db3",
  online: "#4ade80",
  lit: "#5aa9ff",
  working: "#ffd166",
  blocked: "#ef476f",
  done: "#06d6a0",
  accent: "#5aa9ff",
  primary: "#5aa9ff",
  primary_hover: "#3d8ce8",
  primary_active: "#2f78cc",
  primary_foreground: "#ffffff",
  focus_ring: "#5aa9ff",
};

export default defineTheme<OfficeState>({
  name: "Office",
  description: "A pixel office: a desk for every tab of every session, each with its screen.",
  // Every pane of every tab stays attached: a desk shows a pane the window is not showing.
  attach: "all",
  state: fresh,
  // Where you stood and where each desk was moved to are kept across runs, not in the theme.
  mounted(cx) {
    void restore(cx);
  },
  closed(cx) {
    stand(cx.state);
  },
  // Settings → Office Settings. The bar's "A desk for every pane" is this, flipped.
  settings: {
    desk_per_pane: {
      type: "boolean",
      default: false,
      label: "A desk for every pane",
      desc: "Each pane of a split tab gets a desk, an agent and a screen of its own, instead of one desk whose screen holds the whole tab.",
    },
  },
  colors: { dark: COLORS, light: COLORS },
  // Soft and round, like the room.
  metrics: { radius: 7, radius_sm: 5, radius_lg: 10, control_height: 30 },
  render(state, cx) {
    const st = cx.state;
    return div()
      .id("office")
      .class(state.window.active ? "active" : "inactive")
      .onClick(() => {
        st.shelf = false;
      })
      .child(room(cx, plan(state)))
      .when(st.shelf, (e) => e.child(shelf(cx)))
      .when(st.sitting !== null, (e) => e.child(monitor(cx)))
      .child(rename(cx))
      .child(hud(cx))
      .child(div().id("overlays").child(overlays({ app: state, cx })));
  },
});
