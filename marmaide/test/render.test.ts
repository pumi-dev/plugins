// A diagram is Pele's drawing, dressed in the window's colours: what the worker hands the tab.
import { expect, test } from "bun:test";
import { palette } from "../src/palette.ts";
import { definitions, draw, resolve, themed } from "../src/pele.ts";

const CHART = "flowchart LR\n  ask --> draw --> look";

test("Pele draws a diagram, and says what kind and size it is", () => {
  const drawn = draw(CHART);
  expect(drawn.kind).toBe("flowchart");
  expect(drawn.width).toBeGreaterThan(0);
  expect(drawn.height).toBeGreaterThan(0);
  // Pele's own SVG: the nodes by id, and colours as the variables a browser resolves.
  expect(drawn.svg).toContain('data-id="ask"');
  expect(drawn.svg).toContain("var(--pele-fg");
});

test("a diagram Pele cannot read fails with Pele's own message, saying where", () => {
  expect(() => draw("nope")).toThrow(/No diagram type/);
  expect(() => draw("flowchart LR\n  a[[[ b")).toThrow(/line 2/);
});

test("themed() writes the theme into the SVG, where a renderer without CSS variables sees it", () => {
  const vars = { "--pele-bg": "#000000", "--pele-fg": "#ffffff", "--pele-accent": "#7aa2f7", "--pele-font": "Georgia" };
  const out = themed(draw(CHART).svg, vars);
  // No `var()` survives: every one is the colour, length or name it stood for.
  expect(out).not.toContain("var(");
  expect(out).toContain("#ffffff");
  expect(out).toContain("#000000");
  // The face is on every text element: usvg drops text it cannot name a face for.
  expect(out).toContain('font-family="Georgia"');
});

test("a variable resolves through the SVG's own definitions, then the fallback", () => {
  const svg = `<svg style="--_fg:var(--pele-fg,#1f1f1f)"><text fill="var(--_fg)">x</text><text fill="var(--pele-accent,#5b7bd5)">y</text></svg>`;
  const defs = definitions(svg);
  expect(defs.get("--_fg")).toBe("var(--pele-fg,#1f1f1f)");
  expect(resolve("var(--_fg)", { "--pele-fg": "#c8c8c8" }, defs)).toBe("#c8c8c8");
  expect(resolve("var(--_fg)", {}, defs)).toBe("#1f1f1f");
  expect(resolve("var(--pele-accent,#5b7bd5)", {}, defs)).toBe("#5b7bd5");
});

test("the palette says a diagram in the app's colours", () => {
  const vars = palette({ colors: { editor: "#1e1e1e", surface_text: "#c8c8c8" } }, { font: "sans-serif", mono: "monospace", size: 16 }).vars;
  const out = themed(draw(CHART).svg, vars);
  expect(out).toContain("#1e1e1e");
  expect(out).toContain("#c8c8c8");
});
