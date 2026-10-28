import { describe, expect, test } from "bun:test";
import { EditorSelection } from "../src/codemirror.ts";
import { copied, cut, dragRange, move, paste, remove, selectNextOccurrence } from "../src/editor/commands.ts";
import { inputProps, mapWindow, rangeOf, replaceAround, typedSpec, windowFor } from "../src/editor/input.ts";
import { lineRuns, signature, treeUpTo, withComposition } from "../src/editor/highlight.ts";
import { actionFor, chord } from "../src/editor/keys.ts";
import { languageFor } from "../src/editor/languages.ts";
import { columnAt, expandTabs, offsetAt } from "../src/editor/layout.ts";
import { caretBoxes, posAt, reveal, selectionBoxes } from "../src/editor/geometry.ts";
import { createState, detectIndent, perform, typeText } from "../src/editor/state.ts";
import { colorsFrom, contrast } from "../src/editor/colors.ts";
import manifest from "../package.json";

const grid = { pageRows: 10 };
const config = { tabSize: 4, spaces: true };

function at(doc: string, anchor: number, head = anchor, path = "a.txt") {
  const state = createState(doc, path, config);
  return state.update({ selection: EditorSelection.single(anchor, head) }).state;
}
const apply = (state: ReturnType<typeof at>, spec: any) => state.update(spec).state;

describe("layout", () => {
  test("tabs reach the next stop and wide characters take two cells", () => {
    expect(columnAt("\tab", 1, 4)).toBe(4);
    expect(columnAt("ab\tc", 3, 4)).toBe(4);
    expect(columnAt("日本x", 2, 4)).toBe(4);
    expect(expandTabs("a\tb", 0, 4)).toBe("a   b");
  });
  test("a column lands on the nearest character edge", () => {
    expect(offsetAt("hello", 2.4, 4)).toBe(2);
    expect(offsetAt("hello", 2.6, 4)).toBe(3);
    expect(offsetAt("\tx", 1, 4)).toBe(0);
    expect(offsetAt("\tx", 3, 4)).toBe(1);
    expect(offsetAt("ab", 99, 4)).toBe(2);
  });
});

describe("moves", () => {
  test("by word, over spaces then one kind of character", () => {
    let s = at("foo.bar  baz", 0);
    s = apply(s, move(s, "word", true, false, grid));
    expect(s.selection.main.head).toBe(3);
    s = apply(s, move(s, "word", true, false, grid));
    expect(s.selection.main.head).toBe(4);
    s = apply(s, move(s, "word", true, false, grid));
    expect(s.selection.main.head).toBe(7);
    s = apply(s, move(s, "word", false, false, grid));
    expect(s.selection.main.head).toBe(4);
  });
  test("a vertical move keeps its column across a short line", () => {
    let s = at("abcdef\nab\nabcdef", 5);
    s = apply(s, move(s, "line", true, false, grid));
    expect(s.selection.main.head).toBe(9);
    s = apply(s, move(s, "line", true, false, grid));
    expect(s.selection.main.head).toBe(15);
  });
  test("home goes to the first non-blank, then to the start", () => {
    let s = at("    x", 5);
    s = apply(s, move(s, "lineEdge", false, false, grid));
    expect(s.selection.main.head).toBe(4);
    s = apply(s, move(s, "lineEdge", false, false, grid));
    expect(s.selection.main.head).toBe(0);
  });
  test("an unextended move collapses a selection to its side", () => {
    let s = at("hello", 1, 4);
    s = apply(s, move(s, "char", false, false, grid));
    expect(s.selection.main.head).toBe(1);
  });
});

