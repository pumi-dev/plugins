// Where the overlay floats: over the whole window (`relative: "client"`), in a corner, as wide as
// its table and as tall as what it shows. It is kept clear of the header at the top and the status
// bar at the bottom, takes neither the keyboard nor the pointer, and opening it does not make it
// the current pane.
import type { PanePlace } from "pumi";

import { width } from "./report.ts";

/** How far in from the top edge, from the bottom edge, and from the side, in pixels. */
export const TOP = 44;
export const BOTTOM = 32;
export const SIDE = 12;

export function place(height: number, corner: string): PanePlace {
  const row = corner.startsWith("S") ? BOTTOM : TOP;
  return {
    kind: "float",
    relative: "client",
    // The `corner` option is any string; a corner the API does not know is refused by the server.
    anchor: corner as PanePlace["anchor"],
    row: `${row}px`,
    col: `${SIDE}px`,
    width: `${width()}px`,
    height: `${height}px`,
    focusable: false,
    mouse: false,
    zIndex: 90,
    focus: false,
  };
}
