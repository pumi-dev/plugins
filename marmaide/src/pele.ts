// Pele — kepano's Mermaid renderer, the small synchronous one Obsidian draws with — from npm
// (`pele`): the plugin's worker resolves its own `node_modules`, so `bun install` is all it takes.
//
// Pele draws with CSS custom properties (`var(--pele-fg)` and the like), which the app's SVG
// renderer does not resolve. So a diagram comes out twice: `svg`, Pele's own, handed out by
// `render` and themeable anywhere; and `themed()`, the same with every `var()` written out as the
// colour it names, which is what the tab shows.
import { render } from "pele";

/** The families a diagram is set in when none is named. */
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
  /** Mermaid's own name for the kind of diagram (`flowchart`, `sequenceDiagram`, …). */
  kind: string;
  /** The diagram's own size, in points. */
  width: number;
  height: number;
}

/**
 * `source` drawn by Pele, laid out in `faces`. Throws Pele's own error — the line of the Mermaid it
 * could not read — which a caller hands on as its `render` error, so a user knows what to fix.
 */
export function draw(source: string, faces: Partial<Faces> = {}): Drawn {
  const font = named(faces.font) ?? FALLBACK_FONT;
  const mono = named(faces.mono) ?? FALLBACK_MONO;
  const size = typeof faces.size === "number" && Number.isFinite(faces.size) ? faces.size : FALLBACK_SIZE;
  const made = render(source, { fontFamily: font, fontFamilyMono: mono, fontSize: size });
  return { svg: made.svg, kind: made.type, width: made.width, height: made.height };
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
 * `svg` with every `var()` written out — a colour, a length or a font name — so a renderer that
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
