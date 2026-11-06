// What a tab shows: Pele's drawing, dressed in the app's colours, as the SVG markup the window's
// own `<svg paint="image">` element draws — gpui parses it with resvg and rasters it at the size the
// element is given, drawing it again when that size changes (a zoom), so it is sharp at any size
// and nothing is written to disk.
import { faces } from "./faces.ts";
import { palette, type AppTheme } from "./palette.ts";
import { draw, themed } from "./pele.ts";

/** A diagram, drawn and dressed, ready to show or hand out. */
export interface Picture {
  /** Mermaid's own name for the kind of diagram. */
  kind: string;
  /** The diagram's own size, in points. */
  width: number;
  height: number;
  /** The SVG the window draws: Pele's own, every colour written out. */
  svg: string;
}

/**
 * `source` drawn by Pele, in the app's colours. `theme` is the window's (`ui.tsx` passes what
 * `useTheme()` and `useMetrics()` say); without one — a call from elsewhere, like `render` — the
 * diagram is Pele's own light one.
 */
export async function picture(source: string, theme: AppTheme | null = null): Promise<Picture> {
  const set = await faces(theme);
  const laid = draw(source, set);
  return { kind: laid.kind, width: laid.width, height: laid.height, svg: themed(laid.svg, palette(theme, set).vars) };
}
