// What the board promises, read without pumi: a card's lane follows its agent, a drop says what it
// will do, and a brief survives the disk. `bun test` in this package runs it.
import { describe, expect, test } from "bun:test";

import {
  ago,
  commandLine,
  dropAction,
  dropActionFor,
  emptyBoard,
  excerpt,
  fileFlight,
  forget,
  inLane,
  parseBoard,
  place,
  promptFor,
  record,
  stopwatch,
  titleOf,
  trimLanded,
  type Flight,
  type Live,
} from "../src/flight.ts";
import { agentTitle, arrange, countOf, laneTone, shows, type CardView } from "../src/ui/view.ts";

const NOW = 1_700_000_000_000;

function flying(over: Partial<Flight> = {}): Flight {
  return {
    id: "f1",
    title: "Fix the login redirect",
    brief: "Fix the login redirect after the OAuth callback.",
    cwd: "/Users/me/app",
    agent: "pi",
    created: NOW - 60_000,
    updated: NOW - 60_000,
    pane: "%3",
    launchedAt: NOW - 30_000,
    landedAt: null,
    launching: false,
    turns: 0,
    launches: 1,
    note: "",
    log: [],
    ...over,
  };
}

const live = (over: Partial<Live> = {}): Live => ({ alive: true, status: null, queue: 0, ...over });

/** A flight's card, and a live pane's card for an agent nobody filed. */
function card(over: Partial<Flight> = {}, status: string | null = "working"): CardView {
  const flight = flying(over);
  return {
    id: flight.id,
    kind: "flight",
    title: flight.title,
    brief: flight.brief,
    cwd: flight.cwd,
    agent: flight.agent,
    note: flight.note,
    turns: flight.turns,
    pane: flight.pane,
    flight,
    place: place(flight, live({ status }), NOW),
    alive: flight.pane !== null,
    queue: 0,
    status,
    model: null,
  };
}

function loose(status: string | null = "idle"): CardView {
  const facts = { pane: "%9", launchedAt: null, landedAt: null, launching: false, launches: 0 };
  return {
    id: "%9",
    kind: "agent",
    title: "Rotating Kiro keys",
    brief: "",
    cwd: "/Users/me/mpx",
    agent: "pi",
    note: "",
    turns: 0,
    pane: "%9",
    place: place(facts, live({ status }), NOW),
    alive: true,
    queue: 0,
    status,
    model: "claude-opus-5",
  };
}

describe("commandLine", () => {
  test("splits on whitespace", () => {
    expect(commandLine("pi --model opus")).toEqual(["pi", "--model", "opus"]);
  });

  test("keeps a quoted word together, and drops the quotes", () => {
    expect(commandLine(`pi --model "opus 5" --name 'a b'`)).toEqual(["pi", "--model", "opus 5", "--name", "a b"]);
  });

  test("a backslash keeps the next character, and an empty quote is a word", () => {
    expect(commandLine(`echo a\\ b ""`)).toEqual(["echo", "a b", ""]);
  });

  test("nothing is no words", () => {
    expect(commandLine("   ")).toEqual([]);
  });
});

describe("titleOf", () => {
  test("the brief's first words when nothing better is given", () => {
    expect(titleOf("\n  Fix the login redirect\nand its tests")).toBe("Fix the login redirect");
  });

  test("a given title wins, cut to length", () => {
    expect(titleOf("brief", "  A title  ")).toBe("A title");
    expect(titleOf("brief", "x".repeat(80))).toHaveLength(64);
  });

  test("an empty brief is still a card", () => {
    expect(titleOf("   ")).toBe("Untitled card");
  });
});

describe("excerpt", () => {
  test("takes the borders off a TUI and keeps the words", () => {
    const screen = "╭──────────────╮\n│ Tests pass   │\n╰──────────────╯\n\n$ ";
    expect(excerpt(screen)).toBe("Tests pass");
  });

  test("keeps the end, up to the limit", () => {
    const screen = ["one two", "three four", "five six", "seven eight"].join("\n");
    expect(excerpt(screen, 20)).toBe("five six seven eight");
  });
});

