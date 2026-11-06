// Deno: pumi's window after the Rex app. One quiet graphite sheet: the side bar has no fill or
// edge of its own, with the traffic lights and the window's buttons on top, the sessions and their
// views as a list (each view on its front tab's dark tile), and at its foot the side bar's views,
// a new session and a page. Each pane is a card a shade off the sheet, with a dark rim and a
// light bevel inside it, its title and buttons on top. `window.tsx` draws the parts; the panes'
// layout (splits, drags, zoom, floats) is the app's own. With a terminal colour scheme picked
// (Settings → Appearance), the window takes its colours from the scheme instead (`fromPalette`).
// The window is a little see-through, as Deno's Background opacity and blur settings say.
import { defineTheme, type TerminalPalette, type Tokens } from "pumi"
import { DENO } from "./window.tsx"

const GRAPHITE = {
  window: "#313234",
  surface: "#3a3b3e",
  editor: "#313336",
  text: "#e7edf3",
  muted: "#b1b5b9",
  faint: "#8c9094",
  border: "#ffffff14",
  hover: "#ffffff0d",
  active: "#ffffff17",
  selected: "#ffffff21",
  accent: "#477fef",
  accentText: "#ffffff",
  warning: "#e5c07b",
  error: "#ef6b73",
  success: "#64b75d",
  overlay: "#3a3b3ef2",
  "status.working": "#6c9ef8",
  "status.blocked": "#e5c07b",
  "status.error": "#ef6b73",
  "status.done": "#64b75d",
  "status.idle": "#8c9094",
  "status.unknown": "#5f6266",
  // A pane's card: its fill, the dark rim round it and the bevel just inside, and the focused
  // one's rim while Settings outlines it.
  "deno.card": "#313336",
  "deno.rim": "#18191a",
  "deno.bevel": "#ffffff12",
  "deno.rimFocused": "#477fefb3",
  // The front view's pill in the side bar (and the front tab's in a strip), and its edge.
  "deno.pill": "#ffffff21",
  "deno.pillRim": "#ffffff0f",
  // The side bar's words: a view's name, a session's heading.
  "deno.row": "#b1b5b9",
  "deno.heading": "#8c9094",
  // The window's buttons (by the traffic lights, at the side bar's foot), and a pane's.
  "deno.chrome": "#b2b5b9",
  "deno.paneButton": "#717478",
  "deno.paneButtonOff": "#3e4044",
  // A pane's title, and what follows it (its folder).
  "deno.title": "#e7edf3",
  "deno.titleDim": "#8c9094",
  // A tab's tile: dark, a near-black rim, a terminal's prompt in green, any other glyph light.
  "deno.tile": "#2a2c30",
  "deno.tileBack": "#232528",
  "deno.tileRim": "#0d0e0f",
  "deno.tileBevel": "#ffffff0d",
  "deno.tilePrompt": "#64b75d",
  "deno.tileGlyph": "#c9cdd2",
  "deno.dotRing": "#313234",
  "deno.shadow": "#00000080",
}

/** Deno's own terminal colours: what the terminals get when no scheme is picked. */
const OWN_TERMINAL = {
  background: "#313336",
  foreground: "#e7edf2",
  cursor: "#477fef",
  selection: "#3e4a60",
  // The terminals paint no background of their own: the card is theirs, whatever scheme is picked.
  opacity: 0,
  ansi: [
    "#2a2c30", "#ef6b73", "#64b75d", "#e5c07b", "#5c9cf5", "#c38ae8", "#66c2cd", "#c9cdd2",
    "#5f6266", "#f68a91", "#85cf7e", "#f0d197", "#82b4fa", "#d4a6f0", "#8ad5de", "#ffffff",
  ],
}

const HEX = /^#[0-9a-f]{6}/i
/** A `#rrggbb` colour as its three channels, 0–255. */
function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, "0")).join("")}`
/** `from` taken `by` (0–1) of the way to `to`. */
function mix(from: string, to: string, by: number): string {
  const [a, b] = [channels(from), channels(to)]
  return hex(a.map((c, i) => c + (b[i]! - c) * by))
}
/** `color` at `a` (0–1), as `#rrggbbaa`. */
const alpha = (color: string, a: number) => `${color.slice(0, 7)}${Math.round(Math.min(Math.max(a, 0), 1) * 255).toString(16).padStart(2, "0")}`
/** Relative luminance, 0 (black) to 1 (white). */
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/**
 * The window in a scheme's colours: the cards are its background, the sheet round them a hair
 * darker, the words its foreground stepping toward the background as they get quieter, the lines
 * and highlights the foreground, faint; the accent and the states are its blue, yellow, red and
 * green. With no scheme picked the palette is Deno's own, and the window is Deno's graphite.
 */
