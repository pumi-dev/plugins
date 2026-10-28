// The page's pure parts: the Monaco theme made of the window's tokens, and the paths a drop carries.
import { expect, test } from "bun:test";
import { droppedPaths, takesDrag } from "../page/drop.ts";
import { CLEAR, contrast, expand, isLight, mix, monacoTheme, readableSelection, withAlpha } from "../page/theme.ts";

const DARK = {
  editor: "#1e1f22",
  surface: "#26282b",
  text: "#dfe1e5",
  muted: "#b0b1b3",
  faint: "#888a8f",
  border: "#393b41",
  hover: "#3c3e41",
  selected: "#4a4d54",
  accent: "#3474f0",
  accentText: "#ffffff",
  warning: "#f0c674",
  error: "#cc6666",
};

test("hex colours expand, take an alpha, and say how light they are", () => {
  expect(expand("#abc")).toBe("#aabbcc");
  expect(expand("#ABCD")).toBe("#aabbccdd");
  expect(expand("rgb(1, 2, 3)")).toBeNull();
  expect(withAlpha("#3474f0", 0.5)).toBe("#3474f080");
  expect(withAlpha("#3474f080", 0.5)).toBe("#3474f040");
  expect(withAlpha("red", 0.5)).toBeNull();
  expect(isLight("#ffffff")).toBe(true);
  expect(isLight("#1e1f22")).toBe(false);
});

test("the editor is clear, its widgets on the theme's surface, its cursor the accent", () => {
  const theme = monacoTheme(DARK);
  expect(theme.base).toBe("vs-dark");
  expect(theme.colors["editor.background"]).toBe(CLEAR);
  expect(theme.colors["editorGutter.background"]).toBe(CLEAR);
  expect(theme.colors["editorWidget.background"]).toBe(DARK.surface);
  expect(theme.colors["editorWidget.border"]).toBe(DARK.border);
  expect(theme.colors["editorCursor.foreground"]).toBe(DARK.accent);
  expect(theme.colors["editor.selectionBackground"]).toBe(DARK.selected);
  expect(theme.colors["editorStickyScroll.background"]).toBe(DARK.editor);
  expect(theme.rules).toEqual([{ token: "", foreground: "dfe1e5" }]);
  expect(monacoTheme({ ...DARK, editor: "#ffffff" }).base).toBe("vs");
});

/** JetBrains Darcula, as the app gives a page the palette. */
const DARCULA = {
  "palette.background": "#202020",
  "palette.foreground": "#adadad",
  "palette.cursor": "#ffffff",
  "palette.selection": "#1a3272",
  ...Object.fromEntries(
    ["#000000", "#fa5355", "#126e00", "#c2c300", "#4581eb", "#fa54ff", "#33c2c1", "#adadad", "#555555", "#fb7172", "#67ff4f", "#ffff00", "#6d9df1", "#fb82ff", "#60d3d1", "#eeeeee"].map((c, i) => [`palette.color${i}`, c]),
  ),
};

test("colours mix, and say how well they read on each other", () => {
  expect(mix("#ffffff", "#000000", 0.5)).toBe("#808080");
  expect(mix("red", "#000000", 0.5)).toBeNull();
  expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
  expect(contrast("#202020", "#202020")).toBe(1);
});

test("the text is the palette's: its background, its colours, its code in its sixteen", () => {
  // A theme whose tokens are light (Office) over a palette that is dark: the palette wins.
  const theme = monacoTheme({ ...DARK, editor: "#ffffff", text: "#2b2d42", ...DARCULA });
  expect(theme.base).toBe("vs-dark");
  expect(theme.colors["editor.background"]).toBe("#202020");
  expect(theme.colors["editor.foreground"]).toBe("#adadad");
  expect(theme.colors["editorCursor.foreground"]).toBe("#ffffff");
  expect(theme.colors["editor.selectionBackground"]).toBe("#1a3272");
  expect(theme.colors["editorStickyScroll.background"]).toBe("#202020");
  // The widgets stay the window's.
  expect(theme.colors["editorWidget.background"]).toBe(DARK.surface);
  const rule = (token: string) => theme.rules.find((r) => r.token === token)?.foreground;
  expect(rule("")).toBe("adadad");
  expect(rule("string")).toBe("67ff4f"); // green #126e00 is too dark on #202020: its bright one
  expect(rule("keyword")).toBe("4581eb");
  expect(rule("number")).toBe("c2c300");
  for (const r of theme.rules) if (r.foreground) expect(contrast(`#${r.foreground}`, "#202020")).toBeGreaterThanOrEqual(3);
});

