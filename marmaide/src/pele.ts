// Pele — kepano's Mermaid renderer, the small synchronous one Obsidian draws with — from npm
// (`pele`), run by this package's own worker. The Rust package could not run it: a component was
// wasm, so it started `render.mjs` under a `bun` or `node` it had to find on the machine, one
// process per drawing. Bun runs Pele itself, in the same worker.
//
// Two shapes of one drawing come out of here: `raw`, Pele's own SVG with its `--pele-*` variables
// and the generic family names, which is what `render` and `save` hand out (a page, a browser or
// any theme resolves them); and `themed()`, the same SVG with every `var()` written out as a
// colour, which is what the app's own SVG renderer paints — usvg knows no CSS custom properties.
import { render } from "pele";
import { fail, message } from "./errors.ts";

/** The families a diagram is set in when none is named: Pele's own generic ones. */
export const FALLBACK_FONT = "sans-serif";
export const FALLBACK_MONO = "monospace";
/** The size Pele lays a diagram out at without one said. */
const FALLBACK_SIZE = 16;

/** The faces a diagram is measured in. */
export interface Faces {
  /** The text's family. */
  font: string;
  /** Code and constants. */
  mono: string;
  /** The size it is laid out at, in points. */
  size: number;
}

/** What Pele drew. */
export interface Drawn {
  /** Pele's own SVG: `var(--pele-*)`, and the families it was measured in. */
  svg: string;
  /** The same, set in `sans-serif` and `monospace`: a file themes wherever it is put. */
  raw: string;
  /** Mermaid's own name for the kind of diagram (`flowchart`, `sequenceDiagram`, …). */
  kind: string;
  /** The diagram's own size, in points. */
  width: number;
  height: number;
}

/**
 * `source` drawn by Pele, laid out in `faces`. Throws a `render` error whose message is Pele's
 * own — which line of the Mermaid it could not read — so a caller can say what to fix.
 */
export function draw(source: string, faces: Partial<Faces> = {}): Drawn {
  const font = named(faces.font) ?? FALLBACK_FONT;
  const mono = named(faces.mono) ?? FALLBACK_MONO;
  const size = typeof faces.size === "number" && Number.isFinite(faces.size) ? faces.size : FALLBACK_SIZE;
  let made;
  try {
    made = render(source, { fontFamily: font, fontFamilyMono: mono, fontSize: size });
  } catch (err) {
    throw fail("render", message(err));
  }
  return {
    svg: made.svg,
    raw: made.svg.replaceAll(font, FALLBACK_FONT).replaceAll(mono, FALLBACK_MONO),
    kind: made.type,
    width: made.width,
    height: made.height,
  };
}

/** Every `var(--name, fallback)` in a value. */
const VAR = /var\(\s*(--[\w-]+|--_[\w-]+)\s*(?:,\s*([^()]*?)\s*)?\)/g;

/** Every `--name: value` the SVG defines, wherever it defines it. */
export function definitions(svg: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of svg.matchAll(/(--[\w-]+)\s*:\s*([^;"]+)/g)) found.set(match[1]!, match[2]!.trim());
  return found;
}

/** A value with its `var()`s replaced: what it names, in the order that wins. */
export function resolve(value: string, vars: Record<string, string>, defs: Map<string, string>, depth = 0): string {
  if (depth > 8) return value;
  return value.replace(VAR, (_whole, name: string, fallback?: string) => {
    if (vars[name]) return vars[name];
    const defined = defs.get(name);
    if (defined !== undefined) return resolve(defined, vars, defs, depth + 1);
    if (fallback !== undefined) return resolve(fallback, vars, defs, depth + 1);
    return "";
  });
}

/**
 * `svg` with every `var()` written out — a colour, a length or a font name — so a rasteriser that
 * knows no CSS custom properties paints what a browser would. The face is written onto every text
 * element too: usvg inherits `font-family` from the root `style` only sometimes, and a text element
 * it cannot name a face for is a text element it drops.
 */
export function themed(svg: string, vars: Record<string, string> = {}): string {
  const family = vars["--pele-font"] || FALLBACK_FONT;
  const defs = definitions(svg);
  // The definitions themselves: `--_fg:var(--pele-fg,#1f1f1f)` becomes `--_fg:#c8c8c8`, so the
  // aliases Pele's elements use (`var(--_fg)`) land on the theme too.
  let out = svg.replace(
    /(--[\w-]+)\s*:\s*(var\([^)]*\))/g,
    (_whole, name: string, value: string) => `${name}:${resolve(value, vars, defs)}`,
  );
  out = resolve(out, vars, definitions(out));
  // `font: 16px sans-serif` is a shorthand usvg does not read: say the two things it does.
  out = out.replace(/font:\s*([\d.]+px)\s+[^;"']+/g, (_whole, size: string) => `font-size:${size};font-family:${family}`);
  out = out.replace(/<text\b/g, `<text font-family="${family}"`);
  out = out.replace(/<tspan\b/g, `<tspan font-family="${family}"`);
  return out;
}

/** `text` with its edges trimmed, or nothing when it is empty. */
function named(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}
