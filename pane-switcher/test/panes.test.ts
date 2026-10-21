// The cards the switcher makes, against pumi/testing's fake app: which panes its scope and order
// ask for, and what each card says of its pane.
import { afterEach, expect, test } from "bun:test";

import { cards, kindIcon, MAX_PREVIEWS, ordered, said, tilde } from "../src/panes.ts";
import { DEFAULTS, settings } from "../src/settings.ts";
import { fake, type Fake } from "./fake.ts";

let made: Fake;
afterEach(() => made?.app.stop());

/** The cards of the defaults, with `said` as what the panes say and the options as given. */
async function same(options: Record<string, unknown> = {}, scene: Parameters<typeof fake>[0] = {}, recent: number[] = []) {
  made = await fake(scene, options);
  return cards(await settings(), recent);
}

test("the session's panes are carded, in layout order unless it is the recent one", async () => {
  const scene = { session: [1, 2], tabs: { 1: [1, 2, 3], 2: [4] }, said: { "title@1": "zsh", "title@2": "cargo", "title@3": "Docs", "title@4": "vim" } };
  const layout = await same({ order: "layout" }, scene);
  expect(layout.map((card) => [card.pane, card.title])).toEqual([
    [1, "zsh"],
    [2, "cargo"],
    [3, "Docs"],
    [4, "vim"],
  ]);
  made.app.stop();
  // The last two used come first, and the rest keep the order they came in.
  const recent = await same({}, scene, [4, 2]);
  expect(recent.map((card) => card.pane)).toEqual([4, 2, 1, 3]);
});

test("the scope picks the panes: the tab's, the session's, or every session's", async () => {
  const scene = {
    session: [1, 2],
    sessions: { 1: [1, 2], 2: [3] },
    tabs: { 1: [10], 2: [11], 3: [12] },
    said: { "title@10": "a", "title@11": "b", "title@12": "c" },
  };
  expect((await same({ scope: "tab" }, scene)).map((card) => card.pane)).toEqual([10]);
  made.app.stop();
  expect((await same({ scope: "session" }, scene)).map((card) => card.pane)).toEqual([10, 11]);
  made.app.stop();
  expect((await same({ scope: "all" }, scene)).map((card) => card.pane)).toEqual([10, 11, 12]);
});

test("the tab's own numbers are left out of a tab's cards, and are in the session's", async () => {
  const scene = { tabs: { 1: [10, 11] }, said: { "title@10": "zsh", "pane_current_path@10": "/" } };
  const [only] = await same({ scope: "tab" }, scene);
  expect(only.detail).toBe("/");
  made.app.stop();
  // The pane's number, then its directory.
  const [numbered] = await same({ scope: "session" }, scene);
  expect(numbered.detail).toBe("1.0  /");
});

test("a directory under the home is shown with a tilde", async () => {
  const home = process.env.HOME ?? "";
  if (home !== "") expect(tilde(`${home}/kitchen`)).toBe("~/kitchen");
  expect(tilde("/elsewhere")).toBe("/elsewhere");
});

test("a card is its title, else what it runs, else its type, and its agent's state", async () => {
  const scene = {
    tabs: { 1: [10, 11, 12] },
    said: { "title@10": "zsh", "pane_current_command@11": "cargo test", "pane_type@12": "terminal", "@agent_status@10": "blocked" },
  };
  const found = await same({ scope: "tab" }, scene);
  expect(found.map((card) => card.title)).toEqual(["zsh", "cargo test", "terminal"]);
  expect(found[0].status).toBe("blocked");
  expect(found[1].status).toBe("");
});

test("a slot, a detached pane and the switcher itself are no cards", async () => {
  const scene = {
    tabs: { 1: [10, 11, 12, 13] },
    places: { 11: "slot", 12: "detached" },
    said: { "title@10": "zsh", "pane_type@13": "local.pane_switcher.switcher" },
  };
  expect((await same({ scope: "tab" }, scene)).map((card) => card.pane)).toEqual([10]);
});

test("only the first cards, and the first of those, have a screen", async () => {
  const many: Record<string, unknown> = {};
  const tabs: Record<number, number[]> = { 1: [] };
  for (let at = 1; at <= 45; at++) {
    tabs[1].push(at);
    many[`title@${at}`] = `pane ${at}`;
  }
  const drawn = await same({ scope: "tab" }, { tabs, said: many });
  expect(drawn.length).toBe(40);
  expect(drawn.filter((card) => card.preview).length).toBe(MAX_PREVIEWS);
  made.app.stop();
  expect((await same({ scope: "tab", preview: false }, { tabs: { 1: [1] }, said: { "title@1": "zsh" } }))[0].preview).toBe(false);
});

test("a pane that says nothing of itself is still a card: its type names it", async () => {
  made = await fake({ tabs: { 1: [7] }, said: { "pane_type@7": "terminal" } });
  expect(await said(7, "title")).toBe("");
  const [only] = await cards({ ...DEFAULTS, scope: "tab" }, []);
  expect(only).toEqual({ pane: 7, kind: "terminal", title: "terminal", detail: "", status: "", preview: true });
});

test("a pane closed between the listing and the read is no card", async () => {
  // Nothing says what it is: no title, no program, no type.
  made = await fake({ tabs: { 1: [7] } });
  expect(await cards(DEFAULTS, [])).toEqual([]);
});

test("a pane type's icon is the one that says what it is", () => {
  expect(kindIcon("terminal")).toBe("terminal");
  expect(kindIcon("browser")).toBe("globe");
  expect(kindIcon("editor")).toBe("code");
  expect(kindIcon("files")).toBe("code");
  expect(kindIcon("agents")).toBe("sparkle");
  expect(kindIcon("office.agents")).toBe("sparkle");
  expect(kindIcon("insert-path.picker")).toBe("blocks");
});

test("the recent order comes first and the rest keep their place", () => {
  const panes = [{ pane: 1 }, { pane: 2 }, { pane: 3 }, { pane: 4 }];
  expect(ordered(panes, [], false)).toEqual(panes);
  expect(ordered(panes, [4, 2], true).map((p) => p.pane)).toEqual([4, 2, 1, 3]);
  expect(ordered(panes, [9, 4], true).map((p) => p.pane)).toEqual([4, 1, 2, 3]);
});
