// The board's engine: the flights it has filed, the panes their agents are in, and the small set of
// verbs a card has (launch, park, land, revive, message). Nothing here draws: `src/ui.tsx` draws the
// lanes and calls these as async exports, and hears the new board on the `board` channel.
//
// The division of labour is the point. A flight is the user's intent and outlives its pane; the
// lane a card is in is never written down, it is read from what the agent in the pane reports (its
// `@agent.status`), so the board cannot disagree with the agents on it. What is written down is the
// brief, the recorder, and the pane: `paths.state/flights.json`, squeezed through `flight.ts`.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { call, fn, menu, on, option, paths, request, self, ui, type Pane } from "pumi";

import {
  clip,
  commandLine,
  emptyBoard,
  excerpt,
  fileFlight as addFlight,
  forget,
  parseBoard,
  promptFor,
  record,
  squash,
  trimLanded,
  type Board,
  type Flight,
  type NewFlight,
} from "./flight.ts";

/** The pane an agent opens with, and how the board hears about it. */
type Settings = {
  agent: string;
  open: "beside" | "tab";
  close: boolean;
  notify: boolean;
  keep: number;
};

let cfg: Settings = { agent: "pi", open: "beside", close: true, notify: true, keep: 24 };
let board: Board = emptyBoard();
let booted: Promise<void> | null = null;
let saving: ReturnType<typeof setTimeout> | undefined;
/** What each flight's agent last reported, so a status that stays put is not announced twice. */
const seen = new Map<string, string>();
const announced = new Map<string, number>();

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function note(text: string): string {
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/** What an error says, for a card or a notice. */
function told(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── What the disk keeps ──────────────────────────────────────────────

const stateFile = () => join(paths.state, "flights.json");

async function readBoard(): Promise<Board> {
  try {
    return parseBoard(await readFile(stateFile(), "utf8")) ?? emptyBoard();
  } catch {
    return emptyBoard();
  }
}

function save(): void {
  clearTimeout(saving);
  saving = setTimeout(() => void write(), 160);
}

async function write(): Promise<void> {
  try {
    await mkdir(paths.state, { recursive: true });
    const target = stateFile();
    await writeFile(`${target}.tmp`, JSON.stringify(board, null, 0));
    await rename(`${target}.tmp`, target);
  } catch (err) {
    console.error(`kanban: saving the board: ${told(err)}`);
  }
}

/** The board as its views read it. */
export interface Snapshot {
  flights: Flight[];
  at: number;
}

function snapshot(): Snapshot {
  return { flights: board.flights, at: Date.now() };
}

function post(): void {
  ui.post("board", snapshot());
}

/** A notice for the board's own footer: a launch that failed says why there, where the user is. */
function notice(text: string, level: "info" | "error" = "info"): void {
  ui.post("notice", { text, level, at: Date.now() });
}

function find(id: string): Flight | undefined {
  return board.flights.find((flight) => flight.id === id);
}

function ofPane(pane: string | null | undefined): Flight | undefined {
  if (!pane) return undefined;
  return board.flights.find((flight) => flight.pane === pane);
}

// ── The pane, as the server has it ───────────────────────────────────

async function getPane(id: string): Promise<Pane | null> {
  try {
    // The call answers the pane's data; the model over it is what has its traits in one place.
    return (await call("pane.get", id)) as unknown as Pane;
  } catch {
    return null;
  }
}

/** The last lines of a pane's screen, as a card can show them. */
async function readScreen(pane: string, lines = 30): Promise<string> {
  try {
    const read = (await call("pane.call", pane, "read", { source: "recent", lines })) as { text?: string } | undefined;
    return excerpt(read?.text ?? "");
  } catch {
    return "";
  }
}

async function closePane(pane: string): Promise<void> {
  try {
    await call("pane.close", pane);
  } catch {
    // It was already gone: an agent that quit closed it itself.
  }
}

// ── Options ──────────────────────────────────────────────────────────

async function readOption<T>(name: string, fallback: T): Promise<T> {
  try {
    const value = await option.get(name);
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

async function readSettings(): Promise<void> {
  const [agent, open, close, notify, keep] = await Promise.all([
    readOption("agent", "pi"),
    readOption("open", "beside"),
    readOption("close_on_land", true),
    readOption("notify", true),
    readOption("keep_landed", 24),
  ]);
  cfg = {
    agent: String(agent || "pi").trim(),
    open: open === "tab" ? "tab" : "beside",
    close: close !== false,
    notify: notify !== false,
    keep: typeof keep === "number" && Number.isFinite(keep) ? Math.max(0, keep) : 24,
  };
}

// ── Booting ──────────────────────────────────────────────────────────

/** Reads what was saved, and forgets the panes that are gone (the app was quit, or they were closed). */
async function boot(): Promise<void> {
  board = await readBoard();
  await readSettings();
  let changed = false;
  for (const flight of board.flights) {
    if (flight.launching) {
      flight.launching = false;
      changed = true;
    }
    if (flight.pane !== null && (await getPane(flight.pane)) === null) {
      flight.pane = null;
      flight.launchedAt = null;
      record(flight, "orphaned", "its pane is gone");
      changed = true;
    }
  }
  await bindKey();
  if (changed) save();
  post();
}

/** Once: everything the board reads before it answers a call. */
function bootOnce(): Promise<void> {
  return (booted ??= boot().catch((err) => {
    booted = null;
    console.error(`kanban: starting: ${told(err)}`);
    throw err;
  }));
}

/** The board as its views read it, once it is up. */
export async function load(): Promise<Snapshot> {
  await bootOnce();
  return snapshot();
}

// ── Where an agent goes ──────────────────────────────────────────────

function placeFor(beside: string | null | undefined, flight: Flight): Record<string, unknown> {
  if (cfg.open === "tab" || !beside) {
    return cfg.open === "tab" ? { kind: "tab", name: flight.title } : { kind: "tiled", split: "right", size: "46%" };
  }
  return { kind: "tiled", split: "right", size: "46%", beside };
}

/**
 * Gets `text` to the agent in `pane`: queued if it takes queued messages (which it takes at the end
 * of a turn, so nothing interrupts it), typed in if it does not. The agent's hooks take a moment to
 * announce themselves in a pane that just opened, so this waits for them.
 */
async function deliver(pane: string, text: string): Promise<"queued" | "typed" | "lost"> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const live = await getPane(pane);
    if (!live) return "lost";
    const agent = (live.traits as { agent?: { accepts?: string[] } } | undefined)?.agent;
    if (agent) {
      if (Array.isArray(agent.accepts) && !agent.accepts.includes("queue")) break;
      try {
        await call("agent.queue", pane, text, { from: "kanban" });
        return "queued";
      } catch {
        // Its hooks say queue, but the agent is not ready for one yet: wait and ask again.
      }
    }
    await sleep(700);
  }
  try {
    await call("pane.call", pane, "run", { command: text });
    return "typed";
  } catch {
    return "lost";
  }
}

// ── The verbs ────────────────────────────────────────────────────────

/** Files a flight; `launch` starts its agent straight away. */
export async function file(input: NewFlight & { launch?: boolean }): Promise<Snapshot> {
  await bootOnce();
  if (squash(input.brief ?? "") === "") {
    notice("A card needs a brief: what should the agent do?", "error");
    return snapshot();
  }
  const made = addFlight(board, input, Date.now());
  board = made.board;
  post();
  save();
  if (input.launch) return launch(made.flight.id);
  return snapshot();
}

/**
 * Opens the flight's agent in a pane of its own and sends it the brief. `beside` is the pane it
 * splits (the board's own, when its view calls this), so the agent opens next to the board.
 */
export async function launch(id: string, opts: { beside?: string | null } = {}): Promise<Snapshot> {
  await bootOnce();
  const flight = find(id);
  if (!flight) return snapshot();
  if (flight.pane !== null) {
    await focus(id);
    return snapshot();
  }
  const chosen = (flight.agent || cfg.agent || "pi").trim();
  const argv = commandLine(chosen);
  if (argv.length === 0) {
    notice("No agent to launch: give the card a command, or set one in Settings → Kanban.", "error");
    return snapshot();
  }
  flight.launching = true;
  record(flight, "launched", `starting ${argv[0]}`);
  post();
  let pane: string;
  try {
    pane = await call("pane.open", [
      "terminal",
      { command: argv, ...(flight.cwd === "" ? {} : { cwd: flight.cwd }) },
      placeFor(opts.beside ?? null, flight),
    ]);
    await call("pane.update", [pane, { title: flight.title }]).catch(() => {});
  } catch (err) {
    flight.launching = false;
    record(flight, "failed", note(told(err)));
    notice(`Could not open a pane for “${flight.title}”: ${told(err)}`, "error");
    post();
    save();
    return snapshot();
  }
  const again = flight.launches > 0;
  flight.pane = pane;
  flight.launchedAt = Date.now();
  flight.launches += 1;
  flight.launching = false;
  seen.delete(flight.id);
  post();
  save();
  void deliver(pane, promptFor(flight, again)).then((how) => {
    const log = how === "queued" ? "brief queued for the agent" : how === "typed" ? "brief typed into the pane" : "the agent never took the brief";
    record(flight, how === "lost" ? "failed" : "messaged", log);
    if (how === "lost") notice(`“${flight.title}” opened, but its agent never took the brief. It is in the pane, waiting.`, "error");
    post();
    save();
  });
  return snapshot();
}

/** Stops the flight's agent and puts the card back in Queued, its brief and note kept. */
export async function park(id: string): Promise<Snapshot> {
  await bootOnce();
  const flight = find(id);
  if (!flight || flight.pane === null) return snapshot();
  const pane = flight.pane;
  const last = await readScreen(pane);
  if (last !== "") flight.note = last;
  flight.pane = null;
  flight.launchedAt = null;
  flight.launching = false;
  flight.landedAt = null;
  seen.delete(flight.id);
  record(flight, "parked", "parked");
  post();
  save();
  await closePane(pane);
  post();
  return snapshot();
}

/** Files the flight as landed, closing its agent, and keeps the board to `keep_landed` cards. */
export async function land(id: string): Promise<Snapshot> {
  await bootOnce();
  const flight = find(id);
  if (!flight || flight.landedAt !== null) return snapshot();
  if (flight.pane !== null) {
    const last = await readScreen(flight.pane);
    if (last !== "") flight.note = last;
  }
  const pane = flight.pane;
  flight.pane = null;
  flight.launchedAt = null;
  flight.launching = false;
  flight.landedAt = Date.now();
  seen.delete(flight.id);
  record(flight, "landed", "landed");
  board = trimLanded(board, cfg.keep);
  post();
  save();
  if (pane !== null && cfg.close) await closePane(pane);
  return snapshot();
}

/** Takes a landed flight back to Queued: its brief and note are intact, its agent is not. */
export async function revive(id: string): Promise<Snapshot> {
  await bootOnce();
  const flight = find(id);
  if (!flight || flight.landedAt === null) return snapshot();
  flight.landedAt = null;
  flight.pane = null;
  flight.launchedAt = null;
  record(flight, "revived", "back in the queue");
  post();
  save();
  return snapshot();
}

/** Sends `text` to the flight's agent, queued at the end of its turn when it takes queued messages. */
export async function message(id: string, text: string): Promise<Snapshot> {
  await bootOnce();
  const flight = find(id);
  const body = text.trim();
  if (body === "") return snapshot();
  const pane = paneFor(id);
  if (pane === null) {
    notice("That card is not running: start it first.", "error");
    return snapshot();
  }
  const how = await deliver(pane, body);
  if (flight !== undefined) {
    record(flight, how === "lost" ? "failed" : "messaged", how === "lost" ? "the message did not go" : clip(squash(body), 80));
  }
  if (how === "lost") notice("The agent did not take that message.", "error");
  post();
  save();
  return snapshot();
}

/**
 * The pane a card is about: a flight's agent, or — for a live agent nobody filed — its own pane,
 * which the board names by the id it was handed.
 */
function paneFor(id: string): string | null {
  const flight = find(id);
  return flight === undefined ? id : flight.pane;
}

/** Goes to the card's pane, as pumi names it. */
export async function focus(id: string): Promise<Snapshot> {
  await bootOnce();
  const pane = paneFor(id);
  if (pane !== null) {
    try {
      await call("pane.focus", pane);
    } catch (err) {
      notice(`Its pane is gone: ${told(err)}`, "error");
    }
  }
  return snapshot();
}

/** Closes the pane of an agent nobody filed: what the board's Landed lane does with one. */
export async function closeAgent(id: string): Promise<Snapshot> {
  await bootOnce();
  if (find(id) !== undefined) {
    notice("That is a card: finish it instead, so the board keeps the brief.", "error");
    return snapshot();
  }
  const pane = paneFor(id);
  if (pane !== null) await closePane(pane);
  return snapshot();
}

/** Drops the flight from the board, and closes its agent if one is up. */
export async function remove(id: string): Promise<Snapshot> {
  await bootOnce();
  const flight = find(id);
  if (!flight) return snapshot();
  const pane = flight.pane;
  board = forget(board, id);
  seen.delete(id);
  post();
  save();
  if (pane !== null) await closePane(pane);
  return snapshot();
}

/** Edits a flight's own words: its title, brief, folder and agent. */
export async function update(id: string, patch: { title?: string; brief?: string; cwd?: string; agent?: string }): Promise<Snapshot> {
  await bootOnce();
  const flight = find(id);
  if (!flight) return snapshot();
  if (typeof patch.title === "string" && squash(patch.title) !== "") flight.title = clip(squash(patch.title), 64);
  if (typeof patch.brief === "string" && squash(patch.brief) !== "") flight.brief = patch.brief.trim();
  if (typeof patch.cwd === "string") flight.cwd = patch.cwd.trim();
  if (typeof patch.agent === "string") flight.agent = patch.agent.trim();
  record(flight, "edited", "edited");
  post();
  save();
  return snapshot();
}

/** The last lines of a flight's agent screen, for the inspector's peek. */
export async function screen(id: string): Promise<string> {
  await bootOnce();
  const pane = paneFor(id);
  return pane === null ? "" : readScreen(pane, 40);
}

/** Removes every landed card. */
export async function clear(): Promise<Snapshot> {
  await bootOnce();
  const landed = board.flights.filter((flight) => flight.landedAt !== null).length;
  board = { ...board, flights: board.flights.filter((flight) => flight.landedAt === null) };
  notice(landed === 0 ? "No finished cards to clear." : `Cleared ${landed} finished ${landed === 1 ? "card" : "cards"}.`);
  post();
  save();
  return snapshot();
}

// ── Watching the agents ──────────────────────────────────────────────

const pending = new Set<string>();
let syncing: ReturnType<typeof setTimeout> | undefined;

/** Reads a bound agent's status after the pane settles: one read per burst of changes. */
function schedule(pane: string): void {
  pending.add(pane);
  clearTimeout(syncing);
  syncing = setTimeout(() => {
    const panes = [...pending];
    pending.clear();
    void Promise.all(panes.map((id) => sync(id)));
  }, 350);
}

/**
 * What the agent in `pane` says it is doing, and what that means for the card: a block, a failure
 * or a finished turn is worth remembering (the screen's last words) and worth saying out loud.
 */
async function sync(pane: string): Promise<void> {
  const flight = ofPane(pane);
  if (!flight) return;
  const live = await getPane(pane);
  if (!live) {
    orphan(pane);
    return;
  }
  const agent = (live.traits as { agent?: { status?: string } } | undefined)?.agent;
  const status = typeof agent?.status === "string" ? agent.status : "";
  if ((seen.get(flight.id) ?? "") === status) return;
  seen.set(flight.id, status);
  if (status !== "blocked" && status !== "error" && status !== "done") return;
  const words = await readScreen(pane, 30);
  if (words !== "") flight.note = words;
  if (status !== "done") record(flight, status === "blocked" ? "blocked" : "failed", status === "blocked" ? "needs you" : "failed");
  announce(flight, status);
  post();
  save();
}

/** A pane a flight was in is gone: the card goes back to Queued, keeping what it knew. */
function orphan(pane: string): void {
  const flight = ofPane(pane);
  if (!flight) return;
  flight.pane = null;
  flight.launchedAt = null;
  flight.launching = false;
  seen.delete(flight.id);
  record(flight, "orphaned", "its pane closed");
  post();
  save();
}

function announce(flight: Flight, status: string): void {
  if (!cfg.notify) return;
  const now = Date.now();
  if (now - (announced.get(flight.id) ?? 0) < 5000) return;
  announced.set(flight.id, now);
  const why = status === "blocked" ? "needs you" : status === "error" ? "failed" : "finished its turn";
  void request
    .open({
      kind: "notification",
      title: flight.title,
      detail: `The agent ${why}.`,
      level: status === "error" ? "error" : "info",
      notification: { group: `kanban-${flight.id}`, sound: "default" },
    })
    .catch(() => {});
}

// One subscription each, registered once: the worker starts with the app (`activation`).
on("pane.changed", (e) => {
  if (e.pane && ofPane(e.pane)) schedule(e.pane);
});
on("pane.closed", (e) => {
  if (e.pane) orphan(e.pane);
});
on("agent.turned", (e) => {
  const flight = ofPane(e.pane);
  if (!flight) return;
  flight.turns += 1;
  const what = typeof (e.data as { event?: unknown } | undefined)?.event === "string" ? (e.data as { event: string }).event : "done";
  record(flight, "turned", `turn ${flight.turns} · ${what}`);
  post();
  save();
  void readScreen(e.pane!, 30).then((words) => {
    if (words === "" || flight.pane === null) return;
    flight.note = words;
    post();
    save();
  });
});

// ── The commands ─────────────────────────────────────────────────────

/**
 * The option that says the board is up (`shown` in the plugin's own store): its `window.overlay`
 * view is drawn by the theme over the whole window while it is set, so the board is no pane at all —
 * nothing is split, no tab is made, and the side bar's own button is what puts it there.
 */
const SHOWN = "shown";

/** Puts the board over the window (`true`), or takes it away (`false`). */
export async function show(up: boolean): Promise<Snapshot> {
  await bootOnce();
  await option.set(SHOWN, up);
  return snapshot();
}

/** Opens the board over the window, from the palette, a key, or the side bar's button. */
export async function openBoard(): Promise<boolean> {
  try {
    await show(true);
    return true;
  } catch (err) {
    notice(`Could not open the board: ${told(err)}`, "error");
    return false;
  }
}

/** Takes the board away: Escape, a press outside it, or its close button. */
export async function hide(): Promise<Snapshot> {
  return show(false);
}

/**
 * The board's view says it drew: a timestamp in the plugin's store. It is how the board is known to
 * be up without a pane to read — `pumi call option.get drawn '{"scope":"plugin","plugin":"amresyd/kanban"}'`.
 */
export async function drawn(): Promise<null> {
  await option.set("drawn", Date.now());
  return null;
}

/**
 * Goes to a card's agent — what a click on a card does: a flight with no pane launches first, a
 * live pane is focused as it is, and the board closes on the way, so the pane the click was about
 * is the one left in front.
 */
export async function go(id: string): Promise<Snapshot> {
  await bootOnce();
  const flight = find(id);
  if (flight !== undefined && flight.pane === null) {
    await launch(id);
  } else {
    await focus(id);
  }
  await option.set(SHOWN, false);
  return snapshot();
}

/** Opens the board with the composer up, for a flight that is not written yet. */
export async function compose(): Promise<boolean> {
  const opened = await openBoard();
  if (opened) ui.post("compose", { at: Date.now() });
  return opened;
}

fn.set(
  "open",
  { desc: "Open the Kanban board over the window.", effect: "read" },
  () => openBoard(),
);

fn.set(
  "go",
  {
    desc: "Go to a card's agent, closing the board on the way.",
    paramsSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  (id: string) => go(id),
);

fn.set(
  "hide",
  { desc: "Take the board away.", effect: "read" },
  () => hide(),
);

fn.set(
  "new",
  { desc: "Open the board with a new card's composer up.", effect: "read" },
  () => compose(),
);

fn.set(
  "list",
  {
    desc: "Every card on the board, with the lane it is in.",
    effect: "read",
    paramsSchema: { type: "object", properties: {} },
    returnsSchema: { type: "object", properties: { flights: { type: "array" }, at: { type: "number" } } },
  },
  async () => {
    await bootOnce();
    return snapshot();
  },
);

fn.set(
  "create",
  {
    desc: "Add a card: a brief, and the agent that should take it.",
    paramsSchema: {
      type: "object",
      properties: {
        brief: { type: "string", description: "What the agent should do: its first message." },
        title: { type: "string", description: "The card's title; the brief's first words without one." },
        cwd: { type: "string", description: "The folder the agent starts in." },
        agent: { type: "string", description: "Its command line; the `agent` option without one." },
        launch: { type: "boolean", description: "Open the agent and send it the brief now." },
      },
      required: ["brief"],
    },
  },
  (brief: string, title?: string, cwd?: string, agent?: string, launch?: boolean) => file({ brief, title, cwd, agent, launch }),
);

fn.set(
  "launch",
  {
    desc: "Start a card: open its agent in a pane and send it the brief.",
    paramsSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The flight's id (`f3`)." },
        beside: { type: "string", description: "The pane to split; the caller's own without one." },
      },
      required: ["id"],
    },
  },
  (id: string, beside?: string) => launch(id, { beside }),
);

fn.set(
  "land",
  {
    desc: "Finish a card: close its agent and file it as done.",
    paramsSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  (id: string) => land(id),
);

fn.set(
  "park",
  {
    desc: "Park a card: stop its agent and put it back in Queued.",
    paramsSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  (id: string) => park(id),
);

fn.set(
  "revive",
  {
    desc: "Take a finished card back to Queued.",
    paramsSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  (id: string) => revive(id),
);

fn.set(
  "message",
  {
    desc: "Send a message to a card's agent, queued for the end of its turn.",
    paramsSchema: {
      type: "object",
      properties: { id: { type: "string" }, text: { type: "string" } },
      required: ["id", "text"],
    },
  },
  (id: string, text: string) => message(id, text),
);

fn.set(
  "remove",
  {
    desc: "Remove a card from the board, closing its agent.",
    paramsSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  (id: string) => remove(id),
);

fn.set(
  "close",
  {
    desc: "Close a live agent's pane, for an agent the board shows but nobody filed.",
    paramsSchema: { type: "object", properties: { id: { type: "string", description: "Its pane (`%12`)." } }, required: ["id"] },
  },
  (id: string) => closeAgent(id),
);

fn.set(
  "clear",
  { desc: "Remove every finished card from the board.", effect: "read" },
  () => clear(),
);

menu.set("View.Kanban", { fn: self.plugin.prefixed("open"), title: "Kanban" });

// The chord follows its option, as the rest of the board follows theirs.
let bound: string | null = null;
type KeyTable = Record<string, unknown>;

async function bindKey(): Promise<void> {
  const chosen = await readOption("key", "");
  const chord = typeof chosen === "string" ? chosen.trim() : "";
  if (bound === chord) return;
  try {
    const keys = ((await option.get("keys", { scope: "global" })) ?? {}) as KeyTable;
    const root = { ...((keys["root"] ?? {}) as KeyTable) };
    if (bound !== null) delete root[bound];
    if (chord !== "") root[chord] = { call: self.plugin.prefixed("open") };
    await option.set("keys", { ...keys, root }, { scope: "global" });
    bound = chord === "" ? null : chord;
  } catch (err) {
    console.error(`kanban: binding the key: ${told(err)}`);
  }
}

on("option.changed", { match: `${self.plugin.prefix}*` }, () => {
  void readSettings().then(() => bindKey()).catch(() => {});
});
