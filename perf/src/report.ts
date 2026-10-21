// What `app.perf` answers, read into what the overlay draws, and how it is laid out: plain data
// and arithmetic, so it is tested on its own.
//
// Each series the app sends has `now`, `avg_10s`, `avg_60s`, `peak_60s` and `last_60s` (one value
// a second, the last minute); durations are milliseconds.

/** How wide a graph is, in characters. */
export const GRAPH = 30;
/** A call still running after this long is shown as running. */
export const RUNNING_MS = 250;

/** One character of the overlay's monospace, in pixels (at `FONT`). */
export const CHAR = 7.2;
export const FONT = 12;
/** A row's height, the gap between rows, a spacer between sections, the padding inside. */
export const LINE = 16;
export const GAP = 2;
export const SPACER = 4;
export const PAD = 8;
/** The app's frame around a float: one pixel each side. */
export const FRAME = 2;
/** How many threads are worth a row. */
export const THREADS_SHOWN = 8;

/** A column of a table: its heading, and how many characters wide it is. */
export type Column = readonly [name: string, width: number];

/** The core plugins' table. The graph is drawn apart, past the last column. */
export const EXTENSIONS: readonly Column[] = [
  ["ext", 10],
  ["busy 10s", 9],
  ["cpu 10s", 8],
  ["cpu 60s", 8],
  ["call/s", 7],
  ["queue", 6],
  ["ui/s", 8],
  ["mem", 9],
  ["call", 22],
  ["cpu, last 60s", GRAPH + 1],
];
export const THREADS: readonly Column[] = [
  ["thread", 27],
  ["now", 8],
  ["10s", 8],
  ["60s", 8],
  ["peak", 8],
  ["", 18],
  ["cpu, last 60s", GRAPH + 1],
];

/** The thread the app counts CPU for that it has no thread of any more. */
export const EXITED = "exited threads";

/** One series of samples, a second apart. */
export interface Series {
  now: number;
  avg10s: number;
  avg60s: number;
  peak60s: number;
  last60s: number[];
}

export const NO_SERIES: Series = { now: 0, avg10s: 0, avg60s: 0, peak60s: 0, last60s: [] };

/** How loud a row is drawn. */
export type Level = "off" | "quiet" | "busy" | "hot";

/** A core plugin's row. */
export interface Extension {
  name: string;
  running: boolean;
  busy: Series;
  cpu: Series;
  calls: Series;
  uiMs: Series;
  queued: number;
  memory: number;
  /** The call it is in now, when it has been for a while, else its slowest. */
  call: string;
}

/** A thread's row: its name (and how many have it), and its CPU. */
export interface Thread {
  name: string;
  count: number;
  cpu: Series;
}

/** The whole report, as drawn. */
export interface Report {
  samples: number;
  cpu: Series;
  rss: number;
  threadsAlive: number;
  uptime: number;
  /** How much of each second the main thread spends drawing, and its frames a second. */
  ui: Series;
  fps: Series;
  frameAvgMs: number;
  frameMaxMs: number;
  /** Frames slower than 16.7 ms. */
  slow: number;
  extensions: Extension[];
  threads: Thread[];
}

// The wire's JSON is untyped: a field is not there, or not what it should be, as often as the app
// is older than this package.

