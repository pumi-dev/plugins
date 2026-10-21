// queue: commands that run one at a time, each after the pane it waits for is done, and a bar under
// each pane that has one, showing its jobs.
//
//   pumi call queue.add '{"command":"cargo test","after":"%3"}'   # under %3, after %3 is done
//   pumi call queue.add '{"command":"make deploy","run":"shell"}' # headless, in the app
//   pumi call queue.list
//   pumi call queue.cancel '{"id":3}'
//   pumi call queue.clear
//
// The waiting is pumi's own — a pane's `@agent_status`, its `pane_foreground_pgid` back to its
// shell, `pane_dead` — read here, in `queue.ts`. This file is what the app reaches: the functions
// others call, the bar's view, and the events that end a wait.
import { ApiError, on, option, provide, pkg, view } from "pumi";
import { Bar } from "./bar.ts";
import { paneId } from "./job.ts";
import { addJob, advance, cancelJob, clearJobs, listJobs, pulse, syncViews, vanished } from "./queue.ts";

// ---- the functions others call

provide(
  "queue.add",
  {
    desc: "Add a command to the queue: it runs when the pane it waits for is done, and when everything before it is.",
    parameters: [["table", "spec"]],
    examples: [
      { args: [{ command: "cargo test", after: "%3" }] },
      { args: [{ command: "say done", run: "shell" }] },
      { args: [{ command: "make deploy", after: { pane: 5, on: "done" }, run: "pane:%7" }] },
    ],
  },
  async (spec: unknown) => {
    try {
      return await addJob(spec);
    } catch (err) {
      throw err instanceof ApiError ? err : new ApiError("invalid_params", message(err));
    }
  },
);

provide(
  "queue.list",
  {
    desc: "The queue: every job, its state, what it waits for and where it runs.",
    parameters: [],
    examples: [{ args: [] }],
  },
  () => listJobs(),
);

provide(
  "queue.cancel",
  {
    desc: "Cancel a job that has not started.",
    parameters: [["number", "id"]],
    examples: [{ args: [{ id: 3 }] }],
  },
  async (args: unknown) => {
    const at = args && typeof args === "object" && "id" in args ? (args as { id: unknown }).id : args;
    const id = paneId(at);
    if (id === null) throw new ApiError("invalid_params", "queue.cancel needs an `id`");
    if (!cancelJob(id)) throw new ApiError("invalid_params", `job ${id} is not waiting`);
    await advance();
    await syncViews();
    return true;
  },
);

provide(
  "queue.clear",
  {
    desc: "Forget the jobs that are over, and close the panes they opened.",
    parameters: [],
    examples: [{ args: [] }],
  },
  () => clearJobs(),
);

// ---- the bar

view("board", Bar);

// ---- the events that end a wait
//
// A pane's report, its shell coming back, its program ending: any of them can end a wait.
on(
  "option.changed",
  {
    match: ["@agent_status", "pane_current_command", "pane_foreground_pgid", "pane_dead"],
    desc: "the queue follows the panes it waits for",
  },
  () => void pulse(),
);
on("terminal.closed", { desc: "a terminal's program ended" }, () => void pulse());
on("pane.closed", { desc: "a pane closed, so what it was doing is over" }, async (e) => {
  const at = paneId(e.pane) ?? paneId(e.data?.pane);
  if (at !== null) await vanished(at);
  await pulse();
});

/** Drop a `queue` region an earlier version left in `chrome.regions`, and nothing else. */
async function forgetRegion(): Promise<void> {
  const list = await option.get("chrome.regions").catch(() => null);
  if (!Array.isArray(list)) return;
  const named = (entry: unknown) =>
    typeof entry === "object" && entry !== null && (entry as { name?: unknown }).name === "queue";
  if (!list.some(named)) return;
  try {
    await option.save("chrome.regions", list.filter((entry) => !named(entry)));
  } catch (err) {
    console.error(`${pkg.prefix}: ${message(err)}`);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

void forgetRegion();
// Run the queue up to now, and keep a bar wherever there is work.
void advance()
  .then(() => syncViews())
  .catch((err) => console.error(`${pkg.prefix}: starting up threw:`, err));
