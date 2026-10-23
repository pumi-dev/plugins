// The app's colours, said the way Pele's SVG says them: the theme's tokens become Pele's
// `--pele-*` variables, which `themed()` writes into the diagram (the app's renderer knows no CSS
// custom properties). The fills and lines are mixed from the background and the text rather than
// taken from tokens of the same name: a theme is free to paint a surface almost the colour of its
// background, and a diagram of invisible boxes is no diagram.
//
// The tokens come from the window: the diagram's renderer has them (`useTheme`, `useMetrics`) and
// hands them to `main.ts`'s `drawn`. Without them (a call from elsewhere: `draw`, `render`, `save`)
// a diagram is Pele's own light one.
import { FALLBACK_FONT, FALLBACK_MONO, type Faces } from "./pele.ts";

/** The app's colours as a diagram reads them: every token as `#rrggbb[aa]`, and its metrics. */
export interface AppTheme {
  colors?: Record<string, string>;
  metrics?: Record<string, number>;
  fonts?: Record<string, string>;
}

/** A colour as a rasteriser wants one, its channels from 0 to 1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** What a diagram is painted on, and in. */
export interface Palette {
  /** Pele's variables, resolved by `themed()` into the SVG. */
  vars: Record<string, string>;
  /** The pane's own colour, which the diagram is painted on (`#rrggbb` or `rgba(…)`). */
  background: string;
}

/** Every variable Pele reads, from the app's theme and the faces the diagram is set in. */
export function palette(theme: AppTheme | null, faces: Faces): Palette {
  const colors = theme?.colors ?? {};
  const background = rgba(colors.editor ?? "#ffffff");
  const text = rgba(colors.surface_text ?? "#1f1f1f");
  const radius = theme?.metrics?.radius_sm;
  return {
    background: css(background),
    vars: {
      "--pele-bg": css(background),
      "--pele-fg": css(text),
      "--pele-muted": css(mix(background, text, 0.62)),
      "--pele-line": css(mix(background, text, 0.58)),
      "--pele-surface": css(mix(background, text, 0.08)),
      "--pele-surface-alt": css(mix(background, text, 0.15)),
      "--pele-border": css(mix(background, text, 0.32)),
      "--pele-accent": css(rgba(colors.primary ?? "#5b7bd5")),
      "--pele-radius": `${typeof radius === "number" ? radius : 4}px`,
      "--pele-font": faces.font || FALLBACK_FONT,
      "--pele-font-mono": faces.mono || FALLBACK_MONO,
    },
  };
}

/** `t` of the way from `from` to `to`, alpha included. */
export function mix(from: Rgba, to: Rgba, t: number): Rgba {
  const at = Math.min(1, Math.max(0, t));
  return {
    r: from.r + (to.r - from.r) * at,
    g: from.g + (to.g - from.g) * at,
    b: from.b + (to.b - from.b) * at,
    a: from.a + (to.a - from.a) * at,
  };
}

/** A colour as CSS says one: `#rrggbb`, or `rgba(…)` when it is not opaque. */
export function css(colour: Rgba): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  const [r, g, b] = [channel(colour.r), channel(colour.g), channel(colour.b)];
  if (colour.a >= 0.999) return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, colour.a)).toFixed(3)})`;
}

/** A colour as the app writes one: `#rrggbb`, `#rrggbbaa`, `rgb(…)` or `rgba(…)`. */
export function rgba(text: string): Rgba {
  const value = text.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const at = (index: number) => parseInt(hex.slice(index, index + 2), 16) / 255;
    if (hex.length >= 6) return { r: at(0), g: at(2), b: at(4), a: hex.length >= 8 ? at(6) : 1 };
  }
  const parts = value.replace(/^rgba?\(/, "").replace(/\)$/, "").split(",").map((part) => Number(part.trim()));
  if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
    return { r: parts[0]! / 255, g: parts[1]! / 255, b: parts[2]! / 255, a: parts[3] ?? 1 };
  }
  // Nothing readable: the diagram is drawn in Pele's own colours rather than in nothing.
  return { r: 1, g: 1, b: 1, a: 1 };
}