function fromPalette(p: TerminalPalette): Partial<Tokens> {
  if (p.background === OWN_TERMINAL.background && p.foreground === OWN_TERMINAL.foreground) return {}
  const bg = HEX.test(p.background) ? p.background.slice(0, 7) : OWN_TERMINAL.background
  const fg = HEX.test(p.foreground) ? p.foreground.slice(0, 7) : OWN_TERMINAL.foreground
  const ansi = (i: number) => (p.ansi[i] && HEX.test(p.ansi[i]!) ? p.ansi[i]!.slice(0, 7) : OWN_TERMINAL.ansi[i]!)
  const dark = luminance(bg) < 0.4
  const ink = (a: number) => alpha(fg, a)
  const quiet = (by: number) => mix(fg, bg, by)
  const [red, green, yellow, blue] = [ansi(1), ansi(2), ansi(3), ansi(4)]
  const window = mix(bg, "#000000", dark ? 0.02 : 0.03)
  const surface = mix(bg, fg, dark ? 0.06 : 0.03)
  // The tiles stay dark on a light scheme too: the scheme's foreground, a little lifted.
  const tile = dark ? mix(bg, "#000000", 0.14) : mix(fg, bg, 0.12)
  return {
    window,
    surface,
    editor: bg,
    text: fg,
    muted: quiet(0.25),
    faint: quiet(0.45),
    border: ink(0.08),
    hover: ink(0.05),
    active: ink(0.09),
    selected: ink(dark ? 0.13 : 0.09),
    accent: blue,
    accentText: luminance(blue) > 0.4 ? "#000000" : "#ffffff",
    warning: yellow,
    error: red,
    success: green,
    overlay: alpha(surface, 0.95),
    "status.working": blue,
    "status.blocked": yellow,
    "status.error": red,
    "status.done": green,
    "status.idle": quiet(0.45),
    "status.unknown": quiet(0.6),
    "deno.card": bg,
    "deno.rim": dark ? mix(bg, "#000000", 0.5) : mix(bg, "#000000", 0.16),
    "deno.bevel": dark ? "#ffffff12" : "#ffffffb3",
    "deno.rimFocused": alpha(blue, 0.7),
    "deno.pill": ink(dark ? 0.13 : 0.08),
    "deno.pillRim": ink(0.06),
    "deno.row": quiet(0.25),
    "deno.heading": quiet(0.45),
    "deno.chrome": quiet(0.25),
    "deno.paneButton": quiet(0.5),
    "deno.paneButtonOff": quiet(0.8),
    "deno.title": fg,
    "deno.titleDim": quiet(0.45),
    "deno.tile": tile,
    "deno.tileBack": mix(tile, "#000000", 0.2),
    "deno.tileRim": mix(tile, "#000000", 0.65),
    "deno.tileBevel": "#ffffff0d",
    "deno.tilePrompt": dark ? green : mix(green, "#ffffff", 0.3),
    "deno.tileGlyph": dark ? quiet(0.15) : bg,
    "deno.dotRing": window,
    "deno.shadow": dark ? "#00000080" : "#0000002e",
  }
}

export default defineTheme({
  name: "Deno",
  description: "After the Rex app: one graphite window, views down the side on dark tiles, each pane a bevelled card.",
  appearance: "dark",
  // A little see-through, the desktop blurred behind it: the defaults of Deno's Background opacity
  // and blur settings, which the window applies as they change (`window.tsx`).
  window: { background: "transparent", blur: 40 },
  colors: { dark: GRAPHITE },
  fromPalette,
  // A light scheme draws the light look, and its terminals still paint no background of their own.
  terminal: { dark: OWN_TERMINAL, light: { opacity: 0 } },
  metrics: { fontSize: 13, radius: 10, radiusSmall: 6, paneFade: 0.2, backgroundOpacity: 0.95 },
  // Cards with 6 px of the sheet between them; a zoomed one lifts with a soft shadow (the card is
  // the theme's `Pane`, so the frame adds no fill of its own).
  layout: (t, m) => ({
    gap: { between: 6, around: 0 },
    lifted: { borderRadius: m.radius, boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: t["deno.shadow"] } },
  }),
  tooltip: (t) => ({
    backgroundColor: t.surface,
    color: t.text,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t["deno.pillRim"],
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 12,
  }),
  components: DENO,
})