/** A JSON object's fields; an empty object when the value is not one (an app older than this). */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function word(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function seriesOf(value: unknown): Series {
  const v = record(value);
  return {
    now: num(v["now"]),
    avg10s: num(v["avg_10s"]),
    avg60s: num(v["avg_60s"]),
    peak60s: num(v["peak_60s"]),
    last60s: items(v["last_60s"]).map(num),
  };
}

/** A share of a CPU, as a level: a tenth is busy, a half is hot. */
export function load(share: number): Level {
  if (share >= 50) return "hot";
  if (share >= 10) return "busy";
  return "quiet";
}

export function extensionOf(value: unknown): Extension {
  const v = record(value);
  const current = record(v["current"]);
  const elapsed = num(current["elapsed"]);
  let call = "";
  if (isRecord(v["current"]) && elapsed >= RUNNING_MS) {
    call = `▶ ${word(current["kind"], "?")} ${duration(elapsed)}`;
  } else if (count(v["calls"]) > 0) {
    call = `max ${word(v["max_kind"], "?")} ${duration(num(v["max"]))}`;
  }
  return {
    name: word(v["name"], "?"),
    running: v["running"] === true,
    busy: seriesOf(v["busy_percent"]),
    cpu: seriesOf(v["cpu_percent"]),
    calls: seriesOf(v["calls_per_second"]),
    uiMs: seriesOf(v["ui_ms_per_second"]),
    queued: count(v["queued"]),
    memory: count(v["memory"]),
    call,
  };
}

/** How loud its row is drawn: a stopped plugin is off, a queue of ten is hot. */
export function level(extension: Extension): Level {
  if (!extension.running) return "off";
  if (extension.queued >= 10) return "hot";
  if (extension.uiMs.avg10s >= 8) return "busy";
  return load(Math.max(extension.busy.avg10s, extension.cpu.avg10s));
}

/** Its cells, in `EXTENSIONS`' order (the graph is drawn apart). */
export function extensionCells(extension: Extension): string[] {
  return [
    extension.running ? extension.name : `${extension.name} (off)`,
    percent(extension.busy.avg10s),
    percent(extension.cpu.avg10s),
    percent(extension.cpu.avg60s),
    fixed(extension.calls.avg10s, 1),
    String(extension.queued),
    `${fixed(extension.uiMs.avg10s, 1)}ms`,
    bytes(extension.memory),
    extension.call,
  ];
}

/** Its cells, in `THREADS`' order (the graph is drawn apart). */
export function threadCells(thread: Thread): string[] {
  const cpu = thread.cpu;
  const name = thread.count > 1 ? `${thread.name} ×${thread.count}` : thread.name;
  return [
    name,
    percent(cpu.now),
    percent(cpu.avg10s),
    percent(cpu.avg60s),
    percent(cpu.peak60s),
    thread.name === EXITED ? "since gone" : "",
  ];
}

export function threadOf(value: unknown): Thread {
  const v = record(value);
  return { name: word(v["name"], "?"), count: count(v["count"]), cpu: seriesOf(v["cpu_percent"]) };
}

export function reportOf(value: unknown): Report {
  const v = record(value);
  const process = record(v["process"]);
  const frames = record(v["frames"]);
  return {
    samples: count(v["samples"]),
    cpu: seriesOf(process["cpu_percent"]),
    rss: count(process["rss"]),
    threadsAlive: count(process["threads"]),
    uptime: count(process["uptime"]),
    ui: seriesOf(frames["ui_percent"]),
    fps: seriesOf(frames["per_second"]),
    frameAvgMs: num(frames["avg"]),
    frameMaxMs: num(frames["max"]),
    slow: count(frames["slow"]),
    extensions: items(v["extensions"]).map(extensionOf),
    threads: items(v["threads"]).slice(0, THREADS_SHOWN).map(threadOf),
  };
}

/** A report with nothing in it yet, for a view that has not read one. */
export const EMPTY: Report = reportOf({ samples: 0 });

/** The app's own line: its CPU, now and averaged. */
export function appLine(report: Report): string {
  const cpu = report.cpu;
  return `app    cpu ${percent(cpu.now).padStart(5)} now ${percent(cpu.avg10s).padStart(5)} 10s ${percent(cpu.avg60s).padStart(5)} 60s  peak ${percent(cpu.peak60s).padStart(5)}  `;
}

export function memoryLine(report: Report): string {
  return `       rss ${bytes(report.rss)}  threads ${report.threadsAlive}  up ${report.uptime}s  samples ${report.samples}`;
}

export function uiLine(report: Report): string {
  return (
    `ui     thread ${percent(report.ui.avg10s).padStart(5)} 10s ${percent(report.ui.avg60s).padStart(5)} 60s  ` +
    `${fixed(report.fps.avg10s, 0)} frames/s  avg ${duration(report.frameAvgMs)}  ` +
    `max ${duration(report.frameMaxMs)}  slow ${report.slow}  `
  );
}

/** How many rows it draws, and how many spacers between its sections. */
export function rowsOf(report: Report): { rows: number; spacers: number } {
  // The title, the app's three lines, the table's heading and its rows (or the line that says
  // there are none).
  let rows = 5 + Math.max(report.extensions.length, 1);
  let spacers = 1;
  if (report.threads.length > 0) {
    rows += 1 + report.threads.length;
    spacers += 1;
  }
  if (report.samples === 0) rows += 1;
  return { rows, spacers };
}

/** The float's height in pixels, so it is as tall as what it draws. */
export function heightOf(report: Report): number {
  const { rows, spacers } = rowsOf(report);
  const children = rows + spacers;
  return 2 * PAD + FRAME + rows * LINE + spacers * SPACER + (children - 1) * GAP;
}

/** The float's width in pixels: the wider table, and the padding. */
export function width(): number {
  const chars = (columns: readonly Column[]) => columns.reduce((sum, [, w]) => sum + w, 0);
  return Math.ceil(Math.max(chars(EXTENSIONS), chars(THREADS)) * CHAR + 2 * PAD + FRAME);
}

/** A number with `digits` after the point, as Rust's `{:.N}` writes it: a tie goes to the even
 * digit (`16.25` is `16.2`), and a value already that exact is left alone (`2.5` is `2.5`). */
export function fixed(value: number, digits: number): string {
  const scale = 10 ** digits;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const rest = scaled - floor;
  const rounded = rest > 0.5 || (rest === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
  return (rounded / scale).toFixed(digits);
}

/** A share as a whole percentage. */
export function percent(share: number): string {
  return `${fixed(share, 0)}%`;
}

export function bytes(n: number): string {
  if (n >= 1 << 30) return `${fixed(n / (1 << 30), 1)} GB`;
  if (n >= 1 << 20) return `${fixed(n / (1 << 20), 1)} MB`;
  if (n >= 1 << 10) return `${n >> 10} KB`;
  return `${n} B`;
}

/** Milliseconds, in the unit that reads best. */
export function duration(ms: number): string {
  const s = ms / 1e3;
  if (s >= 1) return `${fixed(s, 2)}s`;
  if (s >= 1e-3) return `${fixed(ms, 1)}ms`;
  return `${fixed(ms * 1e3, 0)}µs`;
}

const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** The last minute as block characters, right-aligned and always `GRAPH` wide: each character the
 * mean of its share of the samples, against 100% or the peak if higher. */
export function graphLine(series: Series): string {
  const values = series.last60s;
  const scale = Math.max(series.peak60s, 100);
  const per = Math.max(Math.ceil(values.length / GRAPH), 1);
  let line = " ".repeat(Math.max(GRAPH - Math.ceil(values.length / per), 0));
  const chunks: number[][] = [];
  for (let end = values.length; end > 0; end -= per) chunks.push(values.slice(Math.max(end - per, 0), end));
  for (const chunk of chunks.reverse()) {
    const mean = chunk.reduce((sum, v) => sum + v, 0) / chunk.length;
    const level = mean <= 0.05 ? 0 : Math.min(Math.max(Math.ceil((mean / scale) * 8), 1), 8);
    line += BLOCKS[level];
  }
  return line;
}
