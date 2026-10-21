// What this package asks of the vendored Pele (`vendor/pele.js`): its renderer, and the shape of
// what it answers. The rest of its exports (`mount`, `register`, `detectType`, …) are Pele's own.
/** How a diagram is laid out: the faces it is measured in, its size, and its room. */
export interface RenderOptions {
  fontFamily?: string;
  fontFamilyMono?: string;
  fontSize?: number;
  maxWidth?: number;
  padding?: number;
}
/** A link Pele drew in the diagram. */
export interface Link {
  href: string;
}
/** What Pele drew: the SVG with its `var(--pele-*)` variables in it, the kind of diagram, its size. */
export interface Made {
  svg: string;
  type: string;
  width: number;
  height: number;
  links?: Link[];
}
export function render(source: string, options?: RenderOptions): Made;
