// The switcher against pumi/testing's fake app: the row it draws, the keys that move about it, the
// pane it picks, and the trigger that opens it.
import { afterEach, expect, test } from "bun:test";

import { RenderedView } from "pumi/testing";

import { fake, type Fake } from "./fake.ts";

let made: Fake;
/** The views opened: they are closed first, so the switcher on screen is gone with its app. */
const views: RenderedView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.close();
  made?.app.stop();
});

/** Three panes over two tabs, the second one being switched from: `zsh`, `cargo test` and `Docs`. */
const three = {
  session: [1, 2],
  tabs: { 1: [10, 11], 2: [12] },
  current: 10,
  said: {
    "title@10": "zsh",
    "pane_current_path@10": "~/kitchen",
    "title@11": "cargo test",
    "title@12": "Docs",
    "pane_current_path@12": "~/docs",
    "pane_type@10": "terminal",
    "pane_type@11": "terminal",
    "pane_type@12": "browser",
  },
};

/** The switcher as the app opens it, settled: its cards read, and its own tree there. */
async function shown(scene: Parameters<typeof fake>[0] = three, options: Record<string, unknown> = {}): Promise<RenderedView> {
  made = await fake(scene, options);
  const view = made.app.open("switcher", { pane: 90, size: { width: 1000, height: 400 } });
  views.push(view);
  await made.app.settle();
  return view;
}

/** The cards the view draws, by id (`card-0` is the first). */
function drawn(view: RenderedView): string[] {
  return view.findAll((node) => (node.props.id ?? "").startsWith("card-")).map((node) => node.props.id!);
}

/** Which card has the highlight: the one drawn on the theme's hover, as a chosen card is. */
function highlighted(view: RenderedView): string {
  const cards = view.findAll((node) => (node.props.id ?? "").startsWith("card-"));
  return cards.find((node) => node.style.background === "$hover")!.props.id!;
}

test("it draws a card per pane, the highlight on the one being switched from", async () => {
  const view = await shown();
  expect(drawn(view)).toEqual(["card-0", "card-1", "card-2"]);
  expect(highlighted(view)).toBe("card-0");
  // Its title, then its number and directory.
  expect(view.text("#card-0")).toBe("zsh1.0  ~/kitchen");
  expect(view.snapshot()).toMatchSnapshot();
  expect(view.errors).toEqual([]);
});

test("a key moves the highlight about the row, and round its ends", async () => {
  const view = await shown();
  await view.key("#switcher", "right");
  expect(highlighted(view)).toBe("card-1");
  await view.key("#switcher", "ctrl+n");
  expect(highlighted(view)).toBe("card-2");
  await view.key("#switcher", "right");
  expect(highlighted(view)).toBe("card-0");
  await view.key("#switcher", "left");
  expect(highlighted(view)).toBe("card-2");
  await view.key("#switcher", "home");
  expect(highlighted(view)).toBe("card-0");
  await view.key("#switcher", "end");
  expect(highlighted(view)).toBe("card-2");
});

test("enter goes to the highlighted pane, whichever tab it is in, and closes the switcher", async () => {
  const view = await shown();
  await view.key("#switcher", "right");
  await view.key("#switcher", "enter");
  expect(made.app.called("pane.select")).toEqual([[{ to: 11 }]]);
  expect(made.app.called("pane.close")).toEqual([[90, true]]);
});

test("a digit picks its card, and a click goes to it", async () => {
  const view = await shown();
  await view.key("#switcher", "3");
  expect(highlighted(view)).toBe("card-2");
  await view.click("#card-2");
  expect(made.app.called("pane.select")).toEqual([[{ to: 12 }]]);
});

test("a click on another card goes to it, once the highlight has moved", async () => {
  const view = await shown();
  await view.click("#card-1");
  expect(made.app.called("pane.select")).toEqual([[{ to: 11 }]]);
});

test("hovering a card moves the highlight to it", async () => {
  const view = await shown();
  await view.dispatch("#card-2", "mouseEnter");
  expect(highlighted(view)).toBe("card-2");
});

test("x closes the highlighted pane and takes it off the row", async () => {
  const view = await shown();
  await view.key("#switcher", "x");
  expect(made.app.called("pane.close")).toEqual([[10]]);
  expect(drawn(view)).toEqual(["card-0", "card-1"]);
  expect(view.text("#card-0")).toStartWith("cargo test");
  expect(highlighted(view)).toBe("card-0");
});

