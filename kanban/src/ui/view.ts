// What the board shows of a lane, and of a card in it: the words, and which cards a search keeps.
// No `pumi` import: this is the part of the drawing `bun test` can read.
//
// A card is either a flight (something was filed, and there may be an agent on it) or a live agent
// pane nobody filed: the board shows every agent pumi has, so an agent started in a terminal is on
// it too, in the lane its own status puts it in.
import { comparator, squash, type Flight, type Lane, type Placement, type Tone } from "../flight.ts";

/** One card, as the board draws it. A flight's own words, or a live pane's. */
export interface CardView {
  /** A flight's id (`f3`), or a live agent's pane (`%12`). */
  id: string;
  kind: "flight" | "agent";
  title: string;
  brief: string;
  cwd: string;
  /** The command a flight's agent starts with, or the name a live agent reports (`pi`). */
  agent: string;
  /** What the agent's screen last said, for a card and a resume. */
  note: string;
  turns: number;
  pane: string | null;
  /** The flight this card files, when it files one. */
  flight?: Flight;
  place: Placement;
  alive: boolean;
  queue: number;
  status: string | null;
  /** The agent's own model, when it reports one. */
  model: string | null;
}

export const LANE_TITLE: Record<Lane, string> = {
  queued: "Queued",
  flying: "In progress",
  holding: "Needs you",
  landed: "Done",
};

/** What a lane is for, said under its name while it is empty. */
export const LANE_EMPTY: Record<Lane, string> = {
  queued: "Cards with no agent yet. Drop one in In progress to start it.",
  flying: "Agents at work — the cards you added, and every other agent pumi is running.",
  holding: "Blocked, failed, finished its turn, or waiting on you. Where you are wanted.",
  landed: "Cards that are done. Drop a card here to finish it, or an agent to close its pane.",
};

/** What dropping a card on the lane does, when it can do anything at all. */
export const LANE_DROP: Record<Lane, string> = {
  queued: "Drop to park",
  flying: "Drop to start",
  holding: "No drop here",
  landed: "Drop to finish",
};

export const EMPTY_BOARD =
  "No agents yet. A card is a brief: an agent picks it up in a pane of its own, and this board follows it — and every other agent pumi is running — from here.";

/** Whether a card says `query` anywhere a person would look for it. */
export function shows(card: CardView, query: string): boolean {
  const wanted = squash(query).toLowerCase();
  if (wanted === "") return true;
  const haystack = `${card.title} ${card.brief} ${card.cwd} ${card.agent}`.toLowerCase();
  return wanted.split(" ").every((word) => haystack.includes(word));
}

/**
 * A pane's title with the agent's mark and the folder taken off: `π - Fix the tests - pumi` is
 * `Fix the tests`, which is what a card has room for. The mark is the short first part (`π`), and
 * the folder is whatever the pane's own directory is called — a title can be just the folder,
 * which is then the best name there is.
 */
export function agentTitle(title: string, folder = "", agent = ""): string {
  const parts = squash(title).split(" - ");
  const mark = parts[0] ?? "";
  const marked =
    parts.length >= 2 &&
    ((agent !== "" && mark.toLowerCase() === agent.toLowerCase()) || /[^\x20-\x7e]/.test(mark) || (parts.length >= 3 && mark.length <= 3));
  const from = marked ? 1 : 0;
  const last = parts.length - from >= 2 && folder !== "" && parts[parts.length - 1].toLowerCase() === folder.toLowerCase() ? parts.length - 1 : parts.length;
  const name = parts.slice(from, last).join(" - ");
  if (name !== "") return name;
  return folder !== "" ? folder : (parts[from] ?? title);
}

export interface Counts {
  queued: number;
  flying: number;
  /** Blocked or failed: the agents that will not go on without a person. */
  needs: number;
  /** Done with a turn, idle, or a pane nobody is tracking: the ones waiting on you. */
  waiting: number;
  landed: number;
  turns: number;
}

export function countOf(cards: CardView[]): Counts {
  const counts: Counts = { queued: 0, flying: 0, needs: 0, waiting: 0, landed: 0, turns: 0 };
  for (const card of cards) {
    if (card.place.lane === "flying") counts.flying += 1;
    else if (card.place.lane === "queued") counts.queued += 1;
    else if (card.place.lane === "landed") counts.landed += 1;
    else if (card.place.tone === "blocked" || card.place.tone === "error") counts.needs += 1;
    else counts.waiting += 1;
    counts.turns += card.turns;
  }
  return counts;
}

/** The cards by lane, each lane in its own order, with `query` applied. */
export function arrange(cards: CardView[], query: string): Record<Lane, CardView[]> {
  const shown = cards.filter((card) => shows(card, query));
  const lanes: Record<Lane, CardView[]> = { queued: [], flying: [], holding: [], landed: [] };
  for (const lane of Object.keys(lanes) as Lane[]) {
    lanes[lane] = shown
      .filter((card) => card.place.lane === lane)
      .sort((a, b) => (a.flight !== undefined && b.flight !== undefined ? comparator(lane)(a.flight, b.flight) : a.title.localeCompare(b.title)));
  }
  return lanes;
}

/** The colour a lane's dot and edge take: the loudest thing in it. */
export function laneTone(lane: Lane, cards: CardView[]): Tone {
  if (lane === "queued") return "queued";
  if (lane === "flying") return "working";
  if (lane === "landed") return "landed";
  const tones = cards.map((card) => card.place.tone);
  if (tones.includes("error")) return "error";
  if (tones.includes("blocked")) return "blocked";
  if (tones.includes("done")) return "done";
  return "idle";
}

/** How long a card has been doing what it is doing, for its stopwatch; null when nothing counts. */
export function since(card: CardView, now: number): number | null {
  const flight = card.flight;
  if (flight === undefined) return null;
  if (card.place.lane === "landed") return flight.landedAt === null ? null : now - flight.landedAt;
  return flight.launchedAt === null ? null : now - flight.launchedAt;
}
