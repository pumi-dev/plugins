// Monaco's theme, made from the window's: the editor clear so the pane shows through, its widgets
// on the theme's `surface` and `border`, the cursor and matches in its `accent`. The syntax colours
// are Monaco's own (`vs-dark` or `vs`, by how light the theme's `editor` is): a pumi theme has none.
// Pure, so the tests read it without a page.

/** The window's colour tokens, as `pumi.theme` gives them. */
export type Tokens = Record<string, string>;

/** What `monaco.editor.defineTheme` takes. */
export interface MonacoTheme {
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: { token: string; foreground?: string }[];
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
  const colors: Record<string, string> = {};
  for (const [name, value] of pairs) if (value) colors[name] = value;
  const text = hex("text");
  return {
    base: light ? "vs" : "vs-dark",
    inherit: true,
    rules: text ? [{ token: "", foreground: text.slice(1, 7) }] : [],
    colors,
  };
}
