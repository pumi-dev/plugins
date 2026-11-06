// What a flight is, and the board's rules: which lane a card sits in, what dropping it on a lane
// does, and how a brief becomes the prompt an agent gets. No `pumi` import and no clock of its own:
// every rule here is a function of what it is given, so `bun test` reads it alone.
//
// The lanes are not the user's to file: a flight is in flight because its agent says it is working,
// holding because the agent blocked, failed or finished its turn, landed because someone landed it.
// The board is a mirror of the panes with a story to tell about them, not another inbox to keep.

export type Lane = "queued" | "flying" | "holding" | "landed";

/** What happens to a card when it is dropped on a lane. */
export type DropAction = "launch" | "fly" | "revive" | "take" | "park" | "land" | "close";

export const ACTION_LABEL: Record<DropAction, string> = {
  launch: "Start",
  fly: "Start again",
  revive: "Reopen",
  take: "Go to it",
  park: "Park",
  land: "Finish",
  close: "Close pane",
};

export type LogKind =
  | "filed"
  | "launched"
  | "messaged"
  | "turned"
  | "blocked"
  | "failed"
  | "done"
  | "parked"
  | "landed"
  | "revived"
  | "edited"
  | "orphaned";

export interface LogEntry {
  at: number;
  kind: LogKind;
  text: string;
}

/** One flight: a brief, the agent that flies it, and what the recorder remembers. */
export interface Flight {
  id: string;
  title: string;
  /** The prompt the agent gets: what the flight is for. */
  brief: string;
  /** Where the agent runs. Empty means wherever pumi would start one. */
  cwd: string;
  /** The command line of its agent; empty means the plugin's `agent` option. */
  agent: string;
  created: number;
  updated: number;
  /** The pane its agent is in, while one is. */
  pane: string | null;
  launchedAt: number | null;
  landedAt: number | null;
  /** Opening a pane, and waiting for the agent in it to take its first message. */
  launching: boolean;
  turns: number;
  launches: number;
  /** What the agent's screen last said of itself, for a card and a resume. */
  note: string;
  /** The flight recorder: the last handful of what happened, newest last. */
  log: LogEntry[];
}

export interface Board {
  version: 1;
  /** The number the next id takes. */
  seq: number;
  flights: Flight[];
}

export interface NewFlight {
  title?: string;
  brief: string;
  cwd?: string;
  agent?: string;
}

/** What the app knows of a flight's agent right now: the pane is there, and what it reported. */
export interface Live {
  alive: boolean;
  status?: string | null;
  /** How many messages wait for the agent. */
  queue?: number;
}

export interface Placement {
  lane: Lane;
  /** Why it is there, in a few words: what the card's chip says. */
  reason: string;
  /** The mark's colour, by the status the agent reported. */
  tone: Tone;
}

/** The colours a mark can take: a flight that has not started, and what an agent says it is doing. */
export type Tone = "queued" | "working" | "blocked" | "error" | "done" | "idle" | "landed";

/** What a lane needs to know of a card to place it: a flight's history, or a bare live pane's. */
export interface Facts {
  pane: string | null;
  launchedAt: number | null;
  landedAt: number | null;
  launching: boolean;
  launches: number;
}

/** How long a launched agent has to report anything before the board stops believing in it. */
export const WARMUP_MS = 120_000;

/** A recorder keeps this many entries; a title stops here. */
export const MAX_LOG = 48;
export const TITLE_MAX = 64;
export const NOTE_MAX = 200;

export function emptyBoard(): Board {
  return { version: 1, seq: 0, flights: [] };
}

// ── Words ────────────────────────────────────────────────────────────

/** `text` with its runs of whitespace as one space each. */
export function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A title for a flight: what was given, else its brief's first words. */
export function titleOf(brief: string, given?: string): string {
  const chosen = squash(given ?? "");
  if (chosen !== "") return clip(chosen, TITLE_MAX);
  const first = brief.split("\n").map(squash).find((line) => line !== "") ?? "";
  return first === "" ? "Untitled card" : clip(first, TITLE_MAX);
}

/** `text` at most `max` long, with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * A command line as the words it runs: whitespace splits, and `'…'`, `"…"` and a backslash keep
 * what they hold together. `pi --model "opus 5"` is `["pi", "--model", "opus 5"]`.
 */
export function commandLine(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | null = null;
  let holding = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote !== null) {
      if (char === "\\" && quote === '"' && i + 1 < line.length) {
        word += line[++i];
        holding = true;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      word += char;
      holding = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      holding = true;
      continue;
    }
    if (char === "\\" && i + 1 < line.length) {
      word += line[++i];
      holding = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (holding) {
        words.push(word);
        word = "";
        holding = false;
      }
      continue;
    }
    word += char;
    holding = true;
  }
  if (holding) words.push(word);
  return words;
}

