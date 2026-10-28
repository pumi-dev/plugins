// What is picked and what a copy of it holds, with no app running.
import { describe, expect, test } from "bun:test";

import { blockOf, copied, delimited, isRange, moved, placesOf, rowsOf, tsv } from "../src/select.ts";

const data = [
  ["1", "a", "x"],
  ["2", "b", "y"],
  ["3", "c", "z"],
];

describe("blocks", () => {
  test("run between the anchor and the focus in the order shown, either way round", () => {
    // Shown sorted the other way: the file's row 2 is first.
    const order = [2, 1, 0];
    const places = placesOf(order, 3);
    const block = blockOf({ anchor: { row: 0, column: 2 }, focus: { row: 1, column: 1 } }, places, 3);
    expect(block).toEqual({ top: 1, bottom: 2, left: 1, right: 2 });
    expect(rowsOf(block!, order)).toEqual([1, 0]);
    expect(isRange(block)).toBe(true);
  });

  test("an anchor a search hides leaves the focus alone; a hidden focus picks nothing", () => {
    const places = placesOf([1], 3);
    expect(blockOf({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 2 } }, places, 3)).toEqual({ top: 0, bottom: 0, left: 2, right: 2 });
    expect(blockOf({ anchor: { row: 1, column: 0 }, focus: { row: 2, column: 0 } }, places, 3)).toBeNull();
  });

  test("a column taken out under the focus pulls it back to the last one", () => {
    expect(blockOf({ anchor: { row: 0, column: 5 }, focus: { row: 0, column: 5 } }, placesOf([0], 1), 2)).toEqual({ top: 0, bottom: 0, left: 1, right: 1 });
  });
});

describe("moving", () => {
  const sizes = { rows: 10, columns: 3, page: 4 };
  test("by one, by a page, and to the edge, never past it", () => {
    expect(moved({ place: 0, column: 0 }, "up", sizes)).toEqual({ place: 0, column: 0 });
    expect(moved({ place: 0, column: 0 }, "down", sizes)).toEqual({ place: 1, column: 0 });
    expect(moved({ place: 0, column: 2 }, "right", sizes)).toEqual({ place: 0, column: 2 });
    expect(moved({ place: 8, column: 0 }, "pagedown", sizes)).toEqual({ place: 9, column: 0 });
    expect(moved({ place: 3, column: 1 }, "down", sizes, true)).toEqual({ place: 9, column: 1 });
    expect(moved({ place: 3, column: 1 }, "home", sizes)).toEqual({ place: 3, column: 0 });
    expect(moved({ place: 3, column: 1 }, "x", sizes)).toBeNull();
  });
});

describe("copying", () => {
  test("one cell is its value as it is; more are tab-separated, quoted where they must be", () => {
    const order = [0, 1, 2];
    expect(copied({ top: 1, bottom: 1, left: 1, right: 1 }, order, data)).toBe("b");
    expect(copied({ top: 0, bottom: 1, left: 0, right: 1 }, order, data)).toBe("1\ta\n2\tb");
    expect(tsv([["a\tb", 'say "hi"', "two\nlines"]])).toBe('"a\tb"\t"say ""hi"""\t"two\nlines"');
    expect(copied({ top: 0, bottom: 0, left: 0, right: 0 }, order, [["two\nlines"]])).toBe("two\nlines");
  });

  test("rows are copied the way the file writes them", () => {
    expect(delimited([["1", "a, b"], ["2", "c"]], ",")).toBe('1,"a, b"\n2,c');
  });
});
