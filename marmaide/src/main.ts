// marmaide: Mermaid diagrams in a pane, drawn by [Pele](https://pele.run) — kepano's renderer, the
// small synchronous one Obsidian draws with. Pele is JavaScript and this package is TypeScript, so
// it runs here, in the worker: the Rust package had to start `render.mjs` under a `bun` or `node`
// it found on the machine, one process per diagram, and this one calls the renderer.
//
// Everything an agent needs is a provided function — `marmaide.draw`, `marmaide.render`,
// `marmaide.save`, reachable as `pumi call <owner>.marmaide.draw …`:
//
// - `draw {source | path, pane?, title?, place?}` draws the diagram and shows it in a pane beside
//   this one, answering `{pane, type, width, height, opened}`. Called again with a `pane`, it
//   redraws that pane in place: the source is kept on the pane as the option `marmaide.source`, so
//   a layout that comes back after a restart draws its diagram again.
// - `render {source | path}` answers Pele's own SVG (its `--pele-*` variables and all: themeable
//   wherever it is put), with the diagram's kind and size.
// - `save {source | path, out}` writes that SVG to a file and answers its path.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { option, pane, pkg, provide } from "pumi";
import { agents as agentsOf, attach, type About, type Agent } from "./agents.ts";
import { fail, message } from "./errors.ts";
import type { Node } from "./nodes.ts";
import { picture } from "./picture.ts";

/** What a call is about: a diagram, and what to do with it. */
interface Args {
  /** The Mermaid text. */
  source?: string;
  /** A file to read it from. */
  path?: string;
  /** The pane to draw in, instead of a new one. */
  pane?: number;
  /** The new pane's title; the kind of diagram without. */
  title?: string;
  /** Where the new pane goes. */
  place?: Record<string, unknown>;
  /** `save`: the file to write. */
  out?: string;
}

/**
 * A call's arguments: a diagram's text (or a table of them) first, then a table of the rest — or a
 * string, which is the call's second parameter with the name `positional` gives it.
 */
function argsOf(first: unknown, second: unknown, positional?: keyof Args): Args {
  const table = (value: unknown): Args =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Args) : {};
  const rest: Args = typeof second === "string" && positional !== undefined ? { [positional]: second } : table(second);
  if (typeof first === "string") return { source: first, ...rest };
  return { ...table(first), ...rest };
}

/** The Mermaid text a call is about: `source`, or a `path` to read it from. */
function sourceOf(args: Args): string {
  if (typeof args.source === "string" && args.source.trim() !== "") return args.source;
  const path = typeof args.path === "string" && args.path !== "" ? args.path : undefined;
  if (path === undefined) throw fail("invalid_params", "give a diagram: `source` (Mermaid text) or `path`");
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw fail("not_found", `${path}: ${message(err)}`);
  }
}

/** The caller's pane, when it has one. */
async function here(): Promise<number | null> {
  try {
    const current = await pane.current();
    return typeof current?.id === "number" ? current.id : null;
  } catch {
    return null;
  }
}

/**
 * Shows a diagram: opens a pane of this package's view beside the caller's, or redraws the pane
 * `pane` names. Answers where it is and what kind of diagram it is.
 */
async function shown(first: unknown, second: unknown) {
  const args = argsOf(first, second);
  const source = sourceOf(args);
  const drawn = await picture(source);
  const target = typeof args.pane === "number" ? args.pane : null;
  let id = target;
  if (id === null) {
    const beside = await here();
    const asked = args.place;
    const place =
      asked !== null && typeof asked === "object" && !Array.isArray(asked)
        ? asked
        : { kind: "tiled", ...(beside === null ? {} : { beside }), split: "right", size: "45%" };
    const opened = await pane.open(pkg.prefixed("diagram"), { source }, place);
    id = opened.id;
    const title = typeof args.title === "string" && args.title !== "" ? args.title : drawn.kind;
    await option.set("title", title, { pane: id });
    await option.set("@icon", "package", { pane: id });
  }
  // The view of that pane reads this, now and after a restart; setting it is what tells it to
  // draw again.
  await option.set("source", source, { pane: id, scope: "pane" });
  return { pane: id, type: drawn.kind, width: drawn.width, height: drawn.height, opened: target === null };
}

/** Pele's own SVG for a diagram: its variables and all, so it themes wherever it is put. */
async function asSvg(first: unknown, second: unknown) {
  const drawn = await picture(sourceOf(argsOf(first, second)));
  return { svg: drawn.raw, type: drawn.kind, width: drawn.width, height: drawn.height };
}