test("the last card closed closes the switcher", async () => {
  const view = await shown({ session: [1], tabs: { 1: [10] }, current: 10, said: { "title@10": "zsh" } });
  await view.key("#switcher", "x");
  expect(made.app.called("pane.close")).toEqual([[10], [90, true]]);
});

test("nothing to switch to is said so", async () => {
  const view = await shown({ tabs: {}, said: {} });
  expect(drawn(view)).toEqual([]);
  expect(view.text("#strip")).toBe("No panes to switch to");
});

test("the trigger opens the float, and pressed again moves it on instead of replacing it", async () => {
  made = await fake(three);
  await made.app.command("switch");
  expect(made.app.called("pane.open")).toEqual([
    ["local.pane_switcher.switcher", {}, { kind: "float", relative: "client", anchor: "center", width: "80%", height: 18, backdrop: 30, dismiss: ["escape", "press"], zindex: 70, focus: false }],
  ]);
  // The app opens the pane the switcher asked for: the view that comes up is the live one for the
  // trigger to move on.
  const view = made.app.open("switcher", { pane: 90 });
  views.push(view);
  await made.app.settle();
  await made.app.command("switch");
  expect(made.app.called("pane.open")).toHaveLength(1);
  expect(highlighted(view)).toBe("card-1");
});

test("the trigger is bound in the global key table as its option says", async () => {
  made = await fake(three);
  const calls = made.app.called("key.set");
  expect(calls.at(-1)).toEqual(["global", "<M-Tab>", { call: "local.pane_switcher.switch", args: [] }, { desc: "Switch pane" }]);
  made.app.options.set("local.pane_switcher.trigger", "<C-Space>");
  await made.app.fire("option.changed", { name: "local.pane_switcher.trigger" }, { match: "local.pane_switcher.trigger" });
  expect(made.app.called("key.del")).toEqual([["global", "<M-Tab>", {}]]);
  expect(made.app.called("key.set").at(-1)).toEqual([
    "global",
    "<C-Space>",
    { call: "local.pane_switcher.switch", args: [] },
    { desc: "Switch pane" },
  ]);
});

test("its function opens it from anywhere, and replaces one already up", async () => {
  made = await fake({ ...three, said: { ...three.said, "pane_type@77": "local.pane_switcher.switcher" } });
  made.app.answer("pane.list", (opts?: { type?: string | null } | null) => (opts?.type ? [77] : [10, 11, 12]));
  expect(await made.app.serve("local.pane_switcher.open")).toBe(true);
  expect(made.app.called("pane.close")).toEqual([[77, true]]);
  expect(made.app.called("pane.open")).toHaveLength(1);
});

test("the options place the float, and choose what the cards show", async () => {
  const options = { scope: "tab", width: 50, height: 12, backdrop: 40, card_width: 300, preview: false, preview_rows: 4 };
  // The float first: the trigger opens it, and the view the app opens after is what it draws.
  made = await fake(three, options);
  expect(await made.app.serve("local.pane_switcher.open")).toBe(true);
  expect(made.app.called("pane.open").at(-1)).toEqual([
    "local.pane_switcher.switcher",
    {},
    { kind: "float", relative: "client", anchor: "center", width: "50%", height: 12, backdrop: 40, dismiss: ["escape", "press"], zindex: 70, focus: false },
  ]);
  const view = made.app.open("switcher", { pane: 90, size: { width: 500, height: 300 } });
  views.push(view);
  await made.app.settle();
  expect(drawn(view)).toEqual(["card-0", "card-1"]);
  // The tab alone: its directory, without the number.
  expect(view.text("#card-0")).toBe("zsh~/kitchen");
  // No preview: the card is its title and where it is, without the app's screen of the pane.
  expect(view.findAll((node) => node.tag === "native")).toEqual([]);
  expect(view.find("#card-0").style.width).toBe("300px");
});

test("a card draws its pane's screen, in a box as tall as the lines it was asked for", async () => {
  const view = await shown(three, { preview_rows: 6 });
  const screens = view.findAll((node) => node.tag === "native");
  expect(screens.map((node) => node.props.view)).toEqual(["preview:%10", "preview:%11", "preview:%12"]);
  const box = view.find("#card-0").children[0];
  // Six lines of 14px.
  expect(box.style.height).toBe("84px");
});
