//! Pele's half of marmaide: Mermaid text in, SVG out, as JSON lines.
//!
//! The plugin (`ui/src/render.rs`) runs this with `bun` or `node`, writes one request on
//! stdin and reads one answer on stdout:
//!
//!   {"source": "flowchart LR …", "fontFamily": "IBM Plex Sans", "vars": {"--pele-fg": "#ccc"}}
//!   {"svg": "<svg …>", "raw": "<svg …>", "type": "flowchart", "width": 555, "height": 103}
//!
//! `raw` is Pele's own SVG, CSS variables and all — what `marmaide render` hands an agent, so
//! it themes wherever it lands. `svg` has every `var(--pele-…, fallback)` resolved to the
//! plugin's theme colours, because the rasteriser in the plugin (`usvg`) has no CSS custom
//! properties: without this pass a diagram would come out black-on-nothing.

import { render } from "./vendor/pele.js";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const VAR = /var\(\s*(--[\w-]+|--_[\w-]+)\s*(?:,\s*([^()]*?)\s*)?\)/g;

/// Every `--name: value` a style attribute defines, resolved in dependency order.
function definitions(svg) {
  const found = new Map();
  for (const match of svg.matchAll(/(--[\w-]+)\s*:\s*([^;"]+)/g)) {
    found.set(match[1], match[2].trim());
  }
  return found;
}

function resolve(value, vars, defs, depth = 0) {
  if (depth > 8) return value;
  return value.replace(VAR, (_, name, fallback) => {
    if (vars[name]) return vars[name];
    const def = defs.get(name);
    if (def !== undefined) return resolve(def, vars, defs, depth + 1);
    if (fallback !== undefined) return resolve(fallback, vars, defs, depth + 1);
    return fallback ?? "";
  });
}

/// Replaces every `var()` with a colour, a length or a font name, so a rasteriser that knows
/// no CSS custom properties paints what a browser would.
///
/// The face is also written onto every text element: `usvg` inherits `font-family` from the root
/// `style` attribute only sometimes, and a text element it cannot name a face for is a text
/// element it drops.
export function themed(svg, vars = {}) {
  const family = vars["--pele-font"] || "sans-serif";
  const defs = definitions(svg);
  // The definitions themselves: `--_fg:var(--pele-fg,#1f1f1f)` becomes `--_fg:#c8c8c8`, so
  // the aliases Pele's elements use (`var(--_fg)`) land on the theme too.
  let out = svg.replace(/(--[\w-]+)\s*:\s*(var\([^)]*\))/g, (whole, name, value) =>
    `${name}:${resolve(value, vars, defs)}`,
  );
  out = resolve(out, vars, definitions(out));
  // `font: 16px sans-serif` is a shorthand `usvg` does not read: say the two things it does.
  out = out.replace(/font:\s*([\d.]+px)\s+[^;"']+/g, (_whole, size) => `font-size:${size};font-family:${family}`);
  out = out.replace(/<text\b/g, `<text font-family="${family}"`);
  out = out.replace(/<tspan\b/g, `<tspan font-family="${family}"`);
  // A stray `var(--_x)` that no definition answered would leave an attribute empty; nothing
  // to do about it but let it be empty rather than the literal text.
  return out;
}

/// The faces a diagram is set in, where the plugin can read them.
///
/// The package's own directory is a symlink, and the plugin runs in WASI, which will not follow
/// one: so Pele's driver (this file, running natively) copies the fonts into the plugin's data
/// directory and answers where they are. They go in the rasteriser's database there.
function fonts(request) {
  const data = request.dataDir;
  if (!data) return [];
  const from = join(here, "vendor", "fonts");
  if (!existsSync(from)) return [];
  const to = join(data, "fonts");
  if (!existsSync(to)) mkdirSync(to, { recursive: true });
  const out = [];
  for (const name of readdirSync(from)) {
    if (!name.endsWith(".ttf") && !name.endsWith(".otf")) continue;
    const source = join(from, name);
    const target = join(to, name);
    try {
      if (!existsSync(target) || statSync(target).size !== statSync(source).size) {
        copyFileSync(source, target);
      }
      out.push(target);
    } catch {
      // A data directory that cannot be written is the plugin's to report: it draws without
      // these, in whatever face it has.
    }
  }
  return out;
}

function answer(request) {
  const source = String(request.source ?? "").trim();
  if (!source) return { error: { kind: "invalid_params", message: "no diagram source" } };
  const options = { fontFamily: request.fontFamily, fontFamilyMono: request.fontFamilyMono };
  if (request.fontSize) options.fontSize = request.fontSize;
  if (request.maxWidth) options.maxWidth = request.maxWidth;
  if (request.padding !== undefined) options.padding = request.padding;
  let made;
  try {
    made = render(source, options);
  } catch (error) {
    return { error: { kind: "render", message: String(error?.message ?? error) } };
  }
  const vars = {};
  for (const [name, value] of Object.entries(request.vars ?? {})) {
    vars[name.startsWith("--") ? name : `--${name}`] = String(value);
  }
  const fontFamily = request.fontFamily || "sans-serif";
  const fontFamilyMono = request.fontFamilyMono || "monospace";
  // A file themes wherever it is put: its family is the generic name, whatever face Pele
  // measured it in here.
  const raw = made.svg
    .replaceAll(fontFamily, "sans-serif")
    .replaceAll(fontFamilyMono, "monospace");
  const files = fonts(request);
  return {
    svg: themed(made.svg, vars),
    raw,
    fonts: files,
    type: made.type,
    width: made.width,
    height: made.height,
    links: (made.links ?? []).map((link) => link.href),
  };
}

/// One request per line in, one answer per line out. A line that is not JSON is Mermaid
/// source, which is the shape a shell pipe wants (`echo 'flowchart LR…' | marmaide svg`).
function request(line, all) {
  const text = line.trim();
  if (!text) return null;
  if (!text.startsWith("{")) return all ? { source: all } : { source: text };
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "string" ? { source: parsed } : parsed;
  } catch {
    return { source: text };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    // `bun render.mjs '{"source": "…"}'`, or `bun render.mjs <<< mermaid` on stdin only.
    const one = request(argv.join(" "), null);
    if (one) process.stdout.write(`${JSON.stringify(answer(one))}\n`);
    return;
  }
  const input = await new Response(process.stdin).text();
  const lines = input.split("\n").filter((line) => line.trim() !== "");
  if (lines.length <= 1) {
    const one = request(lines[0] ?? "", input);
    if (one) process.stdout.write(`${JSON.stringify(answer(one))}\n`);
    return;
  }
  // Several lines that are not requests are one diagram, split across lines.
  if (!lines.every((line) => line.trim().startsWith("{"))) {
    process.stdout.write(`${JSON.stringify(answer({ source: input }))}\n`);
    return;
  }
  for (const line of lines) {
    const one = request(line, null);
    if (one) process.stdout.write(`${JSON.stringify(answer(one))}\n`);
  }
}

main();
