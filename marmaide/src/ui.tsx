// What a diagram pane draws, in the window's React tree: the SVG the worker rendered, fitted to the
// pane, and moved and zoomed like a canvas — drag it with the mouse, scroll the wheel over it, press
// `fit` to put it back. A click on a node asks for a note, which goes to an agent's inbox; the
// rendering, the nodes and the inbox are the worker's (`main.ts`, `picture.ts`, `agents.ts`).
import { useEffect, useState } from "react";
import { Icon, useMetrics, usePane, usePlugin, useTheme, type Metrics, type RendererProps, type Tokens } from "pumi";

import { agents as agentsOf, drawn, note, type Shown } from "./main.ts";
import type { Agent } from "./agents.ts";
import { at as nodeAt, type Node } from "./nodes.ts";
import type { AppTheme } from "./palette.ts";

/** Room around the diagram, in points. */
const PADDING = 12;
/** How much one press of + or − changes the zoom. */
const STEP = 1.25;
/** How much one notch of the wheel does: a trackpad's many small deltas add up to the same. */
const WHEEL = 1.06;
/** A wheel's line, in pixels: the app sends a scroll as pixels. */
const LINE = 16;
/** A press that moves less than this, in points, is a click, not a drag. */
const CLICK = 4;
/** The caption row's height, in points. */
const FOOTER = 26;

/** A throw the diagram cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`marmaide: ${err instanceof Error ? err.message : String(err)}`);
}

/** This plugin's options carry its prefix (`amresyd.marmaide.`), which is how the pane's own
 * `source` is named in the state the window reads. */
function usePrefix(): string {
  const id = usePlugin();
  return id === undefined ? "" : `${id.replace("/", ".").replaceAll("-", "_")}.`;
}

/** The app's colours as the worker draws a diagram in them: the window has the tokens, the SVG is
 * the worker's, so they go with every draw. */
function diagramTheme(t: Tokens, m: Metrics): AppTheme {
  return {
    colors: { editor: t.editor, surface_text: t.text, primary: t.accent },
    metrics: { radius_sm: m.radiusSmall },
  };
}

