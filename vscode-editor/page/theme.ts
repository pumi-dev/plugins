// Monaco's theme, made from the window's. The text is the colour palette's, the one the terminals
// are drawn in: its background, foreground, cursor and selection, and the code in its sixteen
// colours (`palette.*`, which the app gives every page), so a file tab looks like the terminal
// beside it whatever the theme paints around them. Without those it falls back to the theme's own tokens: the editor clear so the tab
// shows through, and Monaco's syntax colours (`vs-dark` or `vs`, by how light `editor` is). The
// widgets (find, suggestions, hovers) are the window's either way: its `surface`, `border` and
// `accent`. Pure, so the tests read it without a page.

/** The window's colour tokens, as `pumi.theme` gives them. */
export type Tokens = Record<string, string>;

/** What `monaco.editor.defineTheme` takes. */
export interface MonacoTheme {
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: { token: string; foreground?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

/** Clear: what the editor's own background is, so the window's shows. */
export const CLEAR = "#00000000";

/** `#rrggbb` or `#rrggbbaa` of a CSS colour Monaco can't read (`rgb(…)`), or null. */
export type Normalize = (color: string) => string | null;

/** `#rrggbbaa` of `color` at `alpha` (0–1), over its own alpha; null for what is not hex. */
export function withAlpha(color: string, alpha: number): string | null {
  const hex = expand(color);
  if (!hex) return null;
  const own = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  const a = Math.round(Math.min(1, Math.max(0, alpha * own)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 7)}${a}`;
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` as `#rrggbb` or `#rrggbbaa`, lowercased; null otherwise. */
export function expand(color: string): string | null {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{3,4}$/.test(c)) return `#${[...c.slice(1)].map((d) => d + d).join("")}`;
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(c)) return c;
  return null;
}

/** Whether a colour is light, by its luminance: which of Monaco's bases the theme sits on. */
export function isLight(color: string): boolean {
  const hex = expand(color);
  if (!hex) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

/** `#rrggbb` of `a` laid over `b` at `amount` (0–1); null for what is not hex. */
export function mix(a: string, b: string, amount: number): string | null {
  const [x, y] = [expand(a), expand(b)];
  if (!x || !y) return null;
  const byte = (i: number) => {
    const v = parseInt(x.slice(i, i + 2), 16) * amount + parseInt(y.slice(i, i + 2), 16) * (1 - amount);
    return Math.round(v).toString(16).padStart(2, "0");
  };
  return `#${byte(1)}${byte(3)}${byte(5)}`;
}

/** WCAG's contrast ratio of two colours (1–21), by their relative luminance; 1 for what is not hex. */
export function contrast(a: string, b: string): number {
  const lum = (color: string): number | null => {
    const hex = expand(color);
    if (!hex) return null;
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)];
  if (x === null || y === null) return 1;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Below this a colour is hard to read on its background (WCAG's ratio for large text). */
const LEGIBLE = 3;

/** Text on a selection should read at least this well (WCAG's ratio for body text). */
const READABLE = 4.5;

/** The selection as the editor can draw it. Monaco keeps the text's own colour over a selection,
 *  while a terminal scheme may pair a light selection with a dark text of its own (GitHub Dark's
 *  is its foreground, `#e6edf3`): such a selection is laid over the background, less and less of
 *  it, until the text reads on it. */
export function readableSelection(selection: string, foreground: string, solid: string): string {
  if (contrast(selection, foreground) >= READABLE) return selection;
  for (let amount = 0.9; amount > 0.1; amount -= 0.05) {
    const c = mix(selection, solid, amount);
    if (c && contrast(c, foreground) >= READABLE) return c;
  }
  return mix(foreground, solid, 0.25) ?? selection;
}

/** The palette, as a page has it (`palette.background`, …), or null without it. */
interface Palette {
  background: string;
  /** The background without its alpha: what the text is read against. */
  solid: string;
  foreground: string;
  cursor: string;
  selection: string;
  ansi: string[];
}

function paletteOf(hex: (name: string) => string | null): Palette | null {
  const background = hex("palette.background");
  const foreground = hex("palette.foreground");
  if (!background || !foreground) return null;
  const solid = background.slice(0, 7);
  const ansi = Array.from({ length: 16 }, (_, i) => hex(`palette.color${i}`) ?? foreground);
  return {
    background,
    solid,
    foreground,
    cursor: hex("palette.cursor") ?? foreground,
    selection: readableSelection(hex("palette.selection") ?? mix(foreground, solid, 0.25) ?? foreground, foreground, solid),
    ansi,
  };
}

/** The code's colours by Monaco's token names, in the palette's sixteen: each the colour a terminal
 *  would use for it, its bright one when that reads better, else the plain text. */
function paletteRules(t: Palette): MonacoTheme["rules"] {
  const color = (i: number): string => {
    for (const c of [t.ansi[i]!, t.ansi[i + 8]!]) if (contrast(c, t.solid) >= LEGIBLE) return c;
    return t.foreground;
  };
  const [red, green, yellow, blue, magenta, cyan] = [1, 2, 3, 4, 5, 6].map(color);
  const comment = mix(t.foreground, t.solid, 0.55) ?? t.foreground;
  const rule = (token: string, foreground: string, fontStyle?: string) => ({
    token,
    foreground: foreground.slice(1, 7),
    ...(fontStyle ? { fontStyle } : {}),
  });
  return [
    rule("", t.foreground),
    rule("comment", comment, "italic"),
    rule("keyword", blue!),
    rule("keyword.md", blue!, "bold"),
    rule("string", green!),
    rule("string.escape", cyan!),
    rule("string.link", cyan!),
    rule("regexp", cyan!),
    rule("number", yellow!),
    rule("constant", magenta!),
    rule("predefined", magenta!),
    rule("type", cyan!),
    rule("tag", red!),
    rule("metatag", magenta!),
    rule("annotation", magenta!),
    rule("attribute.name", yellow!),
    rule("attribute.value", green!),
    rule("variable.md", yellow!),
    rule("invalid", red!),
    rule("delimiter", t.foreground),
    rule("operator", t.foreground),
    rule("identifier", t.foreground),
    rule("variable", t.foreground),
    rule("emphasis", t.foreground, "italic"),
    rule("strong", t.foreground, "bold"),
  ];
}

/** The text's colours, the palette's: what replaces the theme's for the editor itself. */
function paletteColors(t: Palette): [string, string | null][] {
  const ink = (alpha: number) => withAlpha(t.foreground, alpha);
  return [
    ["editor.background", t.background],
    ["editor.foreground", t.foreground],
    ["editorLineNumber.foreground", mix(t.foreground, t.solid, 0.4)],
    ["editorLineNumber.activeForeground", mix(t.foreground, t.solid, 0.8)],
    ["editorCursor.foreground", t.cursor],
    ["editor.selectionBackground", t.selection],
    ["editor.inactiveSelectionBackground", withAlpha(t.selection, 0.6)],
    ["editor.selectionHighlightBackground", withAlpha(t.selection, 0.5)],
    ["editor.lineHighlightBackground", ink(0.06)],
    ["editor.wordHighlightBackground", ink(0.1)],
    ["editor.wordHighlightStrongBackground", withAlpha(t.selection, 0.7)],
    ["editor.hoverHighlightBackground", ink(0.1)],
    ["editor.findRangeHighlightBackground", ink(0.08)],
    ["editorBracketMatch.background", ink(0.12)],
    ["editorBracketMatch.border", ink(0.35)],
    ["editorIndentGuide.background1", ink(0.12)],
    ["editorIndentGuide.activeBackground1", ink(0.3)],
    ["editorWhitespace.foreground", ink(0.2)],
    ["editorRuler.foreground", ink(0.12)],
    ["editorStickyScroll.background", t.solid],
    ["peekViewEditor.background", t.solid],
    ["peekViewEditorGutter.background", t.solid],
    ["scrollbarSlider.background", ink(0.18)],
    ["scrollbarSlider.hoverBackground", ink(0.28)],
    ["scrollbarSlider.activeBackground", ink(0.38)],
  ];
}

/** The Monaco theme for the window's tokens. `normalize` turns a non-hex token into hex (the page's
 *  canvas does); a token neither can read is left to the base theme. */
export function monacoTheme(tokens: Tokens, normalize: Normalize = () => null): MonacoTheme {
  const hex = (name: string): string | null => {
    const value = tokens[name];
    if (typeof value !== "string") return null;
    return expand(value) ?? normalize(value);
  };
  const at = (name: string, alpha: number): string | null => {
    const value = hex(name);
    return value ? withAlpha(value, alpha) : null;
  };
  const editor = hex("editor") ?? hex("window") ?? "#1e1f22";
  const light = isLight(editor);
  const pairs: [string, string | null][] = [
    ["editor.background", CLEAR],
    ["editor.foreground", hex("text")],
    ["editorGutter.background", CLEAR],
    ["minimap.background", CLEAR],
    ["editorOverviewRuler.border", CLEAR],
    ["editorOverviewRuler.background", CLEAR],
    ["editorLineNumber.foreground", hex("faint")],
    ["editorLineNumber.activeForeground", hex("muted")],
    ["editorCursor.foreground", hex("accent")],
    ["editor.selectionBackground", hex("selected")],
    ["editor.inactiveSelectionBackground", at("selected", 0.6)],
    ["editor.selectionHighlightBackground", at("selected", 0.5)],
    ["editor.lineHighlightBackground", at("hover", 0.45)],
    ["editor.lineHighlightBorder", CLEAR],
    ["editor.wordHighlightBackground", at("hover", 0.8)],
    ["editor.wordHighlightStrongBackground", at("selected", 0.7)],
    ["editor.findMatchBackground", at("accent", 0.45)],
    ["editor.findMatchHighlightBackground", at("accent", 0.22)],
    ["editor.findRangeHighlightBackground", at("hover", 0.4)],
    ["editor.hoverHighlightBackground", at("hover", 0.6)],
    ["editorBracketMatch.background", at("hover", 0.8)],
    ["editorBracketMatch.border", hex("faint")],
    ["editorIndentGuide.background1", at("border", 0.9)],
    ["editorIndentGuide.activeBackground1", hex("faint")],
    ["editorWhitespace.foreground", hex("border")],
    ["editorRuler.foreground", hex("border")],
    ["editorLink.activeForeground", hex("accent")],
    ["editorError.foreground", hex("error")],
    ["editorWarning.foreground", hex("warning")],
    ["editorInfo.foreground", hex("accent")],
    // The lines that stay at the top while their block scrolls: drawn over the text, so not clear.
    ["editorStickyScroll.background", editor],
    ["editorStickyScrollHover.background", hex("hover")],
    ["editorStickyScroll.shadow", at("border", 0.8)],
    ["focusBorder", at("accent", 0.8)],
    ["foreground", hex("text")],
    ["descriptionForeground", hex("muted")],
    ["widget.shadow", "#00000040"],
    ["widget.border", hex("border")],
    ["editorWidget.background", hex("surface")],
    ["editorWidget.foreground", hex("text")],
    ["editorWidget.border", hex("border")],
    ["editorWidget.resizeBorder", hex("accent")],
    ["editorHoverWidget.background", hex("surface")],
    ["editorHoverWidget.foreground", hex("text")],
    ["editorHoverWidget.border", hex("border")],
    ["editorHoverWidget.statusBarBackground", hex("surface")],
    ["editorSuggestWidget.background", hex("surface")],
    ["editorSuggestWidget.foreground", hex("text")],
    ["editorSuggestWidget.border", hex("border")],
    ["editorSuggestWidget.selectedBackground", hex("selected")],
    ["editorSuggestWidget.selectedForeground", hex("text")],
    ["editorSuggestWidget.highlightForeground", hex("accent")],
    ["editorSuggestWidget.focusHighlightForeground", hex("accent")],
    ["editorSuggestWidgetStatus.foreground", hex("faint")],
    ["editorMarkerNavigation.background", hex("surface")],
    ["input.background", hex("editor")],
    ["input.foreground", hex("text")],
    ["input.border", hex("border")],
    ["input.placeholderForeground", hex("faint")],
    ["inputOption.activeBorder", hex("accent")],
    ["inputOption.activeBackground", at("accent", 0.25)],
    ["inputValidation.errorBorder", hex("error")],
    ["inputValidation.errorBackground", hex("surface")],
    ["button.background", hex("accent")],
    ["button.foreground", hex("accentText")],
    ["list.hoverBackground", hex("hover")],
    ["list.activeSelectionBackground", hex("selected")],
    ["list.activeSelectionForeground", hex("text")],
    ["list.inactiveSelectionBackground", hex("selected")],
    ["list.focusBackground", hex("selected")],
    ["list.focusForeground", hex("text")],
    ["list.highlightForeground", hex("accent")],
    ["list.focusHighlightForeground", hex("accent")],
    ["quickInput.background", hex("surface")],
    ["quickInput.foreground", hex("text")],
    ["quickInputList.focusBackground", hex("selected")],
    ["quickInputList.focusForeground", hex("text")],
    ["quickInputTitle.background", hex("surface")],
    ["pickerGroup.foreground", hex("muted")],
    ["pickerGroup.border", hex("border")],
    ["keybindingLabel.foreground", hex("muted")],
    ["keybindingLabel.background", at("hover", 0.6)],
    ["keybindingLabel.border", hex("border")],
    ["keybindingLabel.bottomBorder", hex("border")],
    ["peekView.border", hex("accent")],
    ["peekViewTitle.background", hex("surface")],
    ["peekViewTitleLabel.foreground", hex("text")],
    ["peekViewTitleDescription.foreground", hex("muted")],
    ["peekViewEditor.background", editor],
    ["peekViewEditorGutter.background", editor],
    ["peekViewResult.background", hex("surface")],
    ["peekViewResult.selectionBackground", hex("selected")],
    ["peekViewEditor.matchHighlightBackground", at("accent", 0.35)],
    ["peekViewResult.matchHighlightBackground", at("accent", 0.35)],
    ["scrollbar.shadow", CLEAR],
    ["scrollbarSlider.background", at("faint", 0.25)],
    ["scrollbarSlider.hoverBackground", at("faint", 0.4)],
    ["scrollbarSlider.activeBackground", at("faint", 0.55)],
    ["badge.background", hex("accent")],
    ["badge.foreground", hex("accentText")],
    ["progressBar.background", hex("accent")],
    ["textLink.foreground", hex("accent")],
    ["textLink.activeForeground", hex("accent")],
    ["menu.background", hex("surface")],
    ["menu.foreground", hex("text")],
    ["menu.selectionBackground", hex("hover")],
    ["menu.border", hex("border")],
  ];
  const palette = paletteOf(hex);
  if (palette) pairs.push(...paletteColors(palette));
  const colors: Record<string, string> = {};
  for (const [name, value] of pairs) if (value) colors[name] = value;
  if (palette) return { base: isLight(palette.solid) ? "vs" : "vs-dark", inherit: true, rules: paletteRules(palette), colors };
  const text = hex("text");
  return {
    base: light ? "vs" : "vs-dark",
    inherit: true,
    rules: text ? [{ token: "", foreground: text.slice(1, 7) }] : [],
    colors,
  };
}
