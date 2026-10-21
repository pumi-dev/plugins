// What a pane draws: Pele's drawing, in the app's colours, written out as the SVG file the app's
// own renderer paints at whatever size the pane gives it — the Rust rasterised the same SVG with
// resvg inside the component, which a Bun worker has no way to do.
//
// The file is named by what is in it (its colours included), so a redrawn diagram is a new file:
// the app keeps the image it loaded by name, and a new name is what tells it there is a new
// picture. The cache directory is the package's own, and one that can be made again.
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "pumi";
import { faces } from "./faces.ts";
import { nodes, type Node } from "./nodes.ts";
import { appTheme, palette } from "./palette.ts";
import { draw, themed } from "./pele.ts";

/** A diagram, drawn and dressed, ready to show or hand out. */
export interface Picture {
  /** Mermaid's own name for the kind of diagram. */
  kind: string;
  /** The diagram's own size, in points. */
  width: number;
  height: number;
  /** Pele's own SVG: themeable wherever it is put. */
  raw: string;
  /** Where the app draws it: the themed SVG, a file of the package's cache. */
  file: string;
  /** The diagram's nodes, for a click on one. */
  nodes: Node[];
}

/** `source` drawn by Pele, in the app's colours, and written where the app can paint it. */
export async function picture(source: string): Promise<Picture> {
  const theme = await appTheme();
  const set = await faces(theme);
  const laid = draw(source, set);
  // The nodes come from Pele's own SVG: what `themed()` does to it is write colours and faces
  // where variables were, and the shapes stay where Pele put them.
  return {
    kind: laid.kind,
    width: laid.width,
    height: laid.height,
    raw: laid.raw,
    file: written(themed(laid.svg, palette(theme, set).vars)),
    nodes: nodes(laid.svg),
  };
}

/** The SVG written in the package's cache, named by what is in it, and where it went. */
export function written(svg: string): string {
  const name = createHash("sha1").update(svg).digest("hex").slice(0, 20);
  const file = join(paths.cache, `${name}.svg`);
  if (!existsSync(file)) writeFileSync(file, svg);
  return file;
}