/**
 * The last words of an agent's screen, as a card can show them: escape codes and the borders a TUI
 * draws come off, runs of whitespace close up, and the last lines that say anything are kept, up to
 * `limit` characters. It is a glance, not a transcript.
 */
export function excerpt(text: string, limit = NOTE_MAX): string {
  const lines = text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .split("\n")
    .map((line) => line.replace(/[│┃┌┐└┘─━╭╮╰╯╲╱▏▕▔▁]/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => /[A-Za-z0-9]/.test(line));
  const kept: string[] = [];
  let room = limit;
  for (let i = lines.length - 1; i >= 0 && kept.length < 3; i--) {
    if (lines[i].length > room) {
      if (kept.length === 0) kept.unshift(lines[i].slice(-room));
      break;
    }
    kept.unshift(lines[i]);
    room -= lines[i].length + 1;
  }
  return clip(kept.join(" "), limit);
}

/** `path` with the home directory as `~`. */
export function tilde(path: string, home: string): string {
  return home !== "" && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** The last part of a path, for a chip: `pumi` from `/Users/me/pumi`. */
export function folderOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("/");
  return at < 0 ? trimmed : trimmed.slice(at + 1) || "/";
}

/** `ms` as a stopwatch: `0:07`, `12:31`, `1:02:03`. */
export function stopwatch(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** How long ago `at` was, as a card says it: `now`, `4m`, `3h`, `2d`. */
export function ago(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < 45_000) return "now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

// ── The lanes ────────────────────────────────────────────────────────

/**
 * Where a flight is, from what its agent says. The agent is the authority: a flight is in flight
 * while it works, and holding the moment it blocks, fails or finishes a turn — which is exactly
 * when a person is wanted. A launched agent that has not said anything yet gets `WARMUP_MS` of
 * grace, so the card does not bounce through Holding on its way up.
 */
export function place(facts: Facts, live: Live, now: number): Placement {
  if (facts.landedAt !== null) return { lane: "landed", reason: "done", tone: "landed" };
  if (facts.pane === null) return { lane: "queued", reason: facts.launches > 0 ? "parked" : "not started", tone: "queued" };
  if (!live.alive) return { lane: "queued", reason: "agent gone", tone: "queued" };

  const queue = live.queue ?? 0;
  const status = live.status ?? null;
  const waiting = queue > 0 && status !== "blocked" && status !== "error";
  if (waiting) return { lane: "flying", reason: queue === 1 ? "message queued" : `${queue} queued`, tone: "working" };

  switch (status) {
    case "working":
      return { lane: "flying", reason: "working", tone: "working" };
    case "blocked":
      return { lane: "holding", reason: "needs you", tone: "blocked" };
    case "error":
      return { lane: "holding", reason: "failed", tone: "error" };
    case "done":
      return { lane: "holding", reason: "turn finished", tone: "done" };
    case "idle":
      return { lane: "holding", reason: "waiting on you", tone: "idle" };
    default:
      break;
  }
  // Nothing reported yet: a pane that just opened is still spinning up. One nobody launched here
  // (a pane that was already open) has nothing to spin up from: it is simply waiting.
  if (facts.launches === 0) return { lane: "holding", reason: "waiting on you", tone: "idle" };
  const since = facts.launchedAt === null ? Number.POSITIVE_INFINITY : now - facts.launchedAt;
  if (since < WARMUP_MS || facts.launching) return { lane: "flying", reason: "spinning up", tone: "working" };
  return { lane: "holding", reason: "no signal", tone: "idle" };
}

/** What dropping a card from `from` on `to` does, or null when the lane has nothing to offer it. */
export function dropAction(from: Lane, to: Lane): DropAction | null {
  if (from === to) return null;
  switch (to) {
    case "landed":
      return "land";
    case "queued":
      return from === "landed" ? "revive" : "park";
    case "flying":
      if (from === "queued") return "launch";
      if (from === "landed") return "fly";
      return "take";
    case "holding":
      return null;
  }
}

/**
 * What dropping a card on `to` does for the card it is: a flight has verbs of its own (launch,
 * park, land), while a pane nobody filed can only be gone to or closed — the board does not put
 * words in an agent's mouth that it did not write.
 */
export function dropActionFor(kind: "flight" | "agent", from: Lane, to: Lane): DropAction | null {
  if (kind === "flight") return dropAction(from, to);
  if (from === to) return null;
  if (to === "landed") return "close";
  if (to === "flying") return from === "queued" ? null : "take";
  return null;
}

/** The lanes, in the order the board draws them. */
export const LANES: readonly Lane[] = ["queued", "flying", "holding", "landed"];

/** How a lane orders its cards: what wants attention first. */
export function comparator(lane: Lane): (a: Flight, b: Flight) => number {
  return (a, b) => {
    if (lane === "landed") return (b.landedAt ?? 0) - (a.landedAt ?? 0);
    if (lane === "queued") return b.updated - a.updated;
    // In flight and holding: the one that has been there longest is nearest the top.
    return (a.launchedAt ?? a.created) - (b.launchedAt ?? b.created) || b.updated - a.updated;
  };
}

/** `flights` in the order a lane shows them. */
export function inLane(flights: Flight[], lane: Lane): Flight[] {
  return [...flights].sort(comparator(lane));
}

// ── The board ────────────────────────────────────────────────────────

export function fileFlight(board: Board, input: NewFlight, now: number): { board: Board; flight: Flight } {
  const seq = board.seq + 1;
  const flight: Flight = {
    id: `f${seq}`,
    title: titleOf(input.brief, input.title),
    brief: input.brief.trim(),
    cwd: (input.cwd ?? "").trim(),
    agent: (input.agent ?? "").trim(),
    created: now,
    updated: now,
    pane: null,
    launchedAt: null,
    landedAt: null,
    launching: false,
    turns: 0,
    launches: 0,
    note: "",
    log: [{ at: now, kind: "filed", text: "filed" }],
  };
  return { board: { ...board, seq, flights: [flight, ...board.flights] }, flight };
}

/** Adds `entry` to a flight's recorder, and says when it changed. */
export function record(flight: Flight, kind: LogKind, text: string, now = Date.now()): void {
  flight.log = [...flight.log, { at: now, kind, text }].slice(-MAX_LOG);
  flight.updated = now;
}

/** The board without `id`. */
export function forget(board: Board, id: string): Board {
  return { ...board, flights: board.flights.filter((flight) => flight.id !== id) };
}

/** The board with only its `keep` most recent landed flights (the rest are gone, not landed twice). */
export function trimLanded(board: Board, keep: number): Board {
  const landed = board.flights.filter((flight) => flight.landedAt !== null).sort((a, b) => (b.landedAt ?? 0) - (a.landedAt ?? 0));
  const drop = new Set(landed.slice(Math.max(0, keep)).map((flight) => flight.id));
  if (drop.size === 0) return board;
  return { ...board, flights: board.flights.filter((flight) => !drop.has(flight.id)) };
}

/** The prompt a launch sends: the brief, and — when it is not the first flight — where the last one stopped. */
export function promptFor(flight: Flight, again: boolean): string {
  const brief = flight.brief.trim();
  if (!again || flight.note.trim() === "") return brief;
  return `${brief}\n\nWhere the last attempt left off: ${flight.note.trim()}\n\nTake it from there.`;
}

// ── Reading what the disk kept ───────────────────────────────────────

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function time(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** A stored flight, as a flight: what is missing gets what it had when it was made. */
function parseFlight(value: unknown, at: number): Flight | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id);
  if (id === "") return null;
  const log: LogEntry[] = Array.isArray(raw.log)
    ? raw.log.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const one = entry as Record<string, unknown>;
        return [{ at: time(one.at) ?? at, kind: (text(one.kind) || "filed") as LogKind, text: text(one.text) }];
      })
    : [];
  return {
    id,
    title: text(raw.title, "Untitled card"),
    brief: text(raw.brief),
    cwd: text(raw.cwd),
    agent: text(raw.agent),
    created: time(raw.created) ?? at,
    updated: time(raw.updated) ?? at,
    pane: text(raw.pane) || null,
    launchedAt: time(raw.launchedAt),
    landedAt: time(raw.landedAt),
    launching: false,
    turns: typeof raw.turns === "number" ? raw.turns : 0,
    launches: typeof raw.launches === "number" ? raw.launches : 0,
    note: text(raw.note),
    log,
  };
}

/** What was saved, or null when it is not a board at all. */
export function parseBoard(text: string): Board | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const now = Date.now();
  const flights = Array.isArray(raw.flights) ? raw.flights.map((flight) => parseFlight(flight, now)).filter((flight): flight is Flight => flight !== null) : [];
  // The next id must not be one a card already has, even if `seq` was lost or behind.
  const used = flights.reduce((highest, flight) => {
    const at = /^f(\d+)$/.exec(flight.id);
    return at === null ? highest : Math.max(highest, Number(at[1]));
  }, 0);
  const seq = Math.max(typeof raw.seq === "number" && Number.isFinite(raw.seq) ? raw.seq : 0, used, flights.length);
  return { version: 1, seq, flights };
}
