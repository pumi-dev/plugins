// The cards the switcher makes: what one card says of its pane's type, and the order the cards go
// in. What a card is read from the app is the app's to say; this is the part that is the
// package's own.
import { expect, test } from "bun:test";

import { kindIcon, MAX_CARDS, MAX_PREVIEWS, ordered, tilde } from "../src/cards.ts";

test("a directory under the home is shown with a tilde", () => {
  const home = process.env.HOME ?? "";
  if (home !== "") expect(tilde(`${home}/kitchen`)).toBe("~/kitchen");
  expect(tilde("/elsewhere")).toBe("/elsewhere");
});

test("a pane type's icon is the one that says what it is", () => {
  expect(kindIcon("terminal")).toBe("terminal");
  expect(kindIcon("browser")).toBe("tool_web");
  expect(kindIcon("editor")).toBe("code");
  expect(kindIcon("files")).toBe("code");
  expect(kindIcon("agents")).toBe("sparkle");
  expect(kindIcon("office.agents")).toBe("sparkle");
  expect(kindIcon("insert-path.picker")).toBe("blocks");
});

test("the recent order comes first and the rest keep their place", () => {
  const panes = [{ pane: "%1" }, { pane: "%2" }, { pane: "%3" }, { pane: "%4" }];
  expect(ordered(panes, [], false)).toEqual(panes);
  expect(ordered(panes, ["%4", "%2"], true).map((p) => p.pane)).toEqual(["%4", "%2", "%1", "%3"]);
  expect(ordered(panes, ["%9", "%4"], true).map((p) => p.pane)).toEqual(["%4", "%1", "%2", "%3"]);
});

test("the switcher draws a screen for the first cards only", () => {
  expect(MAX_PREVIEWS).toBeLessThan(MAX_CARDS);
});
