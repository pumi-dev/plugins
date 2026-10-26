// A job: what runs, where, and what it waits for. The waiting is decided here, over `Facts` — what
// a pane says of itself — so the queue's rules are plain functions a test can call, with no app.
//
// A job waits for a pane (`after`) and for everything before it in the queue; `On` is what "done"
// means there: the program reported it over or its shell is back (`done`), only the shell being
// back (`idle`), or the program exited (`exit`).

/** What a job waits for, on the pane it named. */
export type On = "done" | "idle" | "exit";

/** The words `after` takes (`""` is `done`). */
export function parseOn(word: string): On | null {
  switch (word) {
    case "":
    case "done":
      return "done";
    case "idle":
      return "idle";
    case "exit":
      return "exit";
    default:
      return null;
  }
}

/** A program's own report (its pane's `@agent.status`). */
export type Agent = "idle" | "working" | "done" | "blocked" | "error";

export function parseAgent(word: string): Agent | null {
  switch (word) {
    case "idle":
    case "working":
    case "done":
    case "blocked":
    case "error":
      return word;
    default:
      return null;
  }
}

/** What a pane says of itself, as the host keeps it. */
export interface Facts {
  /** Its program exited (`pane_dead`). */
  dead: boolean;
  /** What it reported it is doing (`@agent.status`), if anything. */
  agent: Agent | null;
  /** Its shell has the terminal (`pane_foreground_pgid == pane_pid`). */
  atRest: boolean;
}

/** Whether the program says it is working, or waiting for a person. */
export function isBusy(facts: Facts): boolean {
  return facts.agent === "working" || facts.agent === "blocked";
}

/** Whether the program reported its turn over. */
export function isFinished(facts: Facts): boolean {
  return facts.agent === "done" || facts.agent === "error";
}

/** Whether the wait is over. */
export function holds(facts: Facts, on: On): boolean {
  switch (on) {
    case "exit":
      return facts.dead;
    case "idle":
      return facts.dead || (facts.atRest && !isBusy(facts));
    case "done":
      return facts.dead || isFinished(facts) || (facts.atRest && !isBusy(facts));
  }
}

/**
 * The panes the queue typed a command into, and when: "at rest" is not "its command finished"
 * until it has been seen busy — or until `GRACE` says the command was too quick to see (`true`,
 * `echo hi`), which would otherwise wait for ever.
 */
export class Armed {
  /** How long a pane may stay at rest after being typed into before its command counts as done. */
  static readonly GRACE = 2_000;
  private since = new Map<number, number>();

  stamp(pane: number, now: number) {
    this.since.set(pane, now);
  }

  /** One look at `pane`. */
  observe(pane: number, atRest: boolean, now: number) {
    const since = this.since.get(pane);
    if (since === undefined) return;
    if (!atRest || now - since >= Armed.GRACE) this.since.delete(pane);
  }

  /** Whether its command may still be starting. */
  held(pane: number): boolean {
    return this.since.has(pane);
  }

  panes(): number[] {
    return [...this.since.keys()];
  }

  forget(pane: number) {
    this.since.delete(pane);
  }
}

/** Where a job's command runs. */
export type Run =
  /** A terminal of its own, as a pane beside the one it waited on. */
  | { kind: "new" }
  /** `sh -c`, in the app, with no terminal (its output's last line is kept). */
  | { kind: "shell" }
  /** Typed into an existing terminal, as `send-keys` does. */
  | { kind: "pane"; pane: number };

/** `"new"`, `"shell"`, or a pane (`"%3"`, `3`). */
export function parseRun(value: unknown): Run {
  if (value === null || value === undefined) return { kind: "new" };
  if (typeof value === "string") {
    const word = value.trim();
    if (word === "" || word === "new") return { kind: "new" };
    if (word === "shell") return { kind: "shell" };
    const pane = paneId(word.replace(/^pane:/, ""));
    if (pane === null) throw new Error(`no place \`${word}\` (\`new\`, \`shell\`, or a pane id)`);
    return { kind: "pane", pane };
  }
  if (typeof value === "number") {
    const pane = paneId(value);
    if (pane === null) throw new Error(`no pane ${show(value)}`);
    return { kind: "pane", pane };
  }
  throw new Error(`\`run\` is \`new\`, \`shell\` or a pane, not ${show(value)}`);
}

/** A `%3`, `3`, `{"pane": 3}`. */
export function paneId(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string") {
    const text = value.trim().replace(/^%/, "");
    return /^\d+$/.test(text) ? Number(text) : null;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const spec = value as Record<string, unknown>;
    const at = typeof spec.pane === "number" ? spec.pane : typeof spec.id === "number" ? spec.id : null;
    return at === null ? null : paneId(at);
  }
  return null;
}

/** A job's state, and what it was when it ended. */
export type State =
  | { kind: "waiting" }
  /** Running: where (no pane: headless), and since when (milliseconds since the epoch). */
  | { kind: "running"; pane: number | null; at: number }
  | { kind: "done"; status: number | null; took: number }
  | { kind: "failed"; why: string }
  | { kind: "cancelled" };

