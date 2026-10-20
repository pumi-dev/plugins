// How wide the columns are, and how a drag moves a divider: numbers, tested without drawing.
import { describe, expect, test } from "bun:test";

import { MAX_COLUMN, MIN_COLUMN, naturalWidths, planWidths, resizeWidths } from "../src/layout.ts";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("naturalWidths", () => {
  test("is bounded by the column's longest value, and never narrower than the minimum", () => {
    const widths = naturalWidths(["id", "name"], [["1", "a very long name indeed"]], [true, false]);
    expect(widths.length).toBe(2);
    expect(widths[0]).toBe(MIN_COLUMN);
    expect(widths[1]!).toBeGreaterThan(MIN_COLUMN);
  });

  test("a long value does not ask for a column wider than the maximum", () => {
    const [width] = naturalWidths(["x"], [["x".repeat(5000)]], [false]);
    expect(width).toBe(MAX_COLUMN);
  });

  test("a column of numbers asks for room for its arrow", () => {
    const [text] = naturalWidths(["price"], [["12345678"]], [false]);
    const [number] = naturalWidths(["price"], [["12345678"]], [true]);
    expect(number!).toBeGreaterThan(text!);
  });
});

describe("planWidths", () => {
  test("shares room to spare, and adds up to exactly the room", () => {
    const plan = planWidths([100, 200, 300], 1200);
    expect(plan.overflow).toBe(false);
    expect(sum(plan.widths)).toBe(1200);
    // In proportion: the wider column got more of what was left over.
    expect(plan.widths[2]!).toBeGreaterThan(plan.widths[0]!);
  });

  test("too little room: the columns keep the widths their contents ask for, and the table scrolls", () => {
    const plan = planWidths([300, 300, 300, 300], 400);
    expect(plan.overflow).toBe(true);
    expect(plan.widths).toEqual([300, 300, 300, 300]);
    expect(plan.total).toBe(1200);
  });

  test("squeezed (fit): width is taken back down to the minimum, and the pane is still filled", () => {
    const plan = planWidths([300, 300, 300, 300], 400, { fit: true });
    expect(plan.overflow).toBe(false);
    expect(sum(plan.widths)).toBe(400);
    for (const width of plan.widths) expect(width).toBeGreaterThanOrEqual(MIN_COLUMN);
  });

  test("squeezed (fit) but too many columns for the minimum: they keep their widths and scroll", () => {
    const plan = planWidths([200, 200, 200, 200, 200], 150, { fit: true, min: MIN_COLUMN });
    expect(plan.overflow).toBe(true);
    expect(sum(plan.widths)).toBeGreaterThan(150);
    for (const width of plan.widths) expect(width).toBeGreaterThanOrEqual(MIN_COLUMN);
  });

  test("one column takes the whole pane", () => {
    expect(planWidths([80], 500).widths).toEqual([500]);
  });

  test("no columns is no room", () => {
    expect(planWidths([], 500)).toEqual({ widths: [], total: 0, overflow: false });
  });
});

describe("resizeWidths", () => {
  test("moves width from the column on the right to the one on the left", () => {
    expect(resizeWidths([100, 100, 100], 0, 20)).toEqual([120, 80, 100]);
    expect(resizeWidths([100, 100, 100], 1, -20)).toEqual([100, 80, 120]);
  });

  test("stops at the minimum", () => {
    expect(resizeWidths([100, 100], 0, 500)).toEqual([100 + 100 - MIN_COLUMN, MIN_COLUMN]);
    expect(resizeWidths([100, 100], 0, -500)).toEqual([MIN_COLUMN, 200 - MIN_COLUMN]);
  });

  test("leaves the total alone", () => {
    const before = [90, 200, 60];
    const after = resizeWidths(before, 1, 15);
    expect(sum(after)).toBe(sum(before));
  });

  test("the last column has no divider after it", () => {
    expect(resizeWidths([100, 100], 1, 20)).toEqual([100, 100]);
  });
});
