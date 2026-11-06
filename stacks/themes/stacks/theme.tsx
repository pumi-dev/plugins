// Stacks: pumi's window as stacked columns (window.tsx), in the default theme's look. Every tab
// of the session is a column in one sideways scroll, and a column scrolled past the left edge
// folds into a spine with its title running down it.
//
// The colours, text and metrics are the default theme's. With a terminal colour scheme picked
// (Settings → Appearance), the window takes its colours from the scheme as the default theme does
// (`fromPalette`, the same mapping), so a column and the terminal in it are one colour.
import { defineTheme, type TerminalPalette, type Tokens } from "pumi"

// pumi reloads a theme by importing theme.tsx again with a new `?v=`, but a static import of
// window.tsx would stay the copy first loaded. Passing the same `?v=` on loads it fresh too.
const { Window } = (await import(`./window.tsx${new URL(import.meta.url).search}`)) as typeof import("./window.tsx")

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
/** Relative luminance, 0 (black) to 1 (white). */
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** The window in a scheme's colours, as the default theme makes them (`schemeLook`). */
function fromPalette(p: TerminalPalette): Partial<Tokens> {
  if (!HEX.test(p.background) || !HEX.test(p.foreground)) return {}
  const bg = p.background.slice(0, 7)
  const fg = p.foreground.slice(0, 7)
  const ansi = (i: number, or: string) => (p.ansi[i] && HEX.test(p.ansi[i]!) ? p.ansi[i]!.slice(0, 7) : or)
  const toward = (by: number) => mix(bg, fg, by)
  const accent = ansi(4, "#4f8ff7")
  const surface = toward(0.04)
  const faint = mix(fg, bg, 0.5)
  return {
    window: toward(0.05),
    surface,
    editor: bg,
    text: fg,
    muted: mix(fg, bg, 0.3),
    faint,
    border: toward(0.12),
    hover: toward(0.1),
    active: toward(0.16),
    selected: toward(0.2),
    accent,
    accentText: luminance(accent) > 0.4 ? "#000000" : "#ffffff",
    warning: ansi(3, "#e5c07b"),
    error: ansi(1, "#ef6b73"),
    success: ansi(2, "#64b75d"),
    overlay: `${surface}f2`,
    "status.working": accent,
    "status.blocked": ansi(3, "#e5c07b"),
    "status.error": ansi(1, "#ef6b73"),
    "status.done": ansi(2, "#64b75d"),
    "status.idle": mix(fg, bg, 0.4),
    "status.unknown": faint,
  }
}

export default defineTheme({
  name: "Stacks",
  description: "Every tab a column in one sideways scroll, the ones scrolled past folded into spines, in the default theme's look.",
  fromPalette,
  components: { Window },
})