export function isRunning(state: State): boolean {
  return state.kind === "running";
}

/** Over: done, failed or cancelled, so `queue.clear` forgets it. */
export function isSettled(state: State): boolean {
  return state.kind === "done" || state.kind === "failed" || state.kind === "cancelled";
}

export interface Job {
  id: number;
  /** What is run, as the shell reads it. */
  command: string;
  /** What the bar calls it (a `name`, else the command's first line). */
  label: string;
  /** The pane it waits for, and what it waits for there. */
  after: { pane: number; on: On } | null;
  run: Run;
  cwd: string | null;
  state: State;
  /** When it was added (milliseconds). */
  queued: number;
  /** The pane whose caller added it: where its bar shows it when it waits for nothing. */
  origin: number;
  /** The terminal it opened (`run: new`), to close it when the job is cleared. */
  opened: number | null;
  /** When it was over (milliseconds): its bar shows it a little longer. */
  ended: number | null;
  /** The last line a headless job printed. */
  tail: string;
}

/** How long a job that is over stays in its pane's bar. */
export const RECENT = 10_000;

/**
 * `queue.add`'s argument: a command, or a table. `origin` is the pane whose caller added it;
 * it throws what it cannot make a job of.
 */
export function parseJob(id: number, args: unknown, now: number, origin: number): Job {
  if (typeof args === "string") return made(id, args, null, now, origin);
  if (Array.isArray(args)) {
    if (args.length === 0) throw new Error("queue.add needs a `command`");
    if (args.length === 1) return parseJob(id, args[0], now, origin);
  }
  if (!args || typeof args !== "object") throw new Error(`queue.add takes a command or a table, not ${show(args)}`);
  const spec = args as Record<string, unknown>;
  // TODO(api): command.trim: Commands are functions with manifest palette metadata.
  const command = typeof spec.command === "string" ? spec.command.trim() : "";
  if (command === "") throw new Error("queue.add needs a `command`");
  return made(id, command, spec, now, origin);
}

function made(id: number, command: string, spec: Record<string, unknown> | null, now: number, origin: number): Job {
  const at = spec?.after ?? null;
  let after: Job["after"] = null;
  if (at !== null) {
    const object = typeof at === "object" && !Array.isArray(at);
    const target = object ? ((at as Record<string, unknown>).pane ?? null) : at;
    const word = object ? (at as Record<string, unknown>).on : undefined;
    const pane = paneId(target);
    if (pane === null) throw new Error(`\`after\` needs a pane (\`%3\`), not ${show(target)}`);
    const on = parseOn(typeof word === "string" ? word : "done");
    if (on === null) throw new Error(`no wait \`${String(word)}\` (\`done\`, \`idle\`, \`exit\`)`);
    after = { pane, on };
  }
  const name = typeof spec?.name === "string" ? spec.name.trim() : "";
  return {
    id,
    command,
    label: name === "" ? firstLine(command) : name,
    after,
    run: parseRun(spec?.run ?? null),
    cwd: typeof spec?.cwd === "string" ? spec.cwd : null,
    state: { kind: "waiting" },
    queued: now,
    origin,
    opened: null,
    ended: null,
    tail: "",
  };
}

/** The pane whose bar shows it: the one it waits for, else the one it was added from. */
export function home(job: Job): number {
  return job.after ? job.after.pane : job.origin;
}

/** Whether its bar still shows it: while it waits or runs, and a little after it is over. */
export function shown(job: Job, now: number): boolean {
  return !isSettled(job.state) || (job.ended !== null && now - job.ended < RECENT);
}

/** What the bar says of it, past the command. */
export function detail(job: Job, now: number): string {
  const state = job.state;
  switch (state.kind) {
    case "waiting":
      return job.after ? `after %${job.after.pane} · ${job.after.on}` : "next";
    case "running": {
      const took = clock(now - state.at);
      return state.pane === null ? `running · ${took}` : `in %${state.pane} · ${took}`;
    }
    case "done": {
      const mark = state.status === 0 ? "ok" : state.status === null ? "closed" : `exit ${state.status}`;
      return `${mark} · ${clock(state.took)}`;
    }
    case "failed":
      return firstLine(state.why);
    case "cancelled":
      return "cancelled";
  }
}

/** `0:42`, `1:02:03`. */
export function clock(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  const [m, s] = [Math.floor(seconds / 60), seconds % 60];
  const two = (n: number) => String(n).padStart(2, "0");
  return seconds >= 3_600 ? `${Math.floor(m / 60)}:${two(m % 60)}:${two(s)}` : `${m}:${two(s)}`;
}

/** A command's first line, for a bar. */
export function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  const chars = [...line];
  return chars.length > 72 ? `${chars.slice(0, 71).join("")}…` : line;
}

/** A value as a message says it. */
function show(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}