describe("place", () => {
  test("a landed flight is landed, whatever its pane says", () => {
    expect(place(flying({ landedAt: NOW, pane: null }), live({ status: "working" }), NOW).lane).toBe("landed");
  });

  test("no pane is queued", () => {
    expect(place(flying({ pane: null, launchedAt: null, launches: 0 }), live({ alive: false }), NOW)).toEqual({ lane: "queued", reason: "not started", tone: "queued" });
    expect(place(flying({ pane: null }), live({ alive: false }), NOW).reason).toBe("parked");
  });

  test("a window the agent left is queued, not lost", () => {
    expect(place(flying(), live({ alive: false }), NOW).lane).toBe("queued");
  });

  test("what the agent reports is what the lane says", () => {
    expect(place(flying(), live({ status: "working" }), NOW).lane).toBe("flying");
    expect(place(flying(), live({ status: "blocked" }), NOW).lane).toBe("holding");
    expect(place(flying(), live({ status: "error" }), NOW).tone).toBe("error");
    expect(place(flying(), live({ status: "done" }), NOW).lane).toBe("holding");
    expect(place(flying(), live({ status: "idle" }), NOW).lane).toBe("holding");
  });

  test("a queued message keeps a card in the air", () => {
    expect(place(flying(), live({ status: "idle", queue: 2 }), NOW)).toEqual({ lane: "flying", reason: "2 queued", tone: "working" });
  });

  test("a launch gets a warm-up before its silence counts against it", () => {
    expect(place(flying({ launchedAt: NOW - 1000 }), live({ status: null }), NOW)).toEqual({ lane: "flying", reason: "spinning up", tone: "working" });
    expect(place(flying({ launchedAt: NOW - 200_000 }), live({ status: null }), NOW).lane).toBe("holding");
  });
});

describe("dropAction", () => {
  test("each lane gives a card its verb", () => {
    expect(dropAction("queued", "flying")).toBe("launch");
    expect(dropAction("landed", "flying")).toBe("fly");
    expect(dropAction("holding", "flying")).toBe("take");
    expect(dropAction("holding", "queued")).toBe("park");
    expect(dropAction("landed", "queued")).toBe("revive");
    expect(dropAction("flying", "landed")).toBe("land");
  });

  test("a lane it is already in, and holding, take nothing", () => {
    expect(dropAction("flying", "flying")).toBeNull();
    expect(dropAction("flying", "holding")).toBeNull();
    expect(dropAction("queued", "holding")).toBeNull();
  });

  test("a live agent nobody filed can only be gone to, or closed", () => {
    expect(dropActionFor("agent", "flying", "landed")).toBe("close");
    expect(dropActionFor("agent", "holding", "flying")).toBe("take");
    expect(dropActionFor("agent", "flying", "flying")).toBeNull();
    expect(dropActionFor("agent", "holding", "queued")).toBeNull();
    expect(dropActionFor("flight", "queued", "flying")).toBe("launch");
  });
});

describe("the board on disk", () => {
  test("a filed flight gets an id, a title and a recorder", () => {
    const { board, flight } = fileFlight(emptyBoard(), { brief: "Do the thing" }, NOW);
    expect(flight.id).toBe("f1");
    expect(flight.title).toBe("Do the thing");
    expect(flight.log[0].kind).toBe("filed");
    expect(board.seq).toBe(1);
    expect(board.flights).toHaveLength(1);
  });

  test("the seq only goes up, even when a flight is forgotten", () => {
    const one = fileFlight(emptyBoard(), { brief: "one" }, NOW);
    const two = fileFlight(one.board, { brief: "two" }, NOW);
    expect(two.flight.id).toBe("f2");
    const gone = forget(two.board, "f2");
    expect(fileFlight(gone, { brief: "three" }, NOW).flight.id).toBe("f3");
  });

  test("landing more than the board keeps drops the oldest", () => {
    let board = emptyBoard();
    for (let i = 0; i < 3; i++) board = fileFlight(board, { brief: `flight ${i}` }, NOW + i).board;
    const landed = (id: string, at: number) => {
      const flight = board.flights.find((each) => each.id === id)!;
      flight.landedAt = at;
    };
    landed("f1", NOW + 10);
    landed("f2", NOW + 20);
    landed("f3", NOW + 30);
    const trimmed = trimLanded(board, 2);
    expect(trimmed.flights.map((flight) => flight.id).sort()).toEqual(["f2", "f3"]);
    // The newest two landed stay, and nothing else is touched.
    expect(trimLanded(board, 5)).toBe(board);
  });

  test("a recorder keeps its last entries", () => {
    const flight = flying({ log: [] });
    for (let i = 0; i < 80; i++) record(flight, "turned", `turn ${i}`, NOW + i);
    expect(flight.log).toHaveLength(48);
    expect(flight.log.at(-1)!.text).toBe("turn 79");
  });

  test("a saved board reads back, and what a flight has is kept", () => {
    const { board } = fileFlight(emptyBoard(), { brief: "Keep me", cwd: "/tmp", agent: "claude" }, NOW);
    board.flights[0].pane = "%7";
    board.flights[0].turns = 3;
    board.flights[0].note = "tests pass";
    const back = parseBoard(JSON.stringify(board));
    expect(back?.flights[0]).toMatchObject({ brief: "Keep me", cwd: "/tmp", agent: "claude", pane: "%7", turns: 3, note: "tests pass" });
  });

  test("what is not a board is not one", () => {
    expect(parseBoard("nope")).toBeNull();
    expect(parseBoard("{}")?.flights).toEqual([]);
    expect(parseBoard(JSON.stringify({ seq: 2, flights: [{ id: "f9", brief: "x" }] }))?.seq).toBe(9);
  });

  test("a second flight's prompt carries where the last one stopped", () => {
    const flight = flying({ note: "tests fail on the redirect" });
    expect(promptFor(flight, false)).toBe(flight.brief);
    expect(promptFor(flight, true)).toContain("tests fail on the redirect");
  });
});