/** The `diagram` block: the picture, the zoom it is at, and the caption row under it. */
export function Diagram({ pane }: RendererProps) {
  const t = useTheme();
  const m = useMetrics();
  const owner = pane.id;
  const each = usePane(pane);
  const prefix = usePrefix();
  /** The source the pane's options say: a redraw is a new value of it. */
  const source = each?.options?.[`${prefix}source`] as string | undefined;
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [drag, setDrag] = useState<{ from: [number, number]; pan: [number, number]; moved: boolean } | null>(null);
  const [asking, setAsking] = useState<{ node: Node; to: Agent[]; text: string; said: string | null } | null>(null);

  // A new source, or a new theme, is a new picture: the diagram is drawn in the window's colours,
  // so the tokens go with the ask and a theme switch draws it again.
  useEffect(() => {
    let live = true;
    setShown(null);
    setError(null);
    void drawn(owner, diagramTheme(t, m))
      .then((read) => {
        if (!live) return;
        if ("error" in read) setError(read.error);
        else setShown(read);
      })
      .catch(swallow);
    return () => {
      live = false;
    };
  }, [owner, source, t, m]);

  /** Puts the diagram back where it came from: fitted, and centred enough to read. */
  const fit = () => {
    setZoom(1);
    setPan([0, 0]);
  };

  // A click on a node asks for a note about it, and who it can go to.
  const clicked = (x: number, y: number) => {
    if (!shown) return;
    const index = nodeAt(shown.nodes, x, y);
    if (index === null) return;
    const node = shown.nodes[index];
    if (!node) return;
    void agentsOf(owner)
      .then((to) => setAsking({ node, to, text: "", said: null }))
      .catch(swallow);
  };

  const title = shown ? shown.kind : error ? "diagram" : "drawing…";
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, minHeight: 0, backgroundColor: t.editor, color: t.text }}>
      <div
        onMouseDown={(e: any) => {
          if (!shown) return;
          const point: [number, number] = [e?.x ?? 0, e?.y ?? 0];
          setDrag({ from: point, pan, moved: false });
        }}
        onMouseMove={(e: any) => {
          if (!drag) return;
          const dx = (e?.x ?? 0) - drag.from[0];
          const dy = (e?.y ?? 0) - drag.from[1];
          if (Math.abs(dx) > CLICK || Math.abs(dy) > CLICK) setDrag({ ...drag, moved: true });
          setPan([drag.pan[0] + dx, drag.pan[1] + dy]);
        }}
        onMouseUp={() => {
          if (drag && !drag.moved) clicked(0, 0);
          setDrag(null);
        }}
        onScroll={(e: any) => {
          const dy = (e?.deltaY ?? 0) / (e?.precise ? 1 : LINE);
          setZoom((now) => Math.min(8, Math.max(0.2, now * WHEEL ** dy)));
        }}
        style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: drag ? "grabbing" : "grab", position: "relative" }}
      >
        {error ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 16, maxWidth: 560 }}>
            <text style={{ fontSize: 13, color: t.error }}>{error}</text>
            <text style={{ fontSize: 11, color: t.muted }}>{`pumi call amresyd.marmaide.draw 'flowchart LR\n  a --> b --> c'`}</text>
          </div>
        ) : null}
        {shown ? (
          <img
            src={shown.file}
            style={{
              position: "absolute",
              left: pan[0],
              top: pan[1],
              width: (shown.width + 2 * PADDING) * zoom,
              height: (shown.height + 2 * PADDING) * zoom,
            }}
          />
        ) : null}
        {asking ? (
          <div onClick={(e: any) => e?.stopPropagation?.()} style={{ position: "absolute", bottom: 12, left: 12, right: 12, display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}>
            <text style={{ fontSize: 12, color: t.text }}>{`${asking.node.label} (${asking.node.id})`}</text>
            <input
              value={asking.text}
              autoFocus
              placeholder="A note for the agent…"
              onChange={(e: any) => setAsking({ ...asking, text: e?.value ?? "" })}
              onSubmit={async (e: any) => {
                const first = asking.to[0];
                if (!first || !shown) return;
                const said = await note(first, { pane: owner, kind: shown.kind, source: shown.source, node: asking.node, note: e?.value ?? asking.text }).catch((err: unknown) => {
                  swallow(err);
                  return null;
                });
                setAsking(said === null ? null : { ...asking, said });
              }}
              style={{ display: "flex", height: 26, paddingLeft: 8, paddingRight: 8, fontSize: 12, color: t.text, borderRadius: m.radiusSmall }}
            />
            {asking.said ? <text style={{ fontSize: 11, color: t.success }}>{asking.said}</text> : null}
            {asking.to.length === 0 ? <text style={{ fontSize: 11, color: t.muted }}>No agent is running: `pumi call amresyd.marmaide.draw` needs none, but a note does.</text> : null}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: FOOTER, flexShrink: 0, paddingLeft: 10, paddingRight: 10, backgroundColor: t.surface, borderTopWidth: 1, borderColor: t.border }}>
        <text style={{ fontSize: 11, color: t.muted }}>{title}</text>
        {shown ? <text style={{ fontSize: 10, color: t.faint }}>{`${shown.width}×${shown.height} · ${shown.nodes.length} nodes`}</text> : null}
        <div style={{ flexGrow: 1 }} />
        <Button icon="square_minus" tip="Zoom out" on={() => setZoom((now) => Math.max(0.2, now / STEP))} />
        <text style={{ fontSize: 11, color: t.muted }}>{`${Math.round(zoom * 100)}%`}</text>
        <Button icon="square_plus" tip="Zoom in" on={() => setZoom((now) => Math.min(8, now * STEP))} />
        <Button icon="maximize" tip="Fit the pane" on={fit} />
      </div>
    </div>
  );
}

function Button({ icon, tip, on }: { icon: string; tip: string; on(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      aria-label={tip}
      onClick={(e: any) => {
        e?.stopPropagation?.();
        on();
      }}
      style={{ display: "flex", width: 20, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
    >
      <Icon name={icon} size={12} color={t.muted} />
    </div>
  );
}
