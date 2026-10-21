// A bar under one pane: the jobs that pane waits for, and the one running in it — a title, then a
// row a job, in the order they will run. It draws as many rows as the app gave it: one is the whole
// queue in a line, more is the list (`@rows`, the app sizes a winbar by what its views ask for).
import { div, pane, text, theme, token, View, type Color, type El, type ViewContext } from "pumi";
import { detail, isRunning, type Job } from "./job.ts";
import { advance, busy, cancelJob, jobsOf, watchBars } from "./queue.ts";

/** A row of the bar, in pixels: a winbar's row is 24. */
const ROW = 24;
/** What the rows are drawn inside: the bar's own padding, top and bottom. */
const PAD = 4;

export class Bar extends View<{ pane?: number }> {
  /** The pane it is under. */
  private readonly owner: number;

  constructor(cx: ViewContext<{ pane?: number }>) {
    super(cx);
    this.owner = typeof cx.args?.pane === "number" ? cx.args.pane : cx.pane.id;
    // The queue changed: draw it again.
    cx.own(watchBars(() => cx.notify()));
    // Look at the panes the queue waits for twice a second while it has work, and now and then
    // when it has none: the clock on a running job, and the panes that never fired an event.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      // Always draws again: the clock on a running job moves whether or not the queue did.
      void advance().then(() => cx.notify());
      timer = setTimeout(tick, busy() ? 500 : 2_000);
    };
    timer = setTimeout(tick, busy() ? 500 : 2_000);
    cx.own(() => clearTimeout(timer));
  }

  render(cx: ViewContext<{ pane?: number }>): El {
    const now = Date.now();
    const rows = Math.max(1, Math.floor((cx.size.height - PAD) / ROW));
    const jobs = jobsOf(this.owner);
    const column = div().id("queue-bar").flex().flexCol().sizeFull().px(10).py(PAD / 2).overflowHidden();
    if (rows === 1) {
      // The app has one row for it: the whole queue in a line.
      return column.child(line(jobs, now));
    }
    column.child(title(jobs));
    const room = rows - 1;
    const shown = jobs.length > room ? Math.max(0, room - 1) : jobs.length;
    for (const job of jobs.slice(0, shown)) column.child(row(job, now, cx));
    if (jobs.length > shown) column.child(more(jobs.length - shown));
    return column;
  }
}

/** The one line a bar with a single row draws: the job that matters, and what is behind it. */
function line(jobs: Job[], now: number): El {
  const job = jobs.find((each) => isRunning(each.state)) ?? jobs[0];
  if (!job) return div().id("queue-line").h(ROW);
  const { glyph, tint } = mark(job);
  const behind = jobs.length - 1;
  return div()
    .id("queue-line")
    .flex()
    .flexRow()
    .h(ROW)
    .wFull()
    .gap(8)
    .child(div().w(12).flexNone().child(text(glyph).textSize(10.5).textColor(tint)))
    .child(div().flex1().child(text(job.label).textSize(11).textColor(theme.text)))
    .when(behind > 0, (row) => row.child(text(`+${behind}`).flexNone().textSize(10).textColor(theme.muted)))
    .child(text(said(job, now)).flexNone().textSize(10).textColor(theme.muted));
}

function title(jobs: Job[]): El {
  const running = jobs.filter((job) => isRunning(job.state)).length;
  const waiting = jobs.filter((job) => job.state.kind === "waiting").length;
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} running`);
  if (waiting > 0) parts.push(`${waiting} waiting`);
  return div()
    .id("queue-title")
    .flex()
    .flexRow()
    .h(ROW)
    .wFull()
    .gap(8)
    .child(text("queue").flexNone().textSize(10.5).textColor(theme.muted))
    .child(text(parts.length === 0 ? `${jobs.length} over` : parts.join(" · ")).flex1().textSize(10.5).textColor(token("muted", 0.75)));
}

/** A job's glyph, and what it is drawn in. */
function mark(job: Job): { glyph: string; tint: Color } {
  const state = job.state;
  switch (state.kind) {
    case "running":
      return { glyph: "▶", tint: theme.primary };
    case "waiting":
      return { glyph: "·", tint: token("muted", 0.5) };
    case "done":
      return state.status === 0 ? { glyph: "✓", tint: theme.success } : { glyph: "✗", tint: theme.error };
    case "failed":
      return { glyph: "✗", tint: theme.error };
    case "cancelled":
      return { glyph: "×", tint: token("muted", 0.5) };
  }
}

/** What the bar says of a job: its detail, and a headless job's last line once it is over. */
function said(job: Job, now: number): string {
  const over = job.state.kind === "done" || job.state.kind === "failed";
  return over && job.tail !== "" ? `${detail(job, now)} · ${job.tail}` : detail(job, now);
}

function row(job: Job, now: number, cx: ViewContext<unknown>): El {
  const { glyph, tint } = mark(job);
  const state = job.state;
  const foreground = state.kind === "cancelled" ? token("muted", 0.6) : theme.text;
  // A row is a way to its pane: the one it runs in, or the one it opened, or the one it waits for.
  const target = state.kind === "running" && state.pane !== null ? state.pane : (job.opened ?? job.after?.pane ?? null);
  return div()
    .id(`queue-job-${job.id}`)
    .flex()
    .flexRow()
    .h(ROW)
    .wFull()
    .gap(8)
    .px(2)
    .rounded(4)
    .cursorPointer()
    .hover((style) => style.bg(theme.hover))
    .onClick((e) => {
      if (target !== null) void pane.select({ to: target });
      e.stop();
    })
    .child(div().w(12).flexNone().child(text(glyph).textSize(10.5).textColor(tint)))
    .child(div().flex1().child(text(job.label).textSize(11).textColor(foreground)))
    .child(text(said(job, now)).flexNone().textSize(10).textColor(theme.muted))
    .when(state.kind === "waiting", (each) => each.child(cancelButton(job.id, cx)));
}

function more(count: number): El {
  return div()
    .flex()
    .flexRow()
    .h(ROW)
    .wFull()
    .px(2)
    .child(text(`+${count} more · pumi call queue.list`).flex1().textSize(10).textColor(theme.muted));
}

function cancelButton(id: number, cx: ViewContext<unknown>): El {
  return div()
    .id(`queue-cancel-${id}`)
    .flexNone()
    .px(4)
    .rounded(3)
    .hover((style) => style.bg(theme.border))
    .onClick((e) => {
      cancelJob(id);
      cx.notify();
      e.stop();
    })
    .child(text("✕").textSize(10).textColor(theme.muted));
}
