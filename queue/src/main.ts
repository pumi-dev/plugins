// queue: commands that run one at a time, each after the pane it waits for is done, and a bar under
// each pane that has one, showing its jobs.
//
//   pumi call queue.add '{"command":"cargo test","after":"%3"}'   # under %3, after %3 is done
//   pumi call queue.add '{"command":"make deploy","run":"shell"}' # headless, in the app
//   pumi call queue.list
//   pumi call queue.cancel '{"id":3}'
//   pumi call queue.clear
//
// The waiting is pumi's own — a pane's `@status`, its `pane_foreground_pgid` back to its
// shell, `pane_dead` — read here, in `queue.ts`. This file is what the app reaches: the functions
// others call, the bar's view, and the events that end a wait.
import { ApiError, fn, on, self } from "pumi";
import { detail, paneId, type Job } from "./job.ts";
import { addJob, advance, busy, cancelJob, clearJobs, jobsOf, listJobs, pulse, syncViews, vanished } from "./queue.ts";

// ---- the functions others call

fn.set("queue.add", {
    desc: "Add a command to the queue: it runs when the pane it waits for is done, and when everything before it is.",
    parameters: [["table", "spec"]],
    examples: [
      { args: [{ command: "cargo test", after: "%3" }] },
      { args: [{ command: "say done", run: "shell" }] },
      { args: [{ command: "make deploy", after: { pane: 5, on: "done" }, run: "pane:%7" }] },
    ],
  callback: async (spec: unknown) => {
    try {
      return await addJob(spec);
    } catch (err) {
      throw err instanceof ApiError ? err : new ApiError("invalid_params", message(err));
    }
  },
});

fn.set("queue.list", {
    desc: "The queue: every job, its state, what it waits for and where it runs.",
    parameters: [],
    examples: [{ args: [] }],
  callback: () => listJobs(),
});

fn.set("queue.cancel", {
    desc: "Cancel a job that has not started.",
    parameters: [["number", "id"]],
    examples: [{ args: [{ id: 3 }] }],
  callback: async (args: unknown) => {
    const at = args && typeof args === "object" && "id" in args ? (args as { id: unknown }).id : args;
    const id = paneId(at);
    if (id === null) throw new ApiError("invalid_params", "queue.cancel needs an `id`");
    if (!cancelJob(id)) throw new ApiError("invalid_params", `job ${id} is not waiting`);
    await advance();
    await syncViews();
    return true;
  },
});

fn.set("queue.clear", {
    desc: "Forget the jobs that are over, and close the panes they opened.",
    parameters: [],
    examples: [{ args: [] }],
  callback: () => clearJobs(),
});

// ---- the bar
//
// One under each pane that has work, as the manifest's `contributes.slots["pane.strip"]`: the app
// draws it on every pane, and it draws nothing for a pane the queue has no job for. It reads the
// queue through the two exports below, on its own clock.

/** A job as a bar draws it: what it is called, where it is, and what it says of itself. */
export interface BarRow {
  id: number;
  label: string;
  /** `waiting`, `running`, `done`, `failed` or `cancelled`, and the status of a finished one. */
  kind: string;
  status: number | null;
  /** Its detail line: how long, what it waits for, a headless job's last line. */
  said: string;
  /** The pane a press goes to: the one it runs in, opened, or waits for. */
  target: number | null;
  /** A waiting job can be cancelled. */
  waiting: boolean;
}

/** The jobs the bar of `pane` shows, in the order they will run. */
export function bar(pane: number): BarRow[] {
  const now = Date.now();
  return jobsOf(pane).map((job: Job) => {
    const over = job.state.kind === "done" || job.state.kind === "failed";
    return {
      id: job.id,
      label: job.label,
      kind: job.state.kind,
      status: job.state.kind === "done" ? job.state.status : null,
      said: over && job.tail !== "" ? `${detail(job, now)} · ${job.tail}` : detail(job, now),
      target: job.state.kind === "running" && job.state.pane !== null ? job.state.pane : (job.opened ?? job.after?.pane ?? null),
      waiting: job.state.kind === "waiting",
    };
  });
}

/** Whether anything is waiting or running: the bar's clock is faster then. */
export function running(): boolean {
  return busy();
}

/** Looks at the panes the queue waits for, and starts what can start. */
export function look(): Promise<void> {
  return advance();
}

/** Cancels a job that has not started. */
export function cancel(id: number): Promise<void> {
  cancelJob(id);
  return advance().then(() => syncViews());
}

// ---- the events that end a wait
//
// A pane's report, its shell coming back, its program ending: any of them can end a wait.
on("pane.changed", { desc: "the queue follows the panes it waits for" }, () => void pulse());
on("pane.closed", { desc: "a pane closed, so what it was doing is over" }, async (e) => {
  const at = paneId(e.pane) ?? paneId(e.data?.pane);
  if (at !== null) await vanished(at);
  await pulse();
});

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Run the queue up to now, and draw the bars wherever there is work.
void advance()
  .then(() => syncViews())
  .catch((err) => console.error(`${self.plugin.prefix}: starting up threw:`, err));
