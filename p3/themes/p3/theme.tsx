// P3: pumi's window after T3 Code. Flat graphite, no cards and no chrome to speak of: a side bar
// a shade lighter than the rest with every tab listed as a thread under its project (its
// session), a breadcrumb over the panes, and the panes themselves edge to edge with a hairline
// between. `window.tsx` draws the parts; the panes' layout (splits, drags, zoom, floats) is the
// app's own.
import { defineTheme } from "pumi"
import { P3 } from "./window.tsx"

export default defineTheme({
  name: "P3",
  description: "After T3 Code: graphite and flat, every tab a thread under its project, a breadcrumb over edge-to-edge panes.",
  appearance: { option: "appearance" },
  colors: {
    dark: {
      window: "#1e1f22",
      surface: "#28282d",
      editor: "#1e1f22",
      text: "#eeeeee",
      muted: "#a3a4a9",
      faint: "#717278",
      border: "#34353a",
      hover: "#ffffff0d",
      active: "#ffffff17",
      selected: "#ffffff12",
      accent: "#9a8aa2",
      accentText: "#1d1a20",
      warning: "#e2b56c",
      error: "#ef7a7f",
      success: "#86cfa0",
      overlay: "#28282df2",
      "status.working": "#9db6f2",
      "status.blocked": "#e2b56c",
      "status.error": "#ef7a7f",
      "status.done": "#86cfa0",
      "status.idle": "#8b8c92",
      "status.unknown": "#5f6066",
      // The side bar, a shade above the panes, and its edge.
      "p3.sidebar": "#2a2c30",
      "p3.sidebarEdge": "#303136",
      // A project's tag (its session's initials), as T3 Code marks a workspace.
      "p3.tag": "#1f3a4a",
      "p3.tagText": "#5cc4ec",
      "p3.tagNone": "#55565c",
      // A key's chip in a menu.
      "p3.kbd": "#2e2e31",
      "p3.kbdText": "#96969b",
      "p3.shadow": "#00000080",
    },
    light: {
      window: "#ffffff",
      surface: "#ffffff",
      editor: "#ffffff",
      text: "#18181b",
      muted: "#5c5d63",
      faint: "#9a9ba1",
      border: "#e6e6e9",
      hover: "#0000000a",
      active: "#00000012",
      selected: "#0000000d",
      accent: "#7d6a8a",
      accentText: "#ffffff",
      warning: "#a86b00",
      error: "#d33b46",
      success: "#2f8a52",
      overlay: "#fffffff2",
      "status.working": "#3a64d8",
      "status.blocked": "#b86a10",
      "status.error": "#d33b46",
      "status.done": "#2f8a52",
      "status.idle": "#86878d",
      "status.unknown": "#b4b5ba",
      "p3.sidebar": "#f6f6f7",
      "p3.sidebarEdge": "#ebebee",
      "p3.tag": "#dceffa",
      "p3.tagText": "#1784b8",
      "p3.tagNone": "#b4b5ba",
      "p3.kbd": "#f0f0f2",
      "p3.kbdText": "#6f7076",
      "p3.shadow": "#0000001f",
    },
  },
  terminal: {
    dark: {
      background: "#1e1f22",
      foreground: "#e4e4e6",
      cursor: "#c9bcd0",
      selection: "#3d3a44",
      ansi: [
        "#2a2b2f", "#ef7a7f", "#86cfa0", "#e2b56c", "#86a8ef", "#b9a3c6", "#6fc6d8", "#cfcfd3",
        "#5f6066", "#f49a9e", "#a5dfb8", "#ecc88d", "#a6bff4", "#cdbbd8", "#93d7e5", "#ffffff",
      ],
    },
    light: {
      background: "#ffffff",
      foreground: "#1f1f23",
      cursor: "#7d6a8a",
      selection: "#e6dfeb",
      ansi: [
        "#1f1f23", "#d33b46", "#2f8a52", "#a86b00", "#3a64d8", "#7d5a96", "#1a8aa0", "#c8c8cc",
        "#86878d", "#e2565f", "#3ea466", "#c4870f", "#5a80e6", "#9877ae", "#2aa3ba", "#f4f4f6",
      ],
    },
  },
  metrics: { fontSize: 13, radius: 10, radiusSmall: 6 },
  // The threads on the left (the window's own side bar, ⌘B) and the surfaces on the right, as T3
  // Code's: every plugin's `panel` view is a surface there (⌘⌥B shows and hides it).
  docks: {
    sidebar: { title: "Threads", size: 280, min: 200, max: 520 },
    surfaces: { title: "Surfaces", keys: "cmd+alt+b", size: 320, min: 240, max: 720, panels: ["*"] },
  },
  // Edge to edge: no room between panes, a hairline where two touch.
  layout: {
    gap: 0,
    divider: 1,
    lifted: (t, m) => ({ borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.editor, boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: t["p3.shadow"] } }),
  },
  tooltip: (t) => ({
    backgroundColor: t.surface,
    color: t.text,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: t.border,
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 12,
  }),
  components: P3,
})
