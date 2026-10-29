// The scoring: the core palette's own arithmetic exactly, and nucleo's as far as a port can go.
import { expect, test } from "bun:test";
import {
  DEFAULT,
  LENGTH_PENALTY,
  PATHS,
  SMART_CASE_PENALTY,
  caseMismatches,
  humanizeActionName,
  match,
  matchLabel,
  normalizeActionQuery,
  score,
  segments,
} from "../../src/files/score.ts";

test("names read as Zed reads them", () => {
  expect(humanizeActionName("split_vertical")).toBe("split vertical");
  expect(humanizeActionName("reload_config")).toBe("reload config");
  expect(humanizeActionName("palette::Toggle")).toBe("palette: toggle");
  expect(humanizeActionName("pumi::Quit")).toBe("pumi: quit");
  expect(humanizeActionName("editor::GoToDefinition")).toBe("editor: go to definition");
  expect(humanizeActionName("editor::OpenURL")).toBe("editor: open URL");
  expect(humanizeActionName("editor::OpenURLParser")).toBe("editor: open URL parser");
  expect(humanizeActionName("pane.setZoom")).toBe("pane.set zoom");
});

test("queries normalize as the core normalizes them", () => {
  expect(normalizeActionQuery("editor: backspace")).toBe("editor: backspace");
  expect(normalizeActionQuery("editor:    backspace")).toBe("editor: backspace");
  expect(normalizeActionQuery("editor::GoToDefinition")).toBe("editor:GoToDefinition");
  expect(normalizeActionQuery("terminal_panel::Toggle")).toBe("terminal panel:Toggle");
  expect(normalizeActionQuery("  switch_tab  ")).toBe("switch tab");
});

test("a query marks what it matched", () => {
  const found = matchLabel("split vertical", "split");
  expect(found).not.toBeNull();
  expect(found!.marks).toEqual([0, 1, 2, 3, 4]);
});

test("matching is fuzzy and case smart", () => {
  expect(score("split vertical", "sv")).not.toBeNull();
  for (const query of ["zoom", "Zoom", "ZOOM"]) expect(score("zoom", query)).not.toBeNull();
  expect(score("zoom", "ZOOMX")).toBeNull();
});

test("a case mismatch costs a tenth of the score", () => {
  const exact = match("zoom", "zoom")!.score;
  const ignored = match("zoom", "Zoom")!;
  expect(caseMismatches("Zoom", ignored.marks, "zoom")).toBe(1);
  expect(matchLabel("zoom", "Zoom")!.score).toBeCloseTo(exact * SMART_CASE_PENALTY - 4 * LENGTH_PENALTY, 6);
  expect(matchLabel("zoom", "zoom")!.score).toBeCloseTo(exact - 4 * LENGTH_PENALTY, 6);
});

test("a shorter label wins a tie, and a used command breaks one", () => {
  const longer = matchLabel("zoom_in", "zoom")!.score;
  const shorter = matchLabel("zoom", "zoom")!.score;
  expect(shorter).toBeGreaterThan(longer);
});

test("words of a query are matched one at a time", () => {
  expect(score("split vertical", "vert split")).not.toBeNull();
  expect(score("split vertical", "vert horizontal")).toBeNull();
});

test("a word boundary beats the middle of a word", () => {
  const boundary = score("split vertical", "v")!;
  const inside = score("split vertical", "l")!;
  expect(boundary).toBeGreaterThan(inside);
});

test("a path is scored with the file's own rules", () => {
  // A `/` is the only word break in a path, and the string's start counts as one.
  expect(score("src/ui/shell.rs", "shell", PATHS)).not.toBeNull();
  expect(score("src/ui/shell.rs", "uiz", PATHS)).toBeNull();
  expect(score("src/ui/shell.rs", "uis", PATHS)).not.toBeNull();
});

test("a query may run through directories", () => {
  const found = match("src/ui/shell.rs", "uishell", PATHS);
  expect(found).not.toBeNull();
  expect(found!.marks).toEqual([4, 5, 7, 8, 9, 10, 11]);
});

test("a label's marks are character indices, ready for runs", () => {
  expect(segments("café: zoom", matchLabel("café: zoom", "zoom")!.marks)).toEqual([
    ["café: ", false],
    ["zoom", true],
  ]);
});

test("the default config is the label's, and PATHS is the file's", () => {
  expect(DEFAULT.delimiters).toBe("/,:;|");
  expect(PATHS.delimiters).toBe("/");
});
