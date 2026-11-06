// Arc: a cream sidebar with the window's buttons in it, an address pill that says where the tab in
// front is, a row of its own small buttons, pinned tabs as pale letter tiles, and the session's views
// as folders of tabs; the panes float beside it as rounded cards with soft shadows, a split's two
// side by side with a gutter between them. The parts are in `parts.tsx`, the colours Arc's own, and
// both looks.
import { defineTheme, type Tokens } from "pumi"
import { PARTS } from "./parts.tsx"

/** Arc's daylight: a cream sidebar, white cards, a violet accent. */
const LIGHT: Partial<Tokens> = {
  window: "#e9e6e0",
  surface: "#f2f0ec",
  editor: "#ffffff",
  text: "#2b2931",
  // A tab's row: Arc reads it a shade softer than a heading.
  textTab: "#3b3944",
  muted: "#6c6973",
  faint: "#9c99a3",
  border: "#e4e1da",
  // The line under a card's bar, lighter than a border.
  hairline: "#f0ede8",
  hover: "#e9e6df",
  active: "#e0dcd4",
  selected: "#e8e3f9",
  accent: "#6f5cf0",
  accentText: "#ffffff",
  success: "#3f9e5f",
  warning: "#c98a2b",
  error: "#d4483c",
  overlay: "#ffffff",
  // The pill, its edge, and the tile behind the session's letter.
  pill: "#ffffff",
  pillEdge: "#e2ded6",
  tileOn: "#eae6f8",
  shadow: "#0000001c",
  "status.working": "#6f5cf0",
  "status.blocked": "#c98a2b",
  "status.error": "#d4483c",
  "status.done": "#3f9e5f",
  "status.idle": "#9c99a3",
  "status.unknown": "#b8b5bd",
}

/** Arc's dark: raisin, near-black cards, the violet still. */
const DARK: Partial<Tokens> = {
  window: "#131315",
  surface: "#1c1c1e",
  editor: "#262628",
  text: "#eceaf0",
  textTab: "#cfccd6",
  muted: "#a09da8",
  faint: "#726f79",
  border: "#333336",
  hairline: "#2f2f32",
  hover: "#262628",
  active: "#313134",
  selected: "#39334f",
  accent: "#a291ff",
  accentText: "#17141f",
  success: "#63c47d",
  warning: "#e0aa5a",
  error: "#e57366",
  overlay: "#2b2b2e",
  pill: "#2b2b2e",
  pillEdge: "#3a3a3e",
  tileOn: "#2f2a44",
  shadow: "#00000066",
  "status.working": "#a291ff",
  "status.blocked": "#e0aa5a",
  "status.error": "#e57366",
  "status.done": "#63c47d",
  "status.idle": "#726f79",
  "status.unknown": "#59565f",
}

export default defineTheme({
  name: "Arc",
  description:
    "pumi as Arc: the window's buttons in a cream sidebar, an address pill, pinned tabs as pale tiles, views as folders, and the panes as rounded cards floating beside them.",
  appearance: { option: "appearance" },
  colors: { light: LIGHT, dark: DARK },
  terminal: {
    light: {
      background: "#ffffff",
      foreground: "#2a2833",
      cursor: "#6f5cf0",
      selection: "#ded8fb",
      ansi: [
        "#3b3a44",
        "#d4483c",
        "#3f9e5f",
        "#b07a17",
        "#3d6fd4",
        "#8b5cd6",
        "#2f8f8f",
        "#e6e3dd",
        "#6b6873",
        "#e06255",
        "#54b374",
        "#c9902b",
        "#5c88e0",
        "#a479e8",
        "#3fa6a6",
        "#ffffff",
      ],
    },
    dark: {
      background: "#1d1d1e",
      foreground: "#eceaf0",
      cursor: "#a291ff",
      selection: "#3a3550",
      ansi: [
        "#2a2a2c",
        "#e57366",
        "#63c47d",
        "#e0aa5a",
        "#7ea6f0",
        "#b394f5",
        "#5fc4c4",
        "#dcdae1",
        "#706d78",
        "#f08a7e",
        "#7dd895",
        "#f0bd72",
        "#94b6f5",
        "#c6adf8",
        "#7cd6d6",
        "#ffffff",
      ],
    },
  },
  metrics: {
    fontSize: 13,
    radius: 10,
    radiusSmall: 6,
    paneFade: 0.1,
    backgroundOpacity: 1,
  },
  layout: (t) => ({
    // Arc's gutter between a split's two cards, and its margin from the window's edges.
    gap: { between: 8, around: 10 },
    divider: 0,
    zoomInset: 12,
    lifted: {
      borderRadius: 10,
      backgroundColor: t.editor,
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 3, spreadRadius: 0, color: t.shadow },
        { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: -8, color: t.shadow },
      ],
    },
  }),
  window: { background: "opaque" },
  components: PARTS,
})
