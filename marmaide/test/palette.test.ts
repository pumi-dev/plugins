// The app's colours as Pele's variables: mixes of the background and the text, so a diagram reads
// in any theme, and the picture's own colour under it.
import { expect, test } from "bun:test";
import { css, mix, palette, rgba, type AppTheme } from "../src/palette.ts";
import type { Faces } from "../src/pele.ts";

const faces: Faces = { font: "IBM Plex Sans", mono: "IBM Plex Mono", size: 16 };

/** A dark theme as the window hands one over: its tokens, as `#rrggbb`, and the metric a diagram
 * reads (`diagramTheme` in `ui.tsx` maps `useTheme()` and `useMetrics()` onto this). */
const dark: AppTheme = {
  colors: {
    editor: "#1e1e1e",
    surface_text: "#c8c8c8",
    muted: "#8a8a8a",
    border: "#555555",
    primary: "#7aa2f7",
    error: "#f7768e",
  },
  metrics: { radius_sm: 6 },
  fonts: { font: "SF Pro Text", mono: "SF Mono" },
};

test("colours read both ways and mix with their alpha", () => {
  expect(rgba("#c8c8c8")).toEqual({ r: 0xc8 / 255, g: 0xc8 / 255, b: 0xc8 / 255, a: 1 });
  expect(rgba("#00000080").a).toBeCloseTo(0.5, 2);
  expect(rgba("rgba(255, 128, 0, 0.5)")).toEqual({ r: 1, g: 128 / 255, b: 0, a: 0.5 });
  expect(css({ r: 1, g: 1, b: 1, a: 1 })).toBe("#ffffff");
  expect(css({ r: 1, g: 0.5, b: 0, a: 0.5 })).toBe("rgba(255, 128, 0, 0.500)");
});

test("a mix is t of the way from one colour to the other", () => {
  const mixed = mix(rgba("#000000"), rgba("#ffffff"), 0.5);
  expect(css(mixed)).toBe("#808080");
  expect(css(mix(rgba("#000000"), rgba("#ffffff"), 2))).toBe("#ffffff");
});

test("the palette is the theme's, in Pele's names", () => {
  const { vars, background } = palette(dark, faces);
  expect(background).toBe("#1e1e1e");
  expect(vars["--pele-bg"]).toBe("#1e1e1e");
  expect(vars["--pele-fg"]).toBe("#c8c8c8");
  expect(vars["--pele-accent"]).toBe("#7aa2f7");
  expect(vars["--pele-radius"]).toBe("6px");
  expect(vars["--pele-font"]).toBe("IBM Plex Sans");
  // Surfaces are mixed from the background and the text, not tokens a theme may paint the same as
  // its background: a box nearly the colour of its page is an invisible box.
  expect(vars["--pele-surface"]).toBe("#2c2c2c");
  expect(vars["--pele-border"]).toBe("#545454");
});

test("without a theme a diagram is Pele's own light one", () => {
  const { vars, background } = palette(null, faces);
  expect(background).toBe("#ffffff");
  expect(vars["--pele-fg"]).toBe("#1f1f1f");
});
