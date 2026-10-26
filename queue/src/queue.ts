// The queue itself: the jobs, one at a time, each after the pane it waits for is done. The waiting
// is pumi's own — a pane's `@agent_status` (OSC 7501, so an agent's turn), its
// `pane_foreground_pgid` back to its shell (a plain command finished), `pane_dead` (its program
// exited) — and what the queue does with them is here.
//
// Every call is answered asynchronously, so `advance()` looks at the panes and is run one look at a
// time: an event, a tick and a job's end all ask for the same thing, and two looks at once would
// start a job twice.
import { ApiError, option, request, self, workspace, type Pane } from "pumi";
import {
  Armed,
  clock,
  detail,
  holds,
  home,
  isRunning,
  isSettled,
  parseAgent,
  parseJob,
  paneId,
  shown,
  type Facts,
  type Job,
} from "./job.ts";

/** The most jobs a queue keeps; the oldest settled go past it. */
const LIMIT = 50;

let jobs: Job[] = [];
let nextId = 1;
/** Something changed since the bars last drew. */
let dirty = true;
/** Nothing opens or closes a bar while a bar is being opened or closed. */
let syncing = false;
/** What a bar does when the queue changed: it renders again. */
const watchers = new Set<() => void>();

const armed = new Armed();

// ---- what a pane says of itself

/** The pane `at`, as the SDK's model of it. */
function model(at: number): Pane | null {
  return workspace.getPane(`%${at}`);
}

/** A pane's option, or `null` when it has none (or the app says no). */
async function optionOf(at: number, name: string): Promise<unknown> {
  try {
    return await option.get(name, { scope: "pane", id: `%${at}` });
  } catch {
    return null;
  }
}

async function textOf(at: number, name: string): Promise<string | null> {
  const value = await optionOf(at, name);
  return typeof value === "string" ? value : null;
}

async function numberOf(at: number, name: string): Promise<number | null> {
  const value = await optionOf(at, name);
  return typeof value === "number" ? value : null;
}

/**
 * A pane's facts, as the host keeps them: its program's report, whether it exited, and whether its
 * first process (its shell) has the terminal again.
 */
async function factsOf(at: number): Promise<Facts> {
  const [status, dead, foreground, shell] = await Promise.all([
    textOf(at, "@agent.status"),
    optionOf(at, "pane_dead"),
    numberOf(at, "pane_foreground_pgid"),
    numberOf(at, "pane_pid"),
  ]);
  return { dead: dead === true, agent: parseAgent(status ?? ""), atRest: foreground !== null && foreground === shell };
}

async function exitOf(at: number): Promise<number | null> {
  return numberOf(at, "pane_dead_status");
}

/** The panes there are. */
async function panesNow(): Promise<number[]> {
  try {
    const list = await workspace.panes();
    return list.map((pane) => paneId(pane.id)).filter((at): at is number => at !== null);
  } catch {
    // No answer is no panes: a pane that closed, a look that came too late.
    return [];
  }
}

/** Whether a pane is still there. */
async function present(at: number): Promise<boolean> {
  return (await panesNow()).includes(at);
}

/** The pane the queue runs jobs for, as its caller has it. */
async function currentPane(): Promise<number> {
  try {
    await workspace.ready;
    const at = workspace.currentPane;
    return at === null ? 0 : (paneId(at.id) ?? 0);
  } catch {
    return 0;
  }
}

// ---- options

/** One of the package's flags, by its key. */
async function flag(name: string, otherwise: boolean): Promise<boolean> {
  const value = await option.get(name);
  return typeof value === "boolean" ? value : otherwise;
}

// ---- the queue

function find(id: number): Job | undefined {
  return jobs.find((job) => job.id === id);
}

/** End a job: what it became, and when. */
function settle(job: Job, state: Job["state"], now: number) {
  job.state = state;
  job.ended = now;
}

/** Say a job is over, as the OS says it. */
async function say(job: Job): Promise<void> {
  if (!(await flag("notify", true))) return;
  const state = job.state;
  if (state.kind === "done") {
    const said =
      state.status === 0
        ? request.open({ kind: "notification", title: `queue: ${job.label} ✓ ${clock(state.took)}`, level: "info" })
        : request.open({ kind: "notification", title: `queue: ${job.label} exited ${state.status ?? "?"} after ${clock(state.took)}`, level: "warn" });
    await said.catch(() => undefined);
  } else if (state.kind === "failed") {
    await request.open({ kind: "notification", title: `queue: ${job.label} failed: ${state.why}`, level: "error" }).catch(() => undefined);
  }
}