test("a selection the text can't be read on is laid over the background until it can", () => {
  // GitHub Dark Default: its selection is its foreground, for a terminal that inverts the text.
  const theme = monacoTheme({ ...DARK, ...DARCULA, "palette.background": "#0d1117", "palette.foreground": "#e6edf3", "palette.selection": "#e6edf3" });
  const selection = theme.colors["editor.selectionBackground"]!;
  expect(contrast(selection, "#e6edf3")).toBeGreaterThanOrEqual(4.5);
  expect(contrast(selection, "#0d1117")).toBeGreaterThan(1.5);
  // One that reads already is left as it is.
  expect(readableSelection("#1a3272", "#adadad", "#202020")).toBe("#1a3272");
});

test("the palette's opacity is the editor's, and a light palette is Monaco's light base", () => {
  expect(monacoTheme({ ...DARK, ...DARCULA, "palette.background": "#20202080" }).colors["editor.background"]).toBe("#20202080");
  const light = monacoTheme({ ...DARK, ...DARCULA, "palette.background": "#ffffff", "palette.foreground": "#383a42" });
  expect(light.base).toBe("vs");
});

test("a token that is not hex goes through the normalizer, or is left to the base", () => {
  const theme = monacoTheme({ ...DARK, accent: "rgb(52, 116, 240)", border: "nonsense" }, (c) => (c.startsWith("rgb") ? "#3474f0" : null));
  expect(theme.colors["editorCursor.foreground"]).toBe("#3474f0");
  expect(theme.colors["editorWidget.border"]).toBeUndefined();
});

test("a drop's paths: the project tree's, a list, a file URL", () => {
  const from = (data: Record<string, string>) => (type: string) => data[type] ?? "";
  expect(droppedPaths(from({ "application/x-pumi+json": JSON.stringify({ path: "/src/a.ts" }) }))).toEqual(["/src/a.ts"]);
  expect(droppedPaths(from({ "application/x-pumi+json": JSON.stringify({ paths: ["/a", "/b"] }) }))).toEqual(["/a", "/b"]);
  expect(droppedPaths(from({ "application/x-pumi+json": JSON.stringify({ kind: "pumi.pane", pane: "%3" }) }))).toEqual([]);
  expect(droppedPaths(from({ "text/uri-list": "# a comment\nfile:///src/a%20b.ts\nhttps://example.com\n" }))).toEqual(["/src/a b.ts"]);
  expect(droppedPaths(from({ "text/uri-list": "file://elsewhere/x" }))).toEqual([]);
});

test("a drag is taken when it carries a file, and a pane being moved is left to the panes", () => {
  const drag = (data: Record<string, string>) => [Object.keys(data), (type: string) => data[type] ?? ""] as const;
  expect(takesDrag(...drag({ "application/x-pumi+json": JSON.stringify({ path: "/a" }), "text/uri-list": "file:///a" }))).toBe(true);
  expect(takesDrag(...drag({ "application/x-pumi+json": JSON.stringify({ kind: "pumi.pane", pane: "%3" }), "text/plain": "" }))).toBe(false);
  expect(takesDrag(...drag({ "text/uri-list": "" }))).toBe(true);
  expect(takesDrag(...drag({ "text/uri-list": "https://example.com" }))).toBe(false);
  expect(takesDrag(...drag({ "text/plain": "hello" }))).toBe(false);
});
