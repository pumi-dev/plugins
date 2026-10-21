// The diagram pane, against `pumi/testing`'s fake app: what it draws, what it says when Pele
// cannot draw, and the hands on it — zoom, fit, a drag, and a click on a node.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeApp, type RenderedView } from "pumi/testing";

const dir = join(import.meta.dir, "..");
/** A dark theme, as `app.theme` answers one. */
const THEME = {
  colors: { editor: "#1e1e1e", surface_text: "#c8c8c8", primary: "#7aa2f7", border: "#555555" },
  metrics: { radius_sm: 6 },
  fonts: { font: "SF Pro Text", mono: "SF Mono" },
};
/** The pane the diagrams are drawn in. */
const OWN = 42;
/** A pane an agent runs in, which a clicked node's note can go to. */
const AGENT = 12;
const FLOW = "flowchart LR\n  ask[the question] --> draw[marmaide draws]";
const ONE = "flowchart LR\n  only[the only one]";
let app: FakeApp;
afterEach(() => app?.stop());

async function start(options: Record<string, unknown> = {}): Promise<FakeApp> {
  app = await FakeApp.start({ dir, main: "src/main.ts", answers: { "app.theme": THEME }, options });
  return app;
}

/** The diagram pane, with `args` and the size it is drawn at, once it has drawn. */
async function open(args: Record<string, unknown> = {}, size = { width: 600, height: 420 }): Promise<RenderedView> {
  const view = app.open("diagram", { args, pane: OWN, size });
  await app.settle();
  return view;
}

/** The tree as JSON, with the package's own paths written out: they are where the picture is. */
function shape(view: RenderedView): unknown {
  return JSON.parse(
    JSON.stringify(view.snapshot())
      .replaceAll(dir, "<pkg>")
      .replaceAll(app.init.paths!.cache, "<cache>")
      .replace(/[0-9a-f]{20}\.svg/g, "<picture>.svg"),
  );
}

/** A press and a release at `x`, `y` in the pane: a click when they are the same point. */
async function press(view: RenderedView, x: number, y: number, to?: { x: number; y: number }): Promise<void> {
  const at = to ?? { x, y };
  await view.dispatch("#marmaide-canvas", "mouseDown", { x, y, button: "left", clicks: 1 });
  if (at.x !== x || at.y !== y) await view.dispatch("#marmaide-canvas", "mouseMove", { x: at.x, y: at.y, button: "left" });
  await view.dispatch("#marmaide-canvas", "mouseUp", { x: at.x, y: at.y, button: "left", clicks: 1 });
}

test("the pane draws the diagram, fitted, with its kind and its size", async () => {
  await start();
  const view = await open({ source: FLOW });
  expect(shape(view)).toMatchSnapshot();
  // The picture is a file, drawn as an image: the SVG Pele drew, in the app's colours.
  expect(view.find("#marmaide-picture").props.src ?? view.find((node) => node.tag === "img").props.src).toEndWith(".svg");
  expect(view.text("#marmaide-caption")).toStartWith("flowchart · ");
  expect(view.text("#marmaide-zoom")).toBe("100%");
});

test("a diagram Pele cannot read says why, in the pane", async () => {
  await start();
  const view = await open({ source: "notadiagram\n  ???" });
  expect(view.text("#marmaide-error")).toContain("No diagram type detected");
  expect(view.text("#marmaide-error")).toContain("pumi call local.marmaide.draw");
});

test("an empty pane says how to draw in it", async () => {
  await start();
  const view = await open();
  expect(view.text("#marmaide-error")).toContain("no diagram yet");
  expect(view.findAll((node) => node.tag === "img")).toEqual([]);
});

test("+ and − zoom, and fit puts it back", async () => {
  await start();
  const view = await open({ source: FLOW });
  await view.click("#marmaide-zoom-in");
  expect(view.text("#marmaide-zoom")).toBe("125%");
  await view.click("#marmaide-zoom-in");
  expect(view.text("#marmaide-zoom")).toBe("156%");
  await view.click("#marmaide-zoom-out");
  expect(view.text("#marmaide-zoom")).toBe("125%");
  await view.click("#marmaide-fit");
  expect(view.text("#marmaide-zoom")).toBe("100%");
});

test("the wheel zooms over the picture, and a double click fits it again", async () => {
  await start();
  const view = await open({ source: FLOW });
  await view.dispatch("#marmaide-canvas", "scroll", { x: 300, y: 200, dy: 16 });
  expect(view.text("#marmaide-zoom")).not.toBe("100%");
  await view.dispatch("#marmaide-canvas", "doubleClick", { x: 300, y: 200 });
  expect(view.text("#marmaide-zoom")).toBe("100%");
});

test("a drag moves the picture, and the pane is not asked twice for the same drawing", async () => {
  await start();
  const view = await open({ source: FLOW });
  const before = view.find("#marmaide-picture").style.left;
  await press(view, 100, 100, { x: 160, y: 140 });
  const moved = view.find("#marmaide-picture").style.left;
  expect(moved).not.toBe(before);
  expect(view.text("#marmaide-zoom")).toBe("100%");
});

test("the pane's own option is what it draws: a new value draws again", async () => {
  await start();
  const view = await open();
  const prefix = "local.marmaide";
  app.options.set(`${prefix}.source`, ONE);
  await app.fire(
    "option.changed",
    { name: `${prefix}.source`, scope: "pane", id: OWN, new: ONE },
    { match: `${prefix}.source` },
  );
  expect(view.text("#marmaide-caption")).toStartWith("flowchart · ");
  // Another pane's source is not this pane's, and a global one is not a pane's either.
  await app.fire(
    "option.changed",
    { name: `${prefix}.source`, scope: "pane", id: OWN + 1, new: FLOW },
    { match: `${prefix}.source` },
  );
  await app.fire("option.changed", { name: `${prefix}.source`, scope: "global", new: "" }, { match: `${prefix}.source` });
  expect(view.text("#marmaide-caption")).toStartWith("flowchart · ");
});

test("a click on a node asks the agent that is running, and the note lands in its inbox", async () => {
  await start();
  app.answer("pane.list", [AGENT]);
  app.options.set("@agent", "claude");
  app.options.set("pane_current_command", "claude");
  const view = await open({ source: ONE });
  // One node, fitted and centred: the middle of the room above the caption is over it.
  await press(view, 300, 197);
  expect(view.text("#marmaide-ask")).toContain("To claude %12");
  const note = (node: { tag: string }) => node.tag === "input";
  await view.type(note, "why is it drawn like this?");
  await view.dispatch(note, "submit", { value: "why is it drawn like this?" });
  const inbox = app.options.get("@agent_inbox") as { from: string; pane: string; what: string; note: string }[];
  expect(inbox.length).toBe(1);
  expect(inbox[0]!.from).toBe("marmaide");
  expect(inbox[0]!.pane).toBe("%42");
  expect(inbox[0]!.note).toBe("why is it drawn like this?");
  expect(inbox[0]!.what).toContain("node `only` (“the only one”) of this flowchart diagram");
  expect(inbox[0]!.what).toContain("```mermaid");
  expect(view.text("#marmaide-caption")).toContain("sent to claude %12");
});

test("a click with no agent running says so", async () => {
  await start();
  app.answer("pane.list", []);
  const view = await open({ source: ONE });
  await press(view, 300, 197);
  expect(view.text("#marmaide-caption")).toContain("no agent is running");
  expect(view.text("#marmaide-ask")).toContain("To");
});
