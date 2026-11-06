// slate: a grey desk with white cards on it, and every open tab in the dock at its foot.
//
// `ui_theme = "slate"` picks it (Settings → Appearance). Drawn from the prototype in
// notes/os-theme: the numbers there are this file's numbers.
import { defineTheme } from "pumi"
import { DARK, LIGHT, METRICS } from "./tokens.ts"
import { Dock } from "./dock.tsx"
import { Pane, PaneTab, PaneTitle, Splitter } from "./panes.tsx"
import { Window } from "./window.tsx"

export default defineTheme({
  name: "slate",
  description: "A grey desk, the panes as cards on it, and every open tab in the dock at its foot. No side bar.",
  colors: { dark: DARK, light: LIGHT },
  metrics: METRICS,
  // The desk is painted by the window itself, over the app's own opaque background.
  window: { background: "opaque" },
  layout: {
    // The air between the cards: the desk shows through it, which is what makes each pane a window.
    gap: { between: 12, around: 12 },
    // Nothing between them: with a gap there is no seam to draw.
    divider: 0,
    zoomInset: 12,
    // A zoomed pane sits over the others as the same card, a little higher.
    lifted: {
      backgroundColor: LIGHT.editor,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: LIGHT.border,
      boxShadow: { offsetX: 0, offsetY: 16, blurRadius: 44, spreadRadius: -10, color: "#1b243055" },
    },
  },
  docks: {
    // The dock is the theme's own bar, not one of the app's boxes: no panels land in it, so it is
    // only what `Dock` draws — but the app still gives it its command and its keys.
    dock: { title: "Dock", keys: "cmd+j", open: true, size: 66, min: 66, max: 66 },
  },
  components: { Window, Pane, PaneTitle, PaneTab, Splitter },
})
