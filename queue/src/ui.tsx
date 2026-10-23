// What the queue draws, in the window's React tree: a bar under every pane that waits for
// something — the job that matters in a line, and the rest in the order they will run, each a press
// away from its pane and a `✕` away from the queue. The jobs are the worker's (`bar`), looked at on
// a clock the queue itself sets the pace of: twice a second while it has work, now and then when it
// has none.
import { useEffect, useRef, useState } from "react";
import { call, useInterval, useMetrics, useTheme, type Ref } from "pumi";

import { bar, cancel, look, running, type BarRow } from "./main.ts";

/** A row of the bar, in pixels: a winbar's row is 24. */
const ROW = 24;

/** A throw the bar cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`queue: ${err instanceof Error ? err.message : String(err)}`);
}

/** The `pane.strip` slot's view: the queue's jobs for `pane`, or nothing at all. */
export function Bar({ pane }: { pane: Ref }) {
  const t = useTheme();
  const m = useMetrics();
  const owner = pane.id;
  const [rows, setRows] = useState<BarRow[]>([]);
  const [work, setWork] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Looks at the panes the queue waits for, then reads the bar again. */
  const tick = () => {
    void look()
      .then(() => {
        if (!alive.current) return;
        setRows(bar(owner));
        setWork(running());
      })
      .catch(swallow);
  };

  useEffect(() => {
    tick();
  }, [owner]);
  // The clock: twice a second while there is work, and now and then when there is none.
  useInterval(tick, work ? 500 : 2_000);

  if (rows.length === 0) return null;
  const now = Date.now();
  const first = rows.find((row) => row.kind === "running") ?? rows[0]!;
  const behind = rows.length - 1;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: ROW, gap: 8, paddingLeft: 10, paddingRight: 10, overflow: "hidden" }}>
      <text style={{ fontSize: 10.5, color: tint(t, first), flexShrink: 0 }}>{glyphOf(first)}</text>
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
        <text style={{ fontSize: 11, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{first.label}</text>
      </div>
      {behind > 0 ? <text style={{ fontSize: 10, color: t.muted, flexShrink: 0 }}>{`+${behind}`}</text> : null}
      <text style={{ fontSize: 10, color: t.muted, flexShrink: 0 }}>{first.said}</text>
      {first.waiting ? (
        <div
          aria-label="Cancel this job"
          onClick={(e: any) => {
            e?.stopPropagation?.();
            void cancel(first.id).then(tick).catch(swallow);
          }}
          style={{ display: "flex", flexShrink: 0, paddingLeft: 4, paddingRight: 4, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.border } }}
        >
          <text style={{ fontSize: 10, color: t.muted }}>✕</text>
        </div>
      ) : null}
      {first.target !== null ? (
        <div
          aria-label="Go to the pane this job is in"
          onClick={() => void call("pane.select", { pane: first.target }).catch(swallow)}
          style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}
        >
          <text style={{ fontSize: 10, color: t.muted }}>→</text>
        </div>
      ) : null}
      {rows.length > 1 ? (
        <text style={{ fontSize: 10, color: t.faint, flexShrink: 0 }}>{`${rows.filter((row) => row.kind !== "running" && row.kind !== "waiting").length} over`}</text>
      ) : null}
    </div>
  );
}

/** A job's glyph, by what its state is. */
function glyphOf(row: BarRow): string {
  switch (row.kind) {
    case "running":
      return "▶";
    case "waiting":
      return "·";
    case "done":
      return row.status === 0 ? "✓" : "✗";
    case "failed":
      return "✗";
    default:
      return "×";
  }
}

/** What a job is drawn in: its state's colour, from the theme. */
function tint(t: ReturnType<typeof useTheme>, row: BarRow): string {
  switch (row.kind) {
    case "running":
      return t.accent;
    case "waiting":
      return t.faint;
    case "done":
      return row.status === 0 ? t.success : t.error;
    case "failed":
      return t.error;
    default:
      return t.faint;
  }
}
