// What the overlay draws, in the window's React tree: the app's own numbers as a little table, one
// line a second — the app's CPU and memory, its frames and what it spends drawing, each extension's
// calls and the busiest threads, each with the last minute beside it. The numbers are read by the
// worker (`report`), and the float is placed by it too; this only draws what it is given.
import { useEffect, useState } from "react";
import { call, num, useInterval, useTheme, type Tokens } from "pumi";

import { family, report } from "./main.ts";
import { place } from "./place.ts";
import {
  CHAR,
  EXTENSIONS,
  FONT,
  GAP,
  LINE,
  PAD,
  SPACER,
  THREADS,
  appLine,
  extensionCells,
  graphLine,
  heightOf,
  level,
  load,
  memoryLine,
  threadCells,
  uiLine,
  type Column,
  type Level,
  type Report,
  type Series,
} from "./report.ts";

/** A row of the overlay: one line high, its text unbroken. */
function Line({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", flexShrink: 0, height: LINE, lineHeight: LINE, whiteSpace: "nowrap", color: tone }}>
      {children}
    </div>
  );
}

/** The theme's colour for a row's loudness. */
function tone(t: Tokens, loudness: Level): string {
  switch (loudness) {
    case "off":
      return t.faint;
    case "quiet":
      return t.muted;
    case "busy":
      return t.warning;
    case "hot":
      return t.error;
  }
}

/** One table row: its cells in their columns, then its graph. */
function Row({ t, columns, cells, series, loudness }: { t: Tokens; columns: readonly Column[]; cells: string[]; series?: Series; loudness: Level }) {
  return (
    <Line tone={tone(t, loudness)}>
      {columns.map(([, width], i) =>
        i >= cells.length ? null : (
          <div key={i} style={{ display: "flex", flexShrink: 0, width: width * CHAR, overflow: "hidden" }}>
            <text style={{ fontSize: FONT }}>{cells[i]}</text>
          </div>
        ),
      )}
      {series ? <text style={{ fontSize: FONT, color: t.accent }}>{graphLine(series)}</text> : null}
    </Line>
  );
}

function Heading({ t, columns }: { t: Tokens; columns: readonly Column[] }) {
  return <Row t={t} columns={columns} cells={columns.map(([name]) => name)} loudness="off" />;
}

/** The overlay's own view: the table, as tall as what it shows. */
export function Overlay({ pane }: { pane: string }) {
  const t = useTheme();
  const [now, setNow] = useState<Report | undefined>(undefined);
  const [font, setFont] = useState("monospace");

  useEffect(() => {
    void family().then(setFont).catch(() => {});
  }, []);

  // The numbers again, every second, for as long as the view is open: the app samples itself once a
  // second, so a faster clock reads the same sample twice.
  useInterval(() => {
    void report()
      .then(async (read) => {
        setNow(read);
        // As tall as what it shows: the float's own pane is moved to keep its corner.
        await call("pane.setPlace", num(pane), place(heightOf(read), "NE")).catch(() => {});
      })
      .catch((err: unknown) => console.error(`perf: ${err instanceof Error ? err.message : String(err)}`));
  }, 1_000);

  if (!now) return null;
  const spacer = (key: string) => <div key={key} style={{ display: "flex", flexShrink: 0, height: SPACER }} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: GAP, width: "100%", height: "100%", overflow: "hidden", padding: PAD, backgroundColor: t.surface, fontFamily: font, fontSize: FONT, color: t.text }}>
      <Line tone={t.text}>
        <text style={{ fontSize: FONT, fontWeight: 600 }}>performance</text>
      </Line>
      <Line>
        <text style={{ fontSize: FONT, color: tone(t, load(now.cpu.avg10s / 2)) }}>{appLine(now)}</text>
        <text style={{ fontSize: FONT, color: t.accent, paddingLeft: 6 }}>{graphLine(now.cpu)}</text>
      </Line>
      <Line tone={t.muted}>
        <text style={{ fontSize: FONT }}>{memoryLine(now)}</text>
      </Line>
      <Line>
        <text style={{ fontSize: FONT, color: tone(t, load(now.ui.avg10s)) }}>{uiLine(now)}</text>
        <text style={{ fontSize: FONT, color: t.accent, paddingLeft: 6 }}>{graphLine(now.ui)}</text>
      </Line>
      {spacer("s1")}
      <Heading t={t} columns={EXTENSIONS} />
      {now.extensions.map((extension) => (
        <Row key={extension.name} t={t} columns={EXTENSIONS} cells={extensionCells(extension)} series={extension.cpu} loudness={level(extension)} />
      ))}
      {now.extensions.length === 0 ? (
        <Line tone={t.faint}>
          <text style={{ fontSize: FONT }}>no extension has run yet</text>
        </Line>
      ) : null}
      {now.threads.length > 0 ? spacer("s2") : null}
      {now.threads.length > 0 ? <Heading t={t} columns={THREADS} /> : null}
      {now.threads.map((thread) => (
        <Row key={thread.name} t={t} columns={THREADS} cells={threadCells(thread)} series={thread.cpu} loudness={load(thread.cpu.avg10s)} />
      ))}
      {now.samples === 0 ? (
        <Line tone={t.faint}>
          <text style={{ fontSize: FONT }}>the first sample is a second away</text>
        </Line>
      ) : null}
    </div>
  );
}
