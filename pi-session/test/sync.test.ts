// The buttons on the panes: every pi pane has them in its strip, and no other pane has them.
import { afterEach, expect, test } from "bun:test";

import type { FakeApp } from "pumi/testing";

import { fake, type Fake } from "./fake.ts";

const ID = "0198c3e2-7a51-7c62-9a53-3f1a2b4c5d6e";
const PI = { "@agent": "pi", "@agent_session": ID };
let app: FakeApp;
afterEach(() => app?.stop());

/** The pane type of the strip, as a caller names it. */
const strip = () => `${app.init.prefix}strip`;
/** Where a strip view goes: at the end of `owner`'s own strip. */
const place = (owner: number) => ({ kind: "slot", slot: "PaneStrip", owner, focus: false });
/** A pane's own options, as the scene keeps them: `"@agent@3"`. */
const said = (name: string, pane: number) => `${name}@${pane}`;

/** The strip view the last sync opened for `owner`, now where it belongs in the scene: its id. */
function opened(started: Fake, owner: number): number {
  const view = started.views.get(owner)!;
  started.scene.panes.strip = [...(started.scene.panes.strip ?? []), view];
  started.scene.places[view] = { kind: "slot", name: "PaneStrip", owner };
  return view;
}

test("at startup every pi pane gets its buttons, and no other pane does", async () => {
  const started = await fake({
    panes: { terminal: [3, 4] },
    said: { [said("@agent", 3)]: PI["@agent"], [said("@agent_session", 3)]: ID },
  });
  app = started.app;
  expect(app.called("pane.open")).toEqual([[strip(), { pane: 3 }, place(3)]]);
  expect(app.called("option.set")).toEqual([
    ["@width", 50, { pane: expect.any(Number) }],
    ["@start", false, { pane: expect.any(Number) }],
  ]);
});

test("a strip that is already there, dressed for its pane, is left alone", async () => {
  const started = await fake({
    panes: { terminal: [3], strip: [90] },
    places: { 90: { kind: "slot", name: "PaneStrip", owner: 3 } },
    said: { [said("@agent", 3)]: "pi", [said("@agent_session", 3)]: ID, [said("@width", 90)]: 50, [said("@start", 90)]: false },
  });
  app = started.app;
  expect(app.called("pane.open")).toEqual([]);
  expect(app.called("pane.close")).toEqual([]);
});

test("a pane that becomes pi's gets them, and one whose pi is gone loses them", async () => {
  const started = await fake({ panes: { terminal: [3, 4] } });
  app = started.app;
  expect(app.called("pane.open")).toEqual([]);

  started.scene.said[said("@agent", 3)] = PI["@agent"];
  started.scene.said[said("@agent_session", 3)] = ID;
  await app.fire("option.changed", { name: "@agent" }, { match: "@agent" });
  expect(app.called("pane.open")).toEqual([[strip(), { pane: 3 }, place(3)]]);
  const view = opened(started, 3);

  started.scene.said[said("@agent", 3)] = "claude";
  await app.fire("option.changed", { name: "@agent" }, { match: "@agent" });
  expect(app.called("pane.close")).toEqual([[view, true]]);
});

test("a strip an older version dressed is made again", async () => {
  const started = await fake({
    panes: { terminal: [3], strip: [90] },
    places: { 90: { kind: "slot", name: "PaneStrip", owner: 3 } },
    said: { [said("@agent", 3)]: "pi", [said("@agent_session", 3)]: ID, [said("@width", 90)]: 30, [said("@start", 90)]: false },
  });
  app = started.app;
  expect(app.called("pane.close")).toEqual([[90, true]]);
  expect(app.called("pane.open")).toEqual([[strip(), { pane: 3 }, place(3)]]);
});

test("a strip left somewhere else is closed, and made at the end of its pane's strip", async () => {
  const started = await fake({
    panes: { terminal: [3], strip: [90] },
    places: { 90: { kind: "slot", name: "winbar", owner: 3 } },
    said: { [said("@agent", 3)]: "pi", [said("@agent_session", 3)]: ID, [said("@width", 90)]: 50, [said("@start", 90)]: false },
  });
  app = started.app;
  expect(app.called("pane.close")).toEqual([[90, true]]);
  expect(app.called("pane.open")).toEqual([[strip(), { pane: 3 }, place(3)]]);
});

test("focused_only keeps them on the focused pane, and follows the focus", async () => {
  const started = await fake(
    {
      panes: { terminal: [3, 4] },
      current: 3,
      said: {
        [said("@agent", 3)]: "pi",
        [said("@agent_session", 3)]: ID,
        [said("@agent", 4)]: "pi",
        [said("@agent_session", 4)]: ID,
      },
    },
    { focused_only: false },
  );
  app = started.app;
  expect(app.called("pane.open")).toEqual([
    [strip(), { pane: 3 }, place(3)],
    [strip(), { pane: 4 }, place(4)],
  ]);
  const onThree = opened(started, 3);
  const onFour = opened(started, 4);

  // The option's own change brings it in: only the focused pane keeps its buttons.
  const option = `${app.init.prefix}focused_only`;
  started.scene.said[option] = true;
  await app.fire("option.changed", { name: option }, { match: option });
  expect(app.called("pane.close")).toEqual([[onFour, true]]);

  // And they follow the focus.
  started.scene.current = 4;
  await app.fire("pane.focused", { pane: 4, tab: 1 }, { match: "terminal" });
  expect(app.called("pane.close")).toEqual([
    [onFour, true],
    [onThree, true],
  ]);
  expect(app.called("pane.open").at(-1)).toEqual([strip(), { pane: 4 }, place(4)]);
});