/** Whether a job's wait is over. */
async function ready(job: Job): Promise<boolean> {
  if (!job.after) return true;
  if (armed.held(job.after.pane)) return false;
  return holds(await factsOf(job.after.pane), job.after.on);
}

/** The jobs a pane's bar shows, in the order they will run. */
export function jobsOf(owner: number): Job[] {
  const now = Date.now();
  const mine = jobs.filter((job) => home(job) === owner && shown(job, now));
  return [
    ...mine.filter((job) => isRunning(job.state)),
    ...mine.filter((job) => job.state.kind === "waiting"),
    ...mine.filter((job) => isSettled(job.state)).reverse(),
  ];
}

/** Whether anything is waiting or running (the bars tick faster then). */
export function busy(): boolean {
  return jobs.some((job) => !isSettled(job.state));
}

/** `fn` runs when the queue changed; returns what undoes it. */
export function watchBars(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

let looking: Promise<void> = Promise.resolve();

/** Run the queue up to now, one look at a time. */
export function advance(): Promise<void> {
  looking = looking.then(look, look);
  return looking;
}

async function look(): Promise<void> {
  try {
    if (await step()) await syncViews();
  } catch (err) {
    console.error(`${self.plugin.prefix}: looking at the queue threw:`, err);
  }
}

/** One look at the panes: end what is over, and put the next job to work. Whether it changed. */
async function step(): Promise<boolean> {
  const now = Date.now();
  let changed = false;

  // A pane typed into is not done until it was seen busy, or long enough that its command was
  // over before anyone looked.
  for (const at of armed.panes()) {
    const facts = await factsOf(at);
    armed.observe(at, facts.atRest, now);
  }

  // A pane that closed while the queue held a job for it is done with whatever it was doing.
  if (jobs.some((job) => job.state.kind === "waiting" && job.after)) {
    const there = await panesNow();
    for (const job of jobs) {
      if (job.state.kind === "waiting" && job.after && !there.includes(job.after.pane)) {
        job.after = null;
        changed = true;
      }
    }
  }

  // A job run in a pane is finished when that pane is at rest again, or its program exited.
  for (const job of jobs) {
    const state = job.state;
    if (state.kind !== "running" || state.pane === null) continue;
    const at = state.pane;
    if (armed.held(at)) continue;
    // A pane the queue opened runs one command: it is over when that program exits. A pane it
    // typed into is a terminal whose shell we can only watch.
    const wanted = job.opened === null ? "done" : "exit";
    if (!holds(await factsOf(at), wanted)) continue;
    const status = await exitOf(at);
    settle(job, { kind: "done", status, took: now - state.at }, now);
    changed = true;
    await say(job);
  }

  // One at a time, in the order they were added.
  if (!jobs.some((job) => isRunning(job.state))) {
    for (const job of jobs) {
      if (job.state.kind !== "waiting" || !(await ready(job))) continue;
      await start(job);
      changed = true;
      break;
    }
  }

  if (changed) dirty = true;
  return changed;
}

/** Start a job: in a pane of its own, in the app, or typed into a terminal it named. */
async function start(job: Job): Promise<void> {
  const now = Date.now();
  const run = job.run;
  if (run.kind === "pane") {
    try {
      await model(run.pane)?.input({ text: `${job.command}\r` });
      armed.stamp(run.pane, now);
      job.state = { kind: "running", pane: run.pane, at: now };
    } catch (err) {
      settle(job, { kind: "failed", why: `%${run.pane}: ${message(err)}` }, now);
    }
    return;
  }
  if (run.kind === "new") {
    const cwd = job.cwd ?? (job.after ? await textOf(job.after.pane, "pane_current_path") : null);
    const args: Record<string, unknown> = { command: job.command };
    if (cwd !== null) args.cwd = cwd;
    try {
      const opened = await workspace.openPane("terminal", args, { kind: "tiled", split: "down", focus: false });
      // Its output stays for the user when it is over, until the queue is cleared.
      await option.set("remain_on_exit", await flag("keep", true), { scope: "pane", id: opened.id }).catch(() => undefined);
      const at = paneId(opened.id);
      job.opened = at;
      job.state = { kind: "running", pane: at, at: now };
    } catch (err) {
      settle(job, { kind: "failed", why: message(err) }, now);
    }
    return;
  }
  shell(job, now);
}

/** A headless job: `sh -c`, its output's last line kept, and the end of it in its exit. */
function shell(job: Job, now: number): void {
  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    child = Bun.spawn(["sh", "-c", job.command], {
      cwd: job.cwd ?? undefined,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    settle(job, { kind: "failed", why: `sh: ${message(err)}` }, now);
    return;
  }
  job.state = { kind: "running", pane: null, at: now };
  void readTail(child.stdout, job.id);
  void readTail(child.stderr, job.id);
  void child.exited
    .then(async (status) => {
      const at = Date.now();
      const ended = find(job.id);
      if (ended && ended.state.kind === "running") {
        settle(ended, { kind: "done", status, took: at - ended.state.at }, at);
        await say(ended);
      }
      await advance();
    })
    .catch((err) => console.error(`${self.plugin.prefix}: ${message(err)}`));
}

/** Keep the last line a headless job printed, for its bar. */
async function readTail(stream: ReadableStream<Uint8Array>, id: number): Promise<void> {
  const decoder = new TextDecoder();
  let rest = "";
  try {
    for await (const chunk of stream) {
      rest += decoder.decode(chunk, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      const last = lines.map((line) => line.trim()).filter(Boolean).at(-1);
      if (last !== undefined) tailOf(id, last);
    }
    const last = rest.trim();
    if (last !== "") tailOf(id, last);
  } catch {
    // A stream that ended with the job: its tail is what it had.
  }
}

function tailOf(id: number, line: string) {
  const job = find(id);
  if (!job || job.tail === line) return;
  job.tail = line;
  dirty = true;
}

/** A pane closed: the job that ran in it is over, whatever its status was. */
export async function vanished(at: number): Promise<void> {
  armed.forget(at);
  const now = Date.now();
  const status = await exitOf(at);
  const finished: Job[] = [];
  for (const job of jobs) {
    const state = job.state;
    if (state.kind === "running" && state.pane === at) {
      settle(job, { kind: "done", status, took: now - state.at }, now);
      finished.push(job);
    } else if (state.kind === "waiting" && job.after?.pane === at) {
      // A pane that is gone is done with whatever it was doing: the wait is over.
      job.after = null;
    }
  }
  for (const job of finished) await say(job);
  dirty = true;
}

/** Add a job (`queue.add`): what it is, and its id. */
export async function addJob(args: unknown): Promise<number> {
  const id = nextId++;
  const origin = await currentPane();
  const job = parseJob(id, args, Date.now(), origin);
  if (job.after && !(await present(job.after.pane))) throw new ApiError("not_found", `no pane %${job.after.pane}`);
  jobs.push(job);
  if (jobs.length > LIMIT) trim();
  dirty = true;
  await advance();
  await syncViews();
  return id;
}

/** The oldest settled jobs go past `LIMIT`. */
function trim() {
  let over = jobs.length - LIMIT;
  jobs = jobs.filter((job) => {
    if (over > 0 && isSettled(job.state)) {
      over--;
      return false;
    }
    return true;
  });
}

/** The queue as other surfaces read it (`queue.list`). */
export function listJobs(): Record<string, unknown>[] {
  const now = Date.now();
  return jobs.map((job) => {
    const state = job.state;
    const word =
      state.kind === "waiting"
        ? "waiting"
        : state.kind === "running"
          ? "running"
          : state.kind === "done"
            ? "done"
            : state.kind === "failed"
              ? "failed"
              : "cancelled";
    const run = job.run.kind === "pane" ? `%${job.run.pane}` : job.run.kind;
    return {
      id: job.id,
      command: job.command,
      name: job.label,
      state: word,
      status: state.kind === "done" ? state.status : null,
      detail: detail(job, now),
      after: job.after ? { pane: job.after.pane, on: job.after.on } : null,
      run,
      pane: state.kind === "running" ? state.pane : job.opened,
      bar: home(job),
      tail: job.tail,
    };
  });
}

/** Cancel a job that has not started (`queue.cancel`). Whether it was one. */
export function cancelJob(id: number): boolean {
  const job = find(id);
  if (!job || job.state.kind !== "waiting") return false;
  settle(job, { kind: "cancelled" }, Date.now());
  dirty = true;
  return true;
}

/** Forget the jobs that are over, and the panes they opened (`queue.clear`): how many. */
export async function clearJobs(): Promise<number> {
  const over = jobs.filter((job) => isSettled(job.state));
  for (const job of over) {
    if (job.opened !== null && (await present(job.opened))) await model(job.opened)?.close().catch(() => undefined);
  }
  const before = jobs.length;
  jobs = jobs.filter((job) => !isSettled(job.state));
  dirty = true;
  await syncViews();
  return before - jobs.length;
}

/** Run the queue up to now, and render the bars again when it changed. */
export async function pulse(): Promise<void> {
  await advance();
  if (!dirty) return;
  dirty = false;
  for (const fn of watchers) fn();
}

/** Render the bars again: the app draws one on every pane, and it reads the queue itself. */
export async function syncViews(): Promise<void> {
  for (const fn of watchers) fn();
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