describe("editing", () => {
  test("backspace in indentation takes back an indent unit", () => {
    const doc = "a\n    b\n        c\n";
    let s = at(`${doc}      x`, doc.length + 6);
    s = apply(s, remove(s, "char", false)!);
    expect(s.doc.toString()).toBe(`${doc}    x`);
  });
  test("brackets close themselves, and backspace takes the pair", () => {
    let s = at("", 0, 0, "a.ts");
    s = apply(s, typeText(s, "(")!);
    expect(s.doc.toString()).toBe("()");
    s = apply(s, perform(s, { t: "delete", unit: "char", forward: false }, grid)!);
    expect(s.doc.toString()).toBe("");
  });
  test("enter indents inside a block", () => {
    let s = at("function f() {}", 14, 14, "a.ts");
    s = apply(s, perform(s, { t: "newline" }, grid)!);
    expect(s.doc.toString()).toBe("function f() {\n    \n}");
  });
  test("an accent replaces the letter just typed", () => {
    let s = at("cafe", 4);
    s = apply(s, replaceAround(s, 1, 0, "é")!);
    expect(s.doc.toString()).toBe("café");
    expect(s.selection.main.head).toBe(4);
  });
  test("undo takes back what was typed", () => {
    let s = at("", 0);
    s = apply(s, typeText(s, "x")!);
    s = apply(s, perform(s, { t: "undo" }, grid)!);
    expect(s.doc.toString()).toBe("");
  });
  test("cmd-d selects the word, then adds its next match", () => {
    let s = at("foo bar foo", 1);
    s = apply(s, selectNextOccurrence(s)!);
    expect(s.sliceDoc(s.selection.main.from, s.selection.main.to)).toBe("foo");
    s = apply(s, selectNextOccurrence(s)!);
    expect(s.selection.ranges.map((r) => [r.from, r.to])).toEqual([[0, 3], [8, 11]]);
    s = apply(s, typeText(s, "x")!);
    expect(s.doc.toString()).toBe("x bar x");
  });
  test("copy with nothing selected takes the line; cut removes it", () => {
    const s = at("one\ntwo", 5);
    expect(copied(s)).toEqual({ text: "two\n", lines: true });
    expect(apply(s, cut(s)!).doc.toString()).toBe("one");
  });
  test("a paste of as many lines as carets gives one to each", () => {
    let s = at("a\nb", 1);
    s = apply(s, { selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]) });
    s = apply(s, paste(s, "1\n2")!);
    expect(s.doc.toString()).toBe("a1\nb2");
  });
  test("a drag from a double press grows by words", () => {
    const s = at("alpha beta gamma", 0);
    const range = dragRange(s, s.wordAt(7)!, 13, 2);
    expect([range.from, range.to]).toEqual([6, 16]);
  });
});

describe("geometry", () => {
  const m = { lineHeight: 10, charWidth: 5, padding: 8 };
  const vp = { top: 0, left: 0, width: 200, height: 100 };
  test("a point is the position under it", () => {
    const s = at("abc\n\tdef", 0);
    expect(posAt(s, 8 + 6, 2, vp, m)).toBe(1);
    expect(posAt(s, 8 + 21, 12, vp, m)).toBe(5);
    expect(posAt(s, 0, 500, vp, m)).toBe(s.doc.length);
  });
  test("carets and selections are boxes on the grid", () => {
    const s = at("abc\ndef", 1, 6);
    expect(caretBoxes(s, 1, 2, m)).toEqual([{ x: 10, y: 10, width: 2, height: 10, main: true }]);
    expect(selectionBoxes(s, 1, 2, m)).toEqual([
      { x: 5, y: 0, width: 15, height: 10 },
      { x: 0, y: 10, width: 10, height: 10 },
    ]);
  });
  test("the view scrolls only as far as it must to show the caret", () => {
    const s = at("x\n".repeat(100), 150);
    expect(reveal(s, vp, m).top).toBe(680);
    expect(reveal(s, { ...vp, height: 0 }, m).top).toBe(0);
  });
});

describe("highlighting", () => {
  test("a line is cut into runs of classes, with its gaps as plain text", () => {
    const s = createState("const x = 1 // c\nlet y", "a.ts", config);
    const { tree } = treeUpTo(s, s.doc.length, 1000);
    const [first, second] = lineRuns(s, tree, 1, 2);
    expect(first.map((r) => r.text).join("")).toBe("const x = 1 // c");
    expect(first[0]).toEqual({ text: "const", cls: "keyword" });
    expect(first.find((r) => r.text === "1")?.cls).toBe("number");
    expect(first.at(-1)).toEqual({ text: "// c", cls: "comment" });
    expect(second[0].cls).toBe("keyword");
    expect(signature(first)).not.toBe(signature(second));
  });
});

describe("keys", () => {
  test("a keystroke is a chord in one order", () => {
    expect(chord({ key: "Left", modifiers: { shift: true, alt: true } })).toBe("alt+shift+left");
    expect(chord({ key: "slash", modifiers: { cmd: true } })).toBe("cmd+/");
    expect(actionFor({ key: "x" })).toBeUndefined();
    expect(actionFor({ key: "backspace" })).toEqual({ t: "delete", unit: "char", forward: false });
  });
});

