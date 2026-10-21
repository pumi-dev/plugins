// perf: how the app is doing, floating in a corner of the window. The app keeps the numbers
// (`app.perf`: its CPU and memory, its frames, each core plugin's calls, the busiest threads,
// sampled every second); this package draws them, as the app's own overlay did.
//
// The overlay is a float over the whole window (`relative: "client"`), pinned to a corner by its
// anchor so it stays there as the window changes size. It takes neither the keyboard nor the
// pointer, so the terminal under it goes on working, and it grows and shrinks with what it has to
// show by moving its own pane (`pane.setPlace`).
//
// What the numbers mean, and how the rows are laid out, is `report.ts`; where the float goes is
// `place.ts`.
import {
  call,
  command,
  div,
  key,
  menu,
  notify,
  on,
  option,
  pane,
  pkg,
  px,
  system,
  theme,
  token,
  View,
  view,
  type Color,
  type Disposer,
  type El,
  type Pane,
  type ViewContext,
} from "pumi";
import { place } from "./place.ts";
import {
  CHAR,
  EMPTY,
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
  reportOf,
  threadCells,
  uiLine,
  type Column,
  type Report,
  type Series,
} from "./report.ts";

/** The view's id (`amresyd.perf.overlay`). */
const VIEW = "overlay";
/** The app's function that answers with the numbers. */
const REPORT = "app.perf";
/** How often the numbers are read again, in milliseconds: the app samples itself once a second. */
const TICK_MS = 1000;
/** The key that toggles it, and the corner it floats in, when their options are empty. */
const DEFAULT_TRIGGER = "<D-M-p>";
const DEFAULT_CORNER = "NE";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What the overlay's pane is opened with: the height it was already placed at. */
interface OverlayArgs {
  height?: number;
}

// ---------------------------------------------------------------- the view

export class Overlay extends View<OverlayArgs> {
  /** What the app last said of itself, and the height it last placed its pane at. */
  private report: Report = EMPTY;
  private height: number;
  /** The font its tables line up in. */
  private family = "monospace";

  constructor(cx: ViewContext<OverlayArgs>) {
    super(cx);
    this.height = cx.args?.height ?? heightOf(EMPTY);
    // The numbers again, every second, for as long as the view is open.
    const timer = setInterval(() => void this.refresh(), TICK_MS);
    cx.own(() => clearInterval(timer));
    void this.start();
  }

  private async start(): Promise<void> {
    this.family = await monoFamily();
    await this.refresh();
  }

  /** Read the numbers again, and be as tall as what they show. */
  private async refresh(): Promise<void> {
    this.report = await read();
    const height = heightOf(this.report);
    if (height !== this.height) {
      this.height = height;
      try {
        await pane.setPlace(this.cx.pane, place(height, await corner()));
      } catch (err) {
        console.error(`perf: ${message(err)}`);
      }
    }
    this.cx.notify();
  }

  render(): El {
    const report = this.report;
    const list = div()
      .flex()
      .flexCol()
      .gap(px(GAP))
      .child(line().textColor(theme.surface_text).fontWeight(600).child("performance"))
      .child(line().child(div().textColor(tone(load(report.cpu.avg10s / 2))).child(appLine(report))).child(graph(report.cpu)))
      .child(line().textColor(theme.muted).child(memoryLine(report)))
      .child(line().child(div().textColor(tone(load(report.ui.avg10s))).child(uiLine(report))).child(graph(report.ui)))
      .child(spacer())
      .child(heading(EXTENSIONS));
    for (const extension of report.extensions) {
      list.child(row(EXTENSIONS, extensionCells(extension), graph(extension.cpu), tone(level(extension))));
    }
    if (report.extensions.length === 0) {
      list.child(line().textColor(theme.placeholder).child("no extension has run yet"));
    }
    if (report.threads.length > 0) {
      list.child(spacer()).child(heading(THREADS));
      for (const thread of report.threads) {
        list.child(row(THREADS, threadCells(thread), graph(thread.cpu), tone(load(thread.cpu.avg10s))));
      }
    }
    if (report.samples === 0) {
      list.child(line().textColor(theme.placeholder).child("the first sample is a second away"));
    }
    return div()
      .class("perf")
      .sizeFull()
      .overflowHidden()
      .p(px(PAD))
      .bg(token("surface", 0.92))
      .fontFamily(this.family)
      .textSize(px(FONT))
      .child(list);
  }
}

/** How loud a row is drawn. */
function tone(loudness: ReturnType<typeof load>): Color {
  switch (loudness) {
    case "off":
      return theme.placeholder;
    case "quiet":
      return theme.muted;
    case "busy":
      return theme.warning;
    case "hot":
      return theme.error;
  }
}

