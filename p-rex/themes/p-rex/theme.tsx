// P-Rex: pumi's window in the terminals' own colours, a little see-through. Its every colour is made
// from the terminals' palette (`fromPalette`: the colour scheme picked in Settings → Appearance, or
// the theme's own below), so the side bar, the panes' cards and the menus are the terminal's
// background and text; the window shows the desktop faintly through it. The views are a list down
// the side (each with its front tab's tile), each pane holds its tabs in a strip along its bar, and
// the panes are cards with a gap between them (Comfortable) or edge to edge with a line between
// (Compact). `window.tsx` draws the parts; the panes' layout (splits, drags, zoom, floats) is the
// app's own.
import { defineTheme, type TerminalPalette, type Tokens } from "pumi"
import { P_REX } from "./window.tsx"

/** A `#rrggbb` colour as its three channels, 0–255. */
function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace(/^#/, "").slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, "0")).join("")}`

/** `from` taken `by` (0–1) of the way to `to`. */
function mix(from: string, to: string, by: number): string {
  const [a, b] = [channels(from), channels(to)]
  return hex(a.map((c, i) => c + (b[i]! - c) * by))
}

/** `color` at `alpha` (0–1), as `#rrggbbaa`. */
function alpha(color: string, a: number): string {
  return `${hex(channels(color))}${Math.round(Math.min(Math.max(a, 0), 1) * 255).toString(16).padStart(2, "0")}`
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/**
 * Every colour from the palette: the background is the window's and the panes', the foreground
 * its text (quieter as it steps toward the background), the lines and highlights the foreground,
 * faint; the accent and the agents' states are its ansi blue, yellow, red and green.
 */
function fromPalette(p: TerminalPalette): Partial<Tokens> {
  const bg = /^#[0-9a-f]{6}/i.test(p.background) ? p.background.slice(0, 7) : "#0f1115"
  const fg = /^#[0-9a-f]{6}/i.test(p.foreground) ? p.foreground.slice(0, 7) : "#d7dae0"
  const ansi = (i: number, fallback: string) => (p.ansi[i] && /^#[0-9a-f]{6}/i.test(p.ansi[i]!) ? p.ansi[i]!.slice(0, 7) : fallback)
  const dark = luminance(bg) < 0.4
  const toward = (by: number) => mix(bg, fg, by)
  const ink = (by: number) => alpha(fg, by)
  const blue = ansi(4, "#7aa6f0")
  const red = ansi(1, "#f2777a")
  const green = ansi(2, "#7ccf8a")
  const yellow = ansi(3, "#e8c170")
  const faint = mix(fg, bg, 0.5)
  const surface = toward(dark ? 0.07 : 0.03)
  return {
    window: bg,
    surface: alpha(surface, 0.97),
    editor: bg,
    text: fg,
    muted: mix(fg, bg, 0.3),
    faint,
    border: ink(0.1),
    hover: ink(0.07),
    active: ink(0.12),
    selected: ink(0.1),
    accent: blue,
    accentText: luminance(blue) > 0.4 ? "#000000" : "#ffffff",
    warning: yellow,
    error: red,
    success: green,
    overlay: alpha(surface, 0.95),
    "agent.working": blue,
    "agent.blocked": yellow,
    "agent.error": red,
    "agent.done": green,
    "agent.idle": mix(fg, bg, 0.4),
    "agent.unknown": faint,
    // The glass: the terminals' background, see-through by the theme's Background opacity.
    "rex.glass": bg,
    // A pane's card (Comfortable): a little more of the background over the glass, its rim, and
    // the focused one's when Settings outlines it.
    "rex.card": alpha(bg, 0.45),
    "rex.rim": ink(0.09),
    "rex.rimFocused": alpha(blue, 0.7),
    // The line between panes that touch (Compact), and the side bar's edge then.
    "rex.divider": ink(0.08),
    "rex.sidebar": ink(dark ? 0.025 : 0.02),
    "rex.title": fg,
    "rex.titleDim": mix(fg, bg, 0.35),
    // A pane's own buttons (split, zoom, close): there, but quiet.
    "rex.paneButton": mix(fg, bg, 0.5),
    // The window's buttons (by the traffic lights, at the side bar's foot).
    "rex.chrome": mix(fg, bg, 0.2),
    // The side bar: the front tab's pill and its rim, a row's text, a session's heading.
    "rex.pill": ink(dark ? 0.11 : 0.08),
    "rex.pillRim": ink(0.08),
    "rex.row": mix(fg, bg, 0.08),
    "rex.heading": mix(fg, bg, 0.45),
    // The tabs across the top while the side bar is hidden: their track, and the front one.
    "rex.track": ink(0.04),
    "rex.trackRim": ink(0.08),
    "rex.tabFront": ink(0.11),
    "rex.dotRing": bg,
    // A terminal's tile is slate with its prompt in green; an agent's is warm paper with its mark
    // in near black, whatever the palette is; a page's and a file's take the palette's colours.
    "rex.tile.terminal": toward(dark ? 0.17 : 0.09),
    "rex.tile.terminal.ink": mix(green, fg, 0.15),
    "rex.tile.agent": mix("#fffaf0", fg, 0.3),
    "rex.tile.browser": blue,
    "rex.tile.file": green,
    "rex.tile.image": ansi(6, "#6fcfd6"),
    "rex.tile.plugin": ansi(5, "#c89cf0"),
    "rex.tile.ink": mix(bg, "#0b0d12", dark ? 0.9 : 0.88),
    "rex.tile.rim": ink(dark ? 0.16 : 0.12),
    "rex.tile.shadow": dark ? "#00000066" : "#00000026",
    "rex.shadow": dark ? "#00000080" : "#0000002e",
  }
}

export default defineTheme({
  name: "P-Rex",
  description: "The terminals' own colours, a little see-through: views down the side with their tabs' tiles, each pane's tabs in a strip, the panes as cards or edge to edge.",
  // Night or day when no colour scheme is picked (a picked scheme's own look wins), or the system's.
  appearance: { option: "appearance" },
  // The theme paints the glass itself (`rex.glass` at the Background opacity); what shows through
  // it is blurred a little.
  window: { background: "transparent", blur: 24 },
  fromPalette,
  // The terminals paint no background of their own: the glass, or the card, is theirs.
  terminal: {
    dark: {
      background: "#0f1115",
      foreground: "#d7dae0",
      cursor: "#d7dae0",
      selection: "#2c323c",
      opacity: 0,
      ansi: [
        "#1d2026", "#f2777a", "#7ccf8a", "#e8c170", "#7aa6f0", "#c89cf0", "#6fcfd6", "#c5c8ce",
        "#4d525c", "#ff8f91", "#97e0a3", "#f3d38e", "#9ab9f5", "#d8b4f6", "#93dde3", "#f2f3f5",
      ],
    },
    light: {
      background: "#f7f7f8",
      foreground: "#2b2e33",
      cursor: "#2b2e33",
      selection: "#d5dbe5",
      opacity: 0,
      ansi: [
        "#2b2e33", "#d6334f", "#2a8f4f", "#a86a00", "#2f62d8", "#8a45d6", "#1f8f9a", "#c9ccd2",
        "#7a7f89", "#e5546d", "#3aa863", "#c98a1b", "#4f7ee6", "#a466e6", "#33a8b3", "#ffffff",
      ],
    },
  },
  metrics: { fontSize: 13, radius: 10, radiusSmall: 6 },
  // Comfortable: each pane a card, 8 px of glass between them. Compact: edge to edge, a line
  // between. A zoomed pane lifts with a soft shadow (the card is the theme's `Pane`, so the frame
  // adds no fill of its own).
  layout: (t, m, option) =>
    option("pane_style") === "compact"
      ? {
          gap: 0,
          divider: 1,
          lifted: { backgroundColor: t["rex.glass"], borderWidth: 1, borderColor: t["rex.rim"], boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: t["rex.shadow"] } },
        }
      : {
          gap: { between: 8, around: 0 },
          lifted: { borderRadius: m.radius, boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: t["rex.shadow"] } },
        },
  tooltip: (t) => ({
    backgroundColor: t.surface,
    color: t.text,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t["rex.pillRim"],
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 12,
  }),
  components: P_REX,
})
