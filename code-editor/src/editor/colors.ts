// The editor's colours: the terminals' palette (its background, text, cursor and selection, and the
// code in its sixteen colours), or the window theme's tokens when the theme has no palette.
import type { TokenClass } from "./highlight.ts";

export interface Colors {
  background: string;
  text: string;
  caret: string;
  selection: string;
  currentLine: string;
  gutter: string;
  gutterCurrent: string;
  bracket: string;
  tokens: Record<TokenClass, string>;
}

export interface PaletteLike {
  background: string;
  foreground: string;
  selection: string;
  cursor: string;
  ansi: string[];
}

export interface TokensLike {
  editor?: string;
  surface: string;
  text: string;
  muted: string;
  selected: string;
  accent: string;
  error: string;
  success: string;
  warning: string;
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as its channels 0..255, or null for anything else. */
export function rgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())?.[1];
  if (!hex) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(color: string): number | null {
  const c = rgb(color);
  if (!c) return null;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast of two colours; 21 for any it cannot read, so they are kept. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 21;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `color` at `alpha`, as `#rrggbbaa`; the colour itself when it cannot be read. */
export function withAlpha(color: string, alpha: number): string {
  const c = rgb(color);
  if (!c) return color;
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${c.map(hex).join("")}${hex(alpha * 255)}`;
}

/** Each class's palette colour, by the sixteen's index: keywords blue, strings green, numbers
 *  yellow, types cyan, tags red, as the terminals have them. */
const ANSI: Partial<Record<TokenClass, number>> = {
  keyword: 4,
  string: 2,
  number: 3,
  constant: 3,
  comment: 8,
  type: 6,
  function: 12,
  tag: 1,
  attribute: 3,
  heading: 4,
  link: 6,
  meta: 5,
  regexp: 1,
  invalid: 9,
};

const CLASSES: TokenClass[] = ["", "keyword", "string", "number", "constant", "comment", "type", "function", "property", "operator", "punctuation", "tag", "attribute", "heading", "link", "meta", "regexp", "invalid"];

/** A selection colour the text stays readable on. A terminal's is often light, with its text
 *  drawn dark on it; the editor keeps the code's colours, so a light one is laid thin over the
 *  background instead. */
function readable(selection: string, text: string): string {
  return contrast(selection, text) < 3 ? withAlpha(selection, 0.25) : selection;
}

export function colorsFrom(palette: PaletteLike | undefined, t: TokensLike): Colors {
  const background = palette?.background ?? t.editor ?? t.surface;
  const text = palette?.foreground ?? t.text;
  /** A plain colour too dark to read on the background gives way to its bright one. */
  const pick = (index: number | undefined): string => {
    if (index === undefined || !palette?.ansi?.[index]) return text;
    const plain = palette.ansi[index];
    if (index >= 8 || contrast(plain, background) >= 2.5) return plain;
    return palette.ansi[index + 8] ?? plain;
  };
  const fallback: Partial<Record<TokenClass, string>> = {
    keyword: t.accent,
    string: t.success,
    number: t.warning,
    constant: t.warning,
    comment: t.muted,
    type: t.accent,
    tag: t.error,
    invalid: t.error,
  };
  const tokens = Object.fromEntries(CLASSES.map((cls) => [cls, palette ? pick(ANSI[cls]) : (fallback[cls] ?? text)])) as Record<TokenClass, string>;
  tokens.punctuation = withAlpha(text, 0.8);
  if (palette && contrast(tokens.comment, background) < 2) tokens.comment = t.muted;
  return {
    background,
    text,
    caret: palette?.cursor ?? t.accent,
    selection: readable(palette?.selection ?? t.selected, text),
    currentLine: withAlpha(text, 0.05),
    gutter: withAlpha(text, 0.35),
    gutterCurrent: withAlpha(text, 0.8),
    bracket: withAlpha(text, 0.18),
    tokens,
  };
}