describe("files", () => {
  test("the indentation a file uses is what it gets", () => {
    expect(detectIndent("a\n  b\n    c\n  d")).toEqual({ spaces: true, size: 2 });
    expect(detectIndent("a\n\tb\n\t\tc")).toEqual({ spaces: false, size: 0 });
    expect(detectIndent("a\nb")).toBeNull();
  });
  test("the manifest's renderer draws every file; one with no language is plain text", () => {
    const globs = (manifest as any).pumi.contributes.renderers.file.match as string[];
    expect(globs).toEqual(["*"]);
    expect(languageFor("Cargo.lock")).toEqual([]);
  });
});

describe("text input", () => {
  test("the window is the main selection's lines, and stays put while typing", () => {
    let s = at("one\ntwo three\nfour", 8);
    const w = windowFor(s, null);
    expect(inputProps(s, w)).toEqual({ text: "two three", selection: [4, 4] });
    // Typed at the caret it was given: at every caret, as typing does.
    const tr = s.update(typedSpec(s, w, rangeOf(w, 4, 4), "x") as any);
    s = tr.state;
    const mapped = mapWindow(w, tr.changes);
    expect(windowFor(s, mapped).from).toBe(w.from);
    expect(inputProps(s, windowFor(s, mapped))).toEqual({ text: "two xthree", selection: [5, 5] });
  });
  test("a bracket typed closes itself, and the caret the element was left with still reads as the selection", () => {
    let s = at("f", 1, 1, "a.ts");
    const w = windowFor(s, null);
    s = apply(s, typedSpec(s, w, rangeOf(w, 1, 1), "("));
    expect(s.doc.toString()).toBe("f()");
  });
  test("an accent replaces the letter before every caret; a fixed word, that word alone", () => {
    let s = createState("cafe\ncafe", "a.txt", config);
    s = s.update({ selection: EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(9)]) }).state;
    let w = windowFor(s, null);
    s = apply(s, typedSpec(s, w, rangeOf(w, 3, 4), "é"));
    expect(s.doc.toString()).toBe("café\ncafé");
    s = at("teh cat", 7);
    w = windowFor(s, null);
    s = apply(s, typedSpec(s, w, rangeOf(w, 0, 3), "the"));
    expect(s.doc.toString()).toBe("the cat");
    expect(s.selection.main.head).toBe(7);
  });
  test("a long selection is given as its head, and typing still replaces it", () => {
    const doc = "x".repeat(40000);
    let s = at(doc, 0, 40000);
    const w = windowFor(s, null);
    expect(inputProps(s, w).selection).toEqual([2048, 2048]);
    s = apply(s, typedSpec(s, w, rangeOf(w, 2048, 2048), "y"));
    expect(s.doc.toString()).toBe("y");
  });
  test("a composition is drawn in its line where it will go", () => {
    const runs = [{ text: "ab", cls: "" as const }, { text: "cd", cls: "keyword" as const }];
    expect(withComposition(runs, 1, 3, "に").map((r) => r.text)).toEqual(["a", "に", "d"]);
    expect(withComposition(runs, 4, 4, "に").map((r) => r.text)).toEqual(["ab", "cd", "に"]);
    expect(signature(withComposition(runs, 2, 2, "x"))).not.toBe(signature([...runs.slice(0, 1), { text: "x", cls: "" }, runs[1]]));
  });
});

describe("colours", () => {
  const tokens = { surface: "#1e1e1e", text: "#d4d4d4", muted: "#808080", selected: "#264f78", accent: "#569cd6", error: "#f44747", success: "#6a9955", warning: "#d7ba7d" };
  const palette = (selection: string) => ({ background: "#1e1e1e", foreground: "#d4d4d4", selection, cursor: "#ffffff", ansi: [] });
  test("a light terminal selection is laid thin, so the code stays readable on it", () => {
    expect(colorsFrom(palette("#e0e0e0"), tokens).selection).toBe("#e0e0e040");
    expect(colorsFrom(palette("#264f78"), tokens).selection).toBe("#264f78");
    expect(contrast("#264f78", "#d4d4d4")).toBeGreaterThan(3);
  });
});
