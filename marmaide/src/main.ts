// marmaide: a Mermaid diagram in a pumi tab, drawn by Pele (https://pele.run) — kepano's small
// synchronous Mermaid renderer, the one Obsidian draws with.
//
//   pumi call pumi_dev.marmaide.draw 'flowchart LR
//     ask --> draw --> look'                      # a tab beside this one; answers its id
//   pumi call pumi_dev.marmaide.draw '{"path": "figure.mmd", "tab": "%7"}'   # redraw tab %7
//   pumi call pumi_dev.marmaide.render '{"path": "figure.mmd"}' | jq -r .svg
//
// There are two functions. `draw` is the tab: it writes the Mermaid into the tab's `source` option,
// which the tab's own view reads, so a redraw is one option set and the diagram comes back with a
// restored layout. `render` is the same drawing as Pele's own SVG — its `--pele-*` variables and
// all, so it themes wherever it is put — and shows nothing.
import { readFileSync } from "node:fs";
import { ApiError, fn, option, self, workspace, type TabId } from "pumi";
import { faces } from "./faces.ts";
import type { AppTheme } from "./palette.ts";
import { draw } from "./pele.ts";
import { picture } from "./picture.ts";

/** The block a diagram is: `pumi_dev.marmaide.diagram`, drawn by `ui.tsx`'s `Diagram`. */
const BLOCK = self.plugin.prefixed("diagram");
/** The tab option a diagram's source lives in: `pumi_dev.marmaide.source`. */
const SOURCE = self.plugin.prefixed("source");

/** What a call is about: a diagram, and where to put it. */
interface Args {
  /** The Mermaid text. */
  source?: string;
  /** A file to read it from. */
  path?: string;
  /** The tab to draw in, instead of a new one. */
  tab?: unknown;
  /** The new tab's title; the kind of diagram without. */
  title?: string;
  /** Where the new tab goes, as any tab's place. */
  place?: unknown;
}

/** A diagram as `ui.tsx` draws it: where the file is, and how big the diagram is. */
export interface Shown {
  /** The Mermaid text it was drawn from. */
  source: string;
  /** Mermaid's own name for the kind of diagram. */
  kind: string;
  width: number;
  height: number;
  /** The themed SVG, which the tab's `<svg>` element draws. */
  svg: string;
}

/** A value as a table of arguments, or nothing when it is not one. */
function table(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A call's arguments: the Mermaid text (or a table of them), then a table of the rest. */
function argsOf(first: unknown, second: unknown): Args {
  const rest = table(second) as Args;
  if (typeof first === "string") return { source: first, ...rest };
  return { ...(table(first) as Args), ...rest };
}

/** The Mermaid text a call is about: `source`, or a `path` to read it from. */
function sourceOf(args: Args): string {
  if (typeof args.source === "string" && args.source.trim() !== "") return args.source;
  const path = typeof args.path === "string" && args.path !== "" ? args.path : undefined;
  if (path === undefined) throw new ApiError("invalid_params", "give a diagram: `source` (Mermaid text) or `path`");
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new ApiError("not_found", `${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The tab a call names — `%7`, `7`, or `{ tab: "%7" }` — or nothing. */
function tabOf(value: unknown): TabId | null {
  const named = typeof value === "object" && value !== null ? (value as { tab?: unknown }).tab : value;
  if (typeof named === "number" && Number.isInteger(named) && named > 0) return `%${named}`;
  if (typeof named !== "string" || named.trim() === "") return null;
  const text = named.trim();
  if (/^%\d+$/.test(text)) return text;
  if (/^\d+$/.test(text)) return `%${text}`;
  throw new ApiError("invalid_params", `not a tab: ${text}`);
}

/** The place a call gives a new tab, when it is one. */
function placeOf(value: unknown): Record<string, unknown> | null {
  const place = table(value);
  return typeof place.kind === "string" ? place : null;
}

/**
 * Shows a diagram: opens a tab of this plugin's block beside the caller's, or redraws the tab `tab`
 * names. Answers where it is and what kind of diagram it is.
 */
async function shown(first: unknown, second: unknown) {
  const args = argsOf(first, second);
  const source = sourceOf(args);
  const drawn = await picture(source);
  const target = tabOf(args.tab);
  const size = { type: drawn.kind, width: drawn.width, height: drawn.height };
  if (target !== null) {
    await option.set("source", source, { scope: "tab", id: target });
    return { tab: target, ...size, opened: false };
  }
  const place = placeOf(args.place) ?? { kind: "tiled", split: "right", size: "45%" };
  const tab = await workspace.openTab(BLOCK, { [SOURCE]: source }, place);
  const title = typeof args.title === "string" && args.title !== "" ? args.title : drawn.kind;
  await tab.update({ title }).catch(() => {});
  return { tab: tab.id, ...size, opened: true };
}

/** Pele's own SVG for a diagram: its variables and all, so it themes wherever it is put. */
async function asSvg(first: unknown, second: unknown) {
  const laid = draw(sourceOf(argsOf(first, second)), await faces(null));
  return { svg: laid.svg, type: laid.kind, width: laid.width, height: laid.height };
}

/**
 * The diagram the tab `id` shows, drawn from its `source` option; or why it could not be. `theme`
 * is the window's, handed over by `ui.tsx`, so a diagram is drawn in the colours the window has
 * and drawn again when the theme changes.
 */
export async function drawn(id: TabId, theme: AppTheme | null = null): Promise<Shown | { error: string }> {
  let source = "";
  try {
    const value = await option.get("source", { scope: "tab", id });
    source = typeof value === "string" ? value : "";
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (source.trim() === "") {
    return { error: "no diagram yet: pumi call pumi_dev.marmaide.draw 'flowchart LR\n  a --> b'" };
  }
  try {
    const made = await picture(source, theme);
    return { source, kind: made.kind, width: made.width, height: made.height, svg: made.svg };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

fn.set(
  "draw",
  {
    desc: "Draw a Mermaid diagram: one opens beside this one, or the tab `tab` names is redrawn. Answers where it is.",
    effect: "write",
    parameters: [
      ["string", "source"],
      ["table", "opts"],
    ],
    returns: "The tab it drew in, the kind of diagram, its size, and whether it opened one.",
    examples: [
      { args: ["flowchart LR\n  ask --> draw --> look"], desc: "Show a flowchart beside this tab." },
      { args: [{ path: "diagram.mmd", tab: "%7" }], desc: "Redraw tab %7 with the Mermaid in a file." },
    ],
    notes: ["Any diagram Mermaid 12 has — flowchart, sequenceDiagram, classDiagram, erDiagram, gantt, pie, mindmap, timeline — is Pele's to draw."],
  },
  (first: unknown, second: unknown) => shown(first, second),
);

fn.set(
  "render",
  {
    desc: "A Mermaid diagram as SVG, CSS variables and all, for anywhere it goes. Nothing is shown.",
    effect: "read",
    parameters: [["string", "source"]],
    examples: [{ args: ["flowchart LR\n  a --> b"], desc: "Answers {svg, type, width, height}." }],
  },
  (first: unknown, second: unknown) => asSvg(first, second),
);
