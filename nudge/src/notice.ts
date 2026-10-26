// What nudge says, apart from the app: which states are worth a notice, what one is called, and
// whether a state is news. `main.ts` reads the panes and posts what this decides, so a test can
// decide too.

/** The states of `@agent_status` that are news. */
export type Status = "blocked" | "done" | "error";

/** The switches, by the state they are for. */
export interface Toggles {
  blocked: boolean;
  done: boolean;
  error: boolean;
}

/** The states there are, as `main.ts` gets them off the wire: a string, of some word. */
export function isStatus(word: string): word is Status {
  return word === "blocked" || word === "done" || word === "error";
}

/** Whether the switches say to notice `status`. */
export function wanted(status: Status, on: Toggles): boolean {
  return on[status];
}

/**
 * An agent's name as a person writes it: `claude` is Claude, `codex` is Codex, and the ones whose
 * own name is not their id capitalized stay as they are (`pi` is pi).
 */
const NAMED: Record<string, string> = { pi: "pi", opencode: "opencode", omp: "omp" };

/** Who is speaking, for the title: the agent, or an agent when the pane does not say. */
export function who(agent: string | null | undefined): string {
  const id = (agent ?? "").trim().toLowerCase();
  if (id === "") return "An agent";
  return NAMED[id] ?? id[0].toUpperCase() + id.slice(1);
}

/** What happened, in one line: the notice's title. */
export function headline(status: Status, agent: string | null | undefined): string {
  const name = who(agent);
  switch (status) {
    case "blocked":
      return `${name} is waiting for you`;
    case "done":
      return `${name} is done`;
    case "error":
      return `${name} failed`;
  }
}

/** How much it interrupts: a wait is why you are told, so it is the loudest a notice gets. */
export function urgency(status: Status): "low" | "normal" | "critical" {
  return status === "done" ? "normal" : "critical";
}

/**
 * The message's level, which heads the notice (`pumi`, `Warning` or `Error`) and colours it where
 * the app shows one: a failure is an error, and a wait for you is a warning.
 */
export function level(status: Status): "info" | "warn" | "error" {
  switch (status) {
    case "blocked":
      return "warn";
    case "done":
      return "info";
    case "error":
      return "error";
  }
}

/** The most of a pane's title one notice carries: a banner is one line, and titles run long. */
const CLIP = 140;

/** Where it happened: the pane's own title, else its folder, else the pane by its id. */
export function where(pane: number, title: string | null | undefined, dir: string | null | undefined): string {
  const line = firstLine(title ?? "");
  if (line !== "") return clip(line);
  const folder = lastPart((dir ?? "").replace(/\/+$/, ""));
  if (folder !== "") return folder;
  return `Pane %${pane}`;
}

/** The first line of `text` that says something, trimmed. */
function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

/** The last part of a path (`~/Kitchen/pumi` is `pumi`); on Windows, of either separator. */
function lastPart(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/** `text` as one line of at most `CLIP` characters, an ellipsis where it was cut. */
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP - 1).trimEnd()}…`;
}

/**
 * Whether a state is news: not the one last told, or the same one again after `quiet` ms — an
 * agent that goes through `working` and back is told about each time, but not twice in a moment.
 */
export function news(
  status: string,
  last: { status: string; at: number } | undefined,
  now: number,
  quiet: number,
): boolean {
  if (!last) return true;
  return last.status !== status || now - last.at >= quiet;
}