describe("the words on a card", () => {
  test("a stopwatch counts up", () => {
    expect(stopwatch(7_000)).toBe("0:07");
    expect(stopwatch(12 * 60_000 + 31_000)).toBe("12:31");
    expect(stopwatch(3_600_000 + 2 * 60_000 + 3_000)).toBe("1:02:03");
  });

  test("ago says how long, in the unit that fits", () => {
    expect(ago(NOW - 5_000, NOW)).toBe("now");
    expect(ago(NOW - 4 * 60_000, NOW)).toBe("4m");
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(ago(NOW - 2 * 86_400_000, NOW)).toBe("2d");
  });
});

describe("the lanes arrange and count", () => {
  const cards = [card({ id: "f1" }, "working"), card({ id: "f2", pane: null, launchedAt: null }, null), card({ id: "f3" }, "blocked")];

  test("a search keeps what says its words", () => {
    expect(shows(cards[0], "login")).toBe(true);
    expect(shows(cards[0], "login oauth")).toBe(true);
    expect(shows(cards[0], "checkout")).toBe(false);
    expect(shows(cards[0], "  ")).toBe(true);
  });

  test("cards are grouped by what their agent says, and counted", () => {
    const lanes = arrange(cards, "");
    expect(lanes.flying.map((each) => each.id)).toEqual(["f1"]);
    expect(lanes.queued.map((each) => each.id)).toEqual(["f2"]);
    expect(lanes.holding.map((each) => each.id)).toEqual(["f3"]);
    expect(countOf(cards)).toMatchObject({ queued: 1, flying: 1, needs: 1, waiting: 0, landed: 0 });
  });

  test("a lane orders the one in it longest first", () => {
    const older = card({ id: "f4", launchedAt: NOW - 300_000 }, "working");
    const lanes = arrange([...cards, older], "");
    expect(lanes.flying.map((each) => each.id)).toEqual(["f4", "f1"]);
    expect(inLane([older.flight!, cards[0].flight!], "flying").map((flight) => flight.id)).toEqual(["f4", "f1"]);
  });

  test("a live agent is a card too, waiting on you in Holding", () => {
    const live = loose();
    const lanes = arrange([...cards, live], "");
    expect(lanes.holding.map((each) => each.id)).toEqual(["f3", "%9"]);
    expect(countOf([...cards, live]).waiting).toBe(1);
    expect(laneTone("holding", [live])).toBe("idle");
    expect(laneTone("holding", [...cards, live])).toBe("blocked");
  });

  test("a pane's title loses the agent and the folder around it", () => {
    expect(agentTitle("π - Fix the login redirect - pumi", "pumi")).toBe("Fix the login redirect");
    expect(agentTitle("π - pumi", "pumi")).toBe("pumi");
    expect(agentTitle("Fix the login redirect")).toBe("Fix the login redirect");
    expect(agentTitle("a - b")).toBe("a - b");
    expect(agentTitle("Claude - Review the diff - checkout", "checkout", "claude")).toBe("Review the diff");
  });
});
