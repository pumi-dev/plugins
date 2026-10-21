// Where the float goes: the corner the option names, the height the report needs, and neither the
// keyboard nor the pointer.
import { expect, test } from "bun:test";
import { BOTTOM, SIDE, TOP, place } from "../src/place.ts";
import { heightOf, EMPTY, width } from "../src/report.ts";

test("it floats over the whole window, in the corner it is given", () => {
  const ne = place(148, "NE");
  expect(ne).toEqual({
    kind: "float",
    relative: "client",
    anchor: "NE",
    row: `${TOP}px`,
    col: `${SIDE}px`,
    width: `${width()}px`,
    height: "148px",
    focusable: false,
    mouse: false,
    zindex: 90,
    focus: false,
  });
});

test("a bottom corner hangs from the status bar, a top one from the header", () => {
  expect(place(148, "SE").row).toBe(`${BOTTOM}px`);
  expect(place(148, "SW").row).toBe(`${BOTTOM}px`);
  expect(place(148, "NW").row).toBe(`${TOP}px`);
});

test("it is as tall as the report it shows", () => {
  expect(place(heightOf(EMPTY), "NE").height).toBe("148px");
});