/**
 * Writes a diagram's SVG — Pele's own, themeable anywhere — to a file, answering where it went.
 *
 * The file written is `out`; the shape this package has always had, `{source, path}`, writes its
 * `source` to `path`, so a caller that predates `out` still works. The app draws the diagram itself
 * as an SVG file too, but it cannot write its pixels out: a Bun worker has no rasteriser, and the
 * Rust package's was inside the component.
 */
async function saved(first: unknown, second: unknown) {
  const args = argsOf(first, second, "out");
  const source = sourceOf(args);
  const out = args.out ?? (args.source !== undefined ? args.path : undefined);
  if (typeof out !== "string" || out === "") {
    throw fail("invalid_params", "`save` needs a file to write: `out` (or `path`, with a `source`)");
  }
  if (!out.toLowerCase().endsWith(".svg")) {
    throw fail("invalid_params", "marmaide writes `.svg` (Pele's own, themeable anywhere): there is no rasteriser here for a picture file");
  }
  const directory = dirname(out);
  if (directory !== "" && directory !== ".") mkdirSync(directory, { recursive: true });
  const drawn = await picture(source);
  try {
    writeFileSync(out, drawn.raw);
  } catch (err) {
    throw fail("io", `${out}: ${message(err)}`);
  }
  return { path: out, type: drawn.kind, width: drawn.width, height: drawn.height };
}

// ---- what the view draws
//
// The pane's Mermaid source lives in the option `marmaide.source` (pane-scoped), so it is what
// `marmaide.draw` writes, what the view reads when it starts, and what brings a diagram back with a
// restored layout. A redraw is a new value of it: the view hears the change and draws again.

/** A diagram as `ui.tsx` draws it: the file the app paints, its size, and where its nodes are. */
export interface Shown {
  /** The Mermaid text it was drawn from. */
  source: string;
  /** Mermaid's own name for the kind of diagram. */
  kind: string;
  width: number;
  height: number;
  /** The themed SVG, a file of the package's cache. */
  file: string;
  nodes: Node[];
}

/** The diagram pane `id` shows, drawn from the source on its options; or why it could not be. */
export async function drawn(id: number): Promise<Shown | { error: string }> {
  let source = "";
  try {
    const value = await option.get("source", { pane: id });
    source = typeof value === "string" ? value : "";
  } catch (err) {
    return { error: message(err) };
  }
  if (source.trim() === "") return { error: "no diagram: `pumi call amresyd.marmaide.draw 'flowchart LR\n  a --> b'`" };
  try {
    const made = await picture(source);
    return { source, kind: made.kind, width: made.width, height: made.height, file: made.file, nodes: made.nodes };
  } catch (err) {
    return { error: message(err) };
  }
}

/** The agents a node clicked in the pane `here` can be sent to. */
export function agents(here: number): Promise<Agent[]> {
  return agentsOf(here);
}

/** The note about a clicked node, into an agent's inbox; answers what to tell the user. */
export function note(agent: Agent, about: About): Promise<string> {
  return attach(agent, about);
}

provide(
  pkg.prefixed("draw"),
  {
    desc: "Draw a Mermaid diagram in a pane: one opens beside this pane, or the one `pane` names is redrawn. Answers where it is.",
    effect: "write",
    parameters: [
      ["string", "source"],
      ["table", "opts"],
    ],
    examples: [
      { args: ["flowchart LR\n  ask --> draw --> look"], desc: "Show a flowchart beside this pane." },
      { args: [{ source: "sequenceDiagram\n  A->>B: hi", pane: 7 }], desc: "Redraw pane 7 with another diagram." },
      { args: [{ path: "diagram.mmd", title: "How it works" }], desc: "Draw the Mermaid in a file." },
    ],
    notes: [
      "Mermaid's flowchart, sequence, class, state, ER, gantt, pie, mindmap, timeline and the rest of Mermaid 12 are Pele's to draw.",
    ],
  },
  (first: unknown, second: unknown) => shown(first, second),
);

provide(
  pkg.prefixed("render"),
  {
    desc: "Pele's SVG for a Mermaid diagram: CSS variables and all, so it themes wherever it is put. Nothing is shown.",
    effect: "read",
    parameters: [["string", "source"]],
    examples: [{ args: ["flowchart LR\n  a --> b"], desc: "Answers {svg, type, width, height}." }],
  },
  (first: unknown, second: unknown) => asSvg(first, second),
);

provide(
  pkg.prefixed("save"),
  {
    desc: "Write a diagram's SVG to a file, answering its path: Pele's own, themeable anywhere.",
    effect: "write",
    parameters: [
      ["string", "source"],
      ["string", "out"],
    ],
    examples: [
      { args: ["flowchart LR\n  a --> b", "diagram.svg"] },
      { args: [{ source: "sequenceDiagram\n  A->>B: hi", out: "docs/diagram.svg" }] },
    ],
  },
  (first: unknown, second: unknown) => saved(first, second),
);
