// What a diagram tab draws, in the window's React tree: the SVG the worker rendered, drawn by the
// window's own `<svg>` element in its own colours (`paint="image"`), fitted to the tab, moved and
// zoomed like a canvas — drag it with the mouse, scroll the wheel over it, and a double-click fits
// it again. The drawing itself is the worker's (`main.ts`, `picture.ts`,
// `pele.ts`); this asks it for the tab's picture, again whenever the source changes or the theme
// does, and holds only where the picture is looked at from.
import { useEffect, useState } from "react";
import { useMetrics, useTab, useTheme, type Metrics, type RendererProps, type Tokens } from "pumi";

import { drawn, type Shown } from "./main.ts";
import type { AppTheme } from "./palette.ts";

/** Room around the diagram, in points, when it is fitted. */
const MARGIN = 16;
/** How much one notch of the wheel changes the zoom. */
const WHEEL = 1.08;
/** A wheel's line, in points: a mouse wheel sends lines, a trackpad pixels. */
const LINE = 16;
/** A trackpad's points per notch: a swipe of this much zooms as far as one click of a wheel. */
const PRECISE = 80;
/** The zoom's ends. */
const NEAR = 0.2;
const FAR = 8;

/** A throw the tab cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`marmaide: ${err instanceof Error ? err.message : String(err)}`);
}

/** The app's colours as the worker draws a diagram in them: the window has the tokens, the SVG is
 * the worker's, so they go with every draw. */
function diagramTheme(t: Tokens, m: Metrics): AppTheme {
  return {
    colors: { editor: t.editor, surface_text: t.text, primary: t.accent },
    metrics: { radius_sm: m.radiusSmall },
  };
}

/** `value`, kept between `low` and `high`. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Where the picture may be moved to: it never leaves the room it is looked at in. A picture
 * smaller than that room sits in the middle of it, with nowhere to go. */
function keep(pan: [number, number], size: [number, number], box: [number, number]): [number, number] {
  const slack: [number, number] = [Math.max(0, (size[0] - box[0]) / 2), Math.max(0, (size[1] - box[1]) / 2)];
  return [clamp(pan[0], -slack[0], slack[0]), clamp(pan[1], -slack[1], slack[1])];
}

/** The `diagram` block: the picture, as big as the tab has room for, and where it is looked from. */
export function Diagram({ tab, block }: RendererProps) {
  const t = useTheme();
  const m = useMetrics();
  const each = useTab(tab.id);
  // Its block names its prefix (`pumi_dev.marmaide.diagram` is `pumi_dev.marmaide.`), which the
  // tab's own option starts with.
  const prefix = block.slice(0, block.lastIndexOf(".") + 1);
  const source = (each?.options ?? {})[`${prefix}source`];
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The room the picture has: the viewport's size, reported when it is first laid out and when it
   * changes. A picture is sized from it — the app's own `<img>` fit paints nothing for an SVG
   * larger than its box. */
  const [box, setBox] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [drag, setDrag] = useState<{ from: [number, number]; pan: [number, number] } | null>(null);

  // A new source, or a new theme, is a new picture: the diagram is drawn in the window's colours,
  // so the tokens go with the ask and a theme switch draws it again.
  const look = `${t.editor}|${t.text}|${t.accent}|${m.radiusSmall}`;
  useEffect(() => {
    let live = true;
    void drawn(tab.id, diagramTheme(t, m))
      .then((read) => {
        if (!live) return;
        if ("error" in read) {
          setError(read.error);
          setShown(null);
          return;
        }
        setError(null);
        setShown(read);
      })
      .catch(swallow);
    return () => {
      live = false;
    };
  }, [tab.id, typeof source === "string" ? source : "", look]);

  // A new picture is fitted and centred again.
  useEffect(() => {
    setZoom(1);
    setPan([0, 0]);
  }, [shown?.svg]);

  // Fitted: as big as the tab has room for, and never bigger than the diagram's own size.
  const fit =
    shown !== null && box[0] > 0 && box[1] > 0
      ? Math.min(1, Math.max(1, box[0] - 2 * MARGIN) / shown.width, Math.max(1, box[1] - 2 * MARGIN) / shown.height)
      : 1;
  const scale = Math.max(0.05, fit) * zoom;
  const width = shown !== null ? shown.width * scale : 0;
  const height = shown !== null ? shown.height * scale : 0;
  // The picture is drawn where it may be, not where a drag last put it: it never leaves the tab.
  const at = keep(pan, [width, height], box);
  const put = () => {
    setZoom(1);
    setPan([0, 0]);
  };

  return (
    <div
      onLayout={(e: any) => {
        const [w, h] = [e?.width ?? 0, e?.height ?? 0];
        if (w > 0 && h > 0) setBox((now) => (now[0] === w && now[1] === h ? now : [w, h]));
      }}
      onScroll={(e: any) => {
        if (shown === null) return;
        const [dx, dy] = [e?.deltaX ?? 0, e?.deltaY ?? 0];
        // A trackpad's sideways swipe moves the picture; it is not a zoom. Only a gesture that is
        // mostly up or down zooms, by the pixels it moved (a wheel's line counts as one notch).
        if (Math.abs(dx) > Math.abs(dy)) {
          setPan((now) => keep([now[0] - dx, now[1]], [width, height], box));
          return;
        }
        if (dy === 0) return;
        const notches = dy / (e?.precise === true ? PRECISE : LINE);
        setZoom((now) => clamp(now * WHEEL ** notches, NEAR, FAR));
      }}
      onMouseDown={(e: any) => {
        if (shown === null) return;
        setDrag({ from: [e?.x ?? 0, e?.y ?? 0], pan });
      }}
      onMouseMove={(e: any) => {
        if (drag === null) return;
        setPan(keep([drag.pan[0] + (e?.x ?? 0) - drag.from[0], drag.pan[1] + (e?.y ?? 0) - drag.from[1]], [width, height], box));
      }}
      onMouseUp={() => setDrag(null)}
      onDoubleClick={put}
      style={{
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        backgroundColor: t.editor,
        cursor: drag !== null ? "grabbing" : "grab",
      }}
    >
      {error !== null ? (
        <text style={{ padding: 16, fontSize: 12, color: t.muted, maxWidth: 560 }}>{error}</text>
      ) : shown !== null ? (
        <svg
          source={shown.svg}
          paint="image"
          style={{ position: "absolute", left: (box[0] - width) / 2 + at[0], top: (box[1] - height) / 2 + at[1], width, height }}
        />
      ) : (
        <text style={{ fontSize: 12, color: t.muted }}>drawing…</text>
      )}
    </div>
  );
}
