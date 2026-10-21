// The package's tool, against `pumi/testing`'s fake app: the three functions an agent calls, what
// they answer, and what `draw` puts on a pane.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");
/** A dark theme, as `app.theme` answers one: a diagram is dressed in it. */
const THEME = {
  colors: { editor: "#1e1e1e", surface_text: "#c8c8c8", primary: "#7aa2f7", border: "#555555" },
  metrics: { radius_sm: 6 },
  fonts: { font: "SF Pro Text", mono: "SF Mono" },
};
let app: FakeApp;
afterEach(() => app?.stop());

async function start(options: Record<string, unknown> = {}): Promise<FakeApp> {
  app = await FakeApp.start({ dir, main: "src/main.ts", answers: { "app.theme": THEME }, options });
  return app;
}

/** One of the package's own directories, which the fake app makes for it. */
function directory(which: "config" | "state" | "cache"): string {
  return app.init.paths![which];
}

/** The SVG files the package has written, with what is in them. */
function painted(): { at: string; svg: string }[] {
  const cache = directory("cache");
  return readdirSync(cache)
    .sort()
    .map((name) => ({ at: join(cache, name), svg: readFileSync(join(cache, name), "utf8") }));
}

test("render answers Pele's own SVG, with its kind and its size", async () => {
  await start();
  const answer = await app.serve("local.marmaide.render", "flowchart LR\n  ask[the question] --> draw{marmaide}");
  expect(answer.type).toBe("flowchart");
  expect(answer.width).toBeGreaterThan(100);
  expect(answer.svg).toContain("<text");
  // Pele's own variables, so the file themes wherever it lands…
  expect(answer.svg).toContain("var(--pele-fg");
  // …and the generic family names, so no reader needs the face Pele measured it in.
  expect(answer.svg).toContain("sans-serif");
});

test("a diagram Pele cannot read says which line it could not", async () => {
  await start();
  const bad = app.serve("local.marmaide.render", "notadiagram\n  ???");
  await expect(bad).rejects.toThrow(/No diagram type detected/);
  const error = await bad.catch((err) => err);
  expect(error.kind).toBe("render");
});

test("draw opens a pane beside this one, titled by the kind of diagram", async () => {
  await start();
  app.answer("pane.current", 3);
  const answer = await app.serve("local.marmaide.draw", "sequenceDiagram\n  A->>B: hi");
  expect(answer.opened).toBe(true);
  expect(answer.type).toBe("sequence");
  const open = app.called("pane.open").at(-1)!;
  expect(open[0]).toBe("local.marmaide.diagram");
  expect(open[1]).toEqual({ source: "sequenceDiagram\n  A->>B: hi" });
  expect(open[2]).toEqual({ kind: "tiled", beside: 3, split: "right", size: "45%" });
  // The pane is titled by the diagram, drawn the app's way, and its source is the pane's own.
  const sets = app.called("option.set");
  expect(sets).toContainEqual(["title", "sequence", { pane: answer.pane }]);
  expect(sets).toContainEqual(["@icon", "package", { pane: answer.pane }]);
  expect(sets).toContainEqual(["local.marmaide.source", "sequenceDiagram\n  A->>B: hi", { pane: answer.pane, scope: "pane" }]);
});

test("draw with a pane redraws it in place", async () => {
  await start();
  const answer = await app.serve("local.marmaide.draw", { source: "flowchart LR\n  a --> b", pane: 7 });
  expect([answer.pane, answer.opened, answer.type]).toEqual([7, false, "flowchart"]);
  expect(app.called("pane.open")).toEqual([]);
  expect(app.called("option.set").at(-1)).toEqual(["local.marmaide.source", "flowchart LR\n  a --> b", { pane: 7, scope: "pane" }]);
});

test("draw reads the diagram from a file, and takes a title", async () => {
  await start();
  const file = join(directory("config"), "figure.mmd");
  writeFileSync(file, "stateDiagram-v2\n  [*] --> idle");
  const answer = await app.serve("local.marmaide.draw", { path: file, title: "How it works" });
  expect(answer.type).toBe("state");
  expect(app.called("option.set")).toContainEqual(["title", "How it works", { pane: answer.pane }]);
});

test("drawing nothing, and drawing a file that is not there, are said plainly", async () => {
  await start();
  await expect(app.serve("local.marmaide.draw", {})).rejects.toThrow(/give a diagram/);
  await expect(app.serve("local.marmaide.draw", { path: join(dir, "nope.mmd") })).rejects.toThrow(/nope\.mmd/);
});

test("the pane draws the app's colours: the picture is a file with every variable written out", async () => {
  await start();
  await app.serve("local.marmaide.draw", "flowchart LR\n  a --> b");
  const files = painted();
  expect(files.length).toBe(1);
  // usvg, which the app paints SVG with, knows no CSS custom properties: the theme's colours are
  // in the file itself, and no `var()` is left for it to trip over.
  expect(files[0]!.svg).not.toContain("var(");
  expect(files[0]!.svg).toContain("#1e1e1e");
  expect(files[0]!.svg).toContain("#c8c8c8");
  expect(files[0]!.svg).toContain('font-family="SF Pro Text"');
});

test("save writes Pele's own SVG where it is told, and answers where", async () => {
  await start();
  const out = join(mkdtempSync(join(tmpdir(), "marmaide-")), "docs", "flow.svg");
  const answer = await app.serve("local.marmaide.save", "flowchart LR\n  a --> b", out);
  expect(answer.path).toBe(out);
  expect(answer.type).toBe("flowchart");
  const written = readFileSync(out, "utf8");
  expect(written).toContain("var(--pele-fg");
  expect(written).toContain("<text");
});

test("save takes a table too, and takes the diagram from a file", async () => {
  await start();
  const source = join(directory("config"), "figure.mmd");
  writeFileSync(source, "graph TD\n  a --> b");
  const out = join(directory("config"), "figure.svg");
  const answer = await app.serve("local.marmaide.save", { path: source, out });
  expect(answer.type).toBe("flowchart");
  expect(readFileSync(out, "utf8")).toContain("<svg");
});

test("save refuses a picture file, and a call with no file to write", async () => {
  await start();
  await expect(app.serve("local.marmaide.save", "flowchart LR\n  a --> b", "flow.png")).rejects.toThrow(/rasteriser/);
  await expect(app.serve("local.marmaide.save", "flowchart LR\n  a --> b")).rejects.toThrow(/needs a file to write/);
});

test("the faces are the options', over the app's own", async () => {
  await start({ "font_size": 24, "font": "Lilex" });
  await app.serve("local.marmaide.draw", "flowchart LR\n  a --> b");
  const svg = painted()[0]!.svg;
  expect(svg).toContain("Lilex");
  expect(svg).toContain("24px");
});