/** A row of the overlay: one line high, its text unbroken. */
function line(): El {
  return div().flex().flexRow().flexNone().h(px(LINE)).lineHeight(px(LINE)).whitespaceNowrap();
}

function spacer(): El {
  return div().flexNone().h(px(SPACER));
}

/** The last minute of `series` as block characters. */
function graph(series: Series): El {
  return div().textColor(theme.primary).child(graphLine(series));
}

/** One table row: its cells in their columns, then its graph. */
function row(columns: readonly Column[], cells: string[], graph: El | null, tone: Color): El {
  const at = line().textColor(tone);
  columns.forEach(([, width], i) => {
    if (i >= cells.length) return; // the graph's column is drawn apart
    at.child(div().flexNone().w(px(width * CHAR)).overflowHidden().child(cells[i]!));
  });
  if (graph) at.child(graph);
  return at;
}

function heading(columns: readonly Column[]): El {
  return row(
    columns,
    columns.map(([name]) => name),
    null,
    theme.placeholder,
  );
}

// ---------------------------------------------------------------- reading it

/** The report now, or an empty one when the app does not answer (a build without it). */
async function read(): Promise<Report> {
  try {
    return reportOf(await call(REPORT));
  } catch (err) {
    console.error(`perf: ${REPORT}: ${message(err)}`);
    return EMPTY;
  }
}

/** `name`'s text: the option when it is a non-empty string, else `fallback`. */
async function textOption(name: string, fallback: string): Promise<string> {
  try {
    const value = await option.get(name);
    return typeof value === "string" && value !== "" ? value : fallback;
  } catch (err) {
    console.error(`perf: ${message(err)}`);
    return fallback;
  }
}

/** `corner`: the corner of the window it floats in. */
function corner(): Promise<string> {
  return textOption("corner", DEFAULT_CORNER);
}

/** The terminal's font (`guifont`, `JetBrains_Mono:h14`) when one is set, else the system's
 * monospace: the tables line up only in a font whose glyphs all take the same width. */
async function monoFamily(): Promise<string> {
  const family = (await textOption("guifont", "")).split(":")[0]!.trim().replace(/_/g, " ");
  if (family !== "") return family;
  try {
    return (await system.platform())?.os === "macos" ? "Menlo" : "monospace";
  } catch {
    return "monospace";
  }
}

// ---------------------------------------------------------------- opening it

/** The overlays open now. */
async function openPanes(): Promise<Pane[]> {
  try {
    return (await pane.list({ type: pkg.prefixed(VIEW) })) ?? [];
  } catch (err) {
    console.error(`perf: ${message(err)}`);
    return [];
  }
}

/** Shows it, or takes it away; whether it is shown now. */
async function toggle(): Promise<boolean> {
  const open = await openPanes();
  if (open.length > 0) {
    for (const overlay of open) await pane.close(overlay, true).catch(() => {});
    return false;
  }
  const height = heightOf(await read());
  try {
    await pane.open(pkg.prefixed(VIEW), { height }, place(height, await corner()));
    return true;
  } catch (err) {
    await notify(`perf: ${message(err)}`, "error");
    return false;
  }
}

/** An open overlay moves to the corner the option says now. */
async function replace(): Promise<void> {
  for (const overlay of await openPanes()) {
    try {
      await pane.setPlace(overlay, place(heightOf(await read()), await corner()));
    } catch (err) {
      console.error(`perf: ${message(err)}`);
    }
  }
}

/** The trigger last bound in the global key table, so the next one can unbind it. */
let bound: { trigger: string; mapping: Disposer } | null = null;

/** Bind `trigger` in the global key table, and unbind the last one. */
async function bind(): Promise<void> {
  const trigger = await textOption("trigger", DEFAULT_TRIGGER);
  if (bound?.trigger === trigger) return;
  bound?.mapping();
  bound = null;
  const mapping = key.set("global", trigger, () => void toggle(), { desc: "Toggle the performance overlay" });
  mapping.ready.catch((err: unknown) => console.error(`perf: ${message(err)}`));
  bound = { trigger, mapping };
}

view(VIEW, Overlay);
command("toggle", () => toggle());
menu.add(
  "View.Performance Overlay",
  { call: pkg.prefixed("toggle") },
  { desc: "How the app is doing: CPU, memory, frames, core plugins, threads." },
);
void bind();
on("option.changed", { match: pkg.prefixed("*"), desc: "perf follows its options" }, () => {
  void bind();
  void replace();
});
