// The worker's half: the model read from `session.list` and `session.get` deep, the answer to a
// turn, and what an agent is remembered as having been told. Everything here is handed a fake
// source and store, so no pumi needs to be running.
import { expect, test } from "bun:test";

import { DEFAULTS, GUIDE as BARE, type Settings } from "../../src/context/context.ts";
import type { GivenSession } from "../../src/context/snapshot.ts";
import { answer, readState, toldKey, turned, type Ask, type Source, type Store, type Turn } from "../../src/context/wire.ts";
import { sessions } from "./fake.ts";

/** The guide as an answer starts with it: in its frame. */
const GUIDE = `<pumi-context from="pumi_dev/agents">\n${BARE}`;

/** The API, as `session.list` and `session.get` deep answer it. */
function source(given: GivenSession[] = sessions()): Source {
  return {
    list: async () => given.map((session) => session.id),
    get: async (id) => given.find((session) => session.id === id) ?? null,
  };
}

/** The plugin's own options, kept in a map. */
function store(): Store & { kept: Map<string, unknown> } {
  const kept = new Map<string, unknown>();
  return {
    kept,
    get: async (key) => kept.get(key) ?? null,
    set: async (key, value) => {
      kept.set(key, value);
      return null;
    },
  };
}

function turn(patch: Partial<Turn> = {}): Turn {
  return { tab: "%11", agent: "claude", session: "s-1", event: "prompt", resumed: false, full: false, peek: false, ...patch };
}

function ask(over: Partial<Ask> = {}): Ask {
  return { source: source(), store: store(), settings: DEFAULTS, here: 1, ...over };
}

test("the model is read through a session's views, panes and tabs", async () => {
  const model = await readState(source(), 1);
  expect(model.sessions.map((session) => session.id)).toEqual([1, 2]);
  expect(model.views.map((view) => view.id)).toEqual([1, 2, 3]);
  expect(model.panes.map((pane) => pane.id)).toEqual([4, 5, 6, 7]);
  expect(model.tabs.map((tab) => tab.id)).toEqual([10, 11, 12, 13, 14, 20]);
  // The tab the turn is in is found by walking those views: nothing hangs a tab off a session.
  expect(model.tabs.find((tab) => tab.id === 11)).toMatchObject({ session: 1, view: 1, pane: 5 });
});

test("an agent is told the guide and the map at its first prompt, and nothing when nothing changed", async () => {
  const deps = ask();
  const first = await answer(turn(), deps);
  expect(first).not.toBeNull();
  expect(first!.startsWith(GUIDE)).toBe(true);
  expect(first).toContain("<pumi-panes>\n$1 pumi (current)\n");
  expect(first).toContain("      %11 π - claude — /Users/me/Kitchen/pumi — working (current)\n");
  // What it was told is the map alone, kept for its agent and its own session.
  const kept = (deps.store as Store & { kept: Map<string, unknown> }).kept;
  expect(kept.get(toldKey(turn()))).toBe(first!.split("<pumi-panes>\n")[1]!.replace("</pumi-panes>\n</pumi-context>\n", ""));
  expect(await answer(turn(), deps)).toBeNull();
});

test("a tab that opened since is what it is told next", async () => {
  const deps = ask();
  await answer(turn(), deps);
  const given = sessions();
  given[0]!.tree![1]!.tabs!.push({
    id: "%15",
    session: "$1",
    view: "@2",
    block: "terminal",
    place: { kind: "tiled", view: "@2", pane: ":6" },
    title: "make test",
    cwd: "/Users/me/Kitchen/pumi",
    isFocused: false,
    options: { title: "make test" },
  });
  const moved = await answer(turn(), { ...deps, source: source(given) });
  expect(moved).not.toBeNull();
  expect(moved!.startsWith(`<pumi-context from="pumi_dev/agents">\n<pumi-panes-changed>`)).toBe(true);
  expect(moved).not.toContain(GUIDE);
  expect(moved).toContain("%15 make test");
});

test("`updates: start` says nothing again until a session starts", async () => {
  const deps = ask({ settings: { ...DEFAULTS, updates: "start" } });
  expect(await answer(turn(), deps)).not.toBeNull();
  expect(await answer(turn(), deps)).toBeNull();
  const again = await answer(turn({ event: "start", resumed: false }), deps);
  expect(again!.startsWith(GUIDE)).toBe(true);
  expect(await answer(turn({ event: "start", resumed: true }), deps)).toBeNull();
});

test("`full` says everything again", async () => {
  const deps = ask();
  await answer(turn(), deps);
  const again = await answer(turn({ full: true }), deps);
  expect(again!.startsWith(GUIDE)).toBe(true);
});

test("a peek says what would be said, and counts nothing", async () => {
  const deps = ask();
  const peeked = await answer(turn({ peek: true }), deps);
  expect(peeked!.startsWith(GUIDE)).toBe(true);
  expect((deps.store as Store & { kept: Map<string, unknown> }).kept.size).toBe(0);
  // The next real turn is still the first one.
  expect((await answer(turn(), deps))!.startsWith(GUIDE)).toBe(true);
});

test("a compaction forgets what the agent was told", async () => {
  const deps = ask();
  await answer(turn(), deps);
  await turned(turn({ event: "compact" }), deps.store);
  expect((await answer(turn(), deps))!.startsWith(GUIDE)).toBe(true);
  // A turn's plain end forgets nothing.
  await turned(turn({ event: "stop" }), deps.store);
  expect(await answer(turn(), deps)).toBeNull();
});

test("the switch turns it off", async () => {
  const off = ask({ settings: { ...DEFAULTS, context: false } });
  expect(await answer(turn(), off)).toBeNull();
  expect((off.store as Store & { kept: Map<string, unknown> }).kept.size).toBe(0);
});

test("the map is kept to the agent's own session, whichever session the caller is in", async () => {
  const settings: Settings = { ...DEFAULTS, otherSessions: false };
  // The agent is in `$2`, and the caller reads the model from `$1`.
  const said = await answer(turn({ tab: "%20", agent: "pi" }), ask({ settings, here: 1 }));
  expect(said).toContain("$2 site");
  expect(said).not.toContain("$1 pumi");
  // A turn whose tab is in no session falls back to the caller's.
  const elsewhere = await answer(turn({ tab: "%999" }), ask({ settings, here: 1 }));
  expect(elsewhere).toContain("$1 pumi");
  expect(elsewhere).not.toContain("$2 site");
});

test("with no caller of its own, the worker marks the session the focused tab is in", async () => {
  // A plugin's worker is in no session (`here` is null): the tab a client is in says where the user is.
  const said = await answer(turn({ tab: "%20", agent: "pi" }), ask({ here: null }));
  expect(said).toContain("$1 pumi (current)");
  expect(said).toContain("  @1 main (current)");
  expect(said).toContain("    :5 (focused)");
  // The agent's own session is in the map, unmarked.
  expect(said).toContain("$2 site\n");
});

test("what an agent was told is kept per agent and session, in this map's shape", () => {
  expect(toldKey(turn())).toBe("told:2:claude:s-1");
  expect(toldKey(turn({ session: null }))).toBe("told:2:claude:%11");
  expect(toldKey(turn({ agent: "pi", session: "s-2" }))).not.toBe(toldKey(turn()));
});
