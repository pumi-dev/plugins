// The picker against `pumi/testing`'s fake app: the fixture tree under the package's own
// directory, a terminal to type into, and the keys the picker takes.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeApp, type RenderedView } from "pumi/testing";

const dir = join(import.meta.dir, "..");
/** The tree the picker lists: its path inside the package, where the tests run. */
const TREE = "test/fixtures/tree";
/** The terminal pane the path is typed into, and the picker's own pane. */
const TERM = 7;
const OWN = 101;
let app: FakeApp;
afterEach(() => app?.stop());

async function start(): Promise<FakeApp> {
  app = await FakeApp.start({ dir, main: "src/main.ts" });
  return app;
}

/** The picker, as `open` puts it: its own pane `OWN`, typing into the terminal `TERM`. */
function open(args: Record<string, unknown> = {}): RenderedView {
  return app.open("picker", {
    pane: OWN,
    args: { pane: TERM, cwd: TREE, quote: true, cancel: "/", ...args },
    size: { width: 420, height: 480 },
  });
}

/** The tree as JSON, with the package's own path written as `<pkg>`: it is where the icons are. */
function shape(view: RenderedView) {
  return JSON.parse(JSON.stringify(view.snapshot()).replaceAll(dir, "<pkg>"));
}

/** What was typed into the terminal (`pane.call(…, "input", …)`), in order. */
function typed(): unknown[] {
  return app.called("pane.call")
    .filter((call) => call[1] === "input")
    .map((call) => call[2]);
}

/** Whether match `i` is the highlighted row. */
function highlighted(view: RenderedView, i: number): boolean {
  return Object.values(view.find(`#insert-path-row-${i}`).style).includes("$primary");
}

test("the picker lists the directory, and the header says how many match", async () => {
  await start();
  const view = open();
  // `dist` and `vendor` are in the walk's skip list, so nothing under them is listed.
  expect(shape(view)).toMatchSnapshot();
  expect(view.text("#insert-path-count")).toBe("12");
  expect(view.text("#insert-path-header")).toContain(TREE);
});

test("typing filters the list, and says when nothing matches", async () => {
  await start();
  const view = open();
  await view.type("#insert-path-query", "main");
  expect(view.text("#insert-path-count")).toBe("1");
  expect(view.text("#insert-path-row-0")).toContain("main.rs");
  await view.type("#insert-path-query", "zzz");
  expect(view.text("#insert-path-count")).toBe("0");
  expect(view.text("#insert-path-nothing")).toBe("No files match");
});

test("Enter types the path in and closes; a directory comes with its slash", async () => {
  await start();
  const view = open();
  await view.type("#insert-path-query", "main");
  await view.key("#insert-path", "enter");
  expect(app.called("pane.call").at(-1)).toEqual([TERM, "input", { text: "src/main.rs" }]);
  expect(app.called("pane.close").at(-1)).toEqual([OWN]);
  const picked = open();
  await picked.type("#insert-path-query", "src");
  await picked.key("#insert-path", "enter");
  expect(typed().at(-1)).toEqual({ text: "src/" });
});

test("Tab narrows to the highlighted directory, and the query matches paths from then on", async () => {
  await start();
  const view = open();
  await view.type("#insert-path-query", "src");
  await view.key("#insert-path", "tab");
  expect(view.find("#insert-path-query").props.value).toBe("src/");
  expect(view.text("#insert-path-count")).toBe("3");
  await view.key("#insert-path", "enter");
  expect(typed().at(-1)).toEqual({ text: "src/lib.rs" });
});

test("Tab does nothing on a file", async () => {
  await start();
  const view = open();
  await view.type("#insert-path-query", "Cargo");
  await view.key("#insert-path", "tab");
  expect(view.find("#insert-path-query").props.value).toBe("Cargo");
});

test("a path is quoted when a shell would split it, unless the option says not to", async () => {
  await start();
  const quoted = open({ cwd: "test/fixtures/spaced" });
  await quoted.type("#insert-path-query", "my file");
  await quoted.key("#insert-path", "enter");
  expect(typed().at(-1)).toEqual({ text: "'my file.txt'" });
  const bare = open({ cwd: "test/fixtures/spaced", quote: false });
  await bare.type("#insert-path-query", "my file");
  await bare.key("#insert-path", "enter");
  expect(typed().at(-1)).toEqual({ text: "my file.txt" });
});

test("arrow keys, Ctrl-N and the page keys move the highlight around the ends", async () => {
  await start();
  const view = open();
  expect(highlighted(view, 0)).toBe(true);
  await view.key("#insert-path", "down");
  await view.key("#insert-path", "ctrl+n");
  expect(highlighted(view, 2)).toBe(true);
  await view.key("#insert-path", "pagedown");
  expect(highlighted(view, 10)).toBe(true);
  await view.key("#insert-path", "pageup");
  await view.key("#insert-path", "ctrl+p");
  expect(highlighted(view, 1)).toBe(true);
  await view.key("#insert-path", "up");
  await view.key("#insert-path", "ctrl+k");
  expect(highlighted(view, 11)).toBe(true);
});

test("a press on a row picks it; the pointer over one highlights it", async () => {
  await start();
  const view = open();
  await view.dispatch("#insert-path-row-1", "mouseEnter");
  expect(highlighted(view, 1)).toBe(true);
  await view.click("#insert-path-row-0");
  expect(typed().at(-1)).toEqual({ text: "Cargo.lock" });
});

test("Escape closes without picking, and an empty query types the trigger back", async () => {
  await start();
  const view = open();
  await view.key("#insert-path", "escape");
  expect(typed()).toEqual([{ text: "/" }]);
  expect(app.called("pane.close").at(-1)).toEqual([OWN]);
  const typed_ = open();
  await typed_.type("#insert-path-query", "main");
  await typed_.key("#insert-path", "escape");
  expect(typed()).toEqual([{ text: "/" }]);
});

test("Backspace on an empty query cancels; on a typed one it is the field's", async () => {
  await start();
  const view = open();
  await view.key("#insert-path", "backspace");
  expect(typed()).toEqual([{ text: "/" }]);
  const typed_ = open();
  await typed_.type("#insert-path-query", "main");
  await typed_.key("#insert-path", "backspace");
  expect(app.called("pane.close")).toHaveLength(1);
});

test("a chord trigger types nothing back", async () => {
  await start();
  const view = open({ cancel: null });
  await view.key("#insert-path", "escape");
  expect(typed()).toEqual([]);
  expect(app.called("pane.close").at(-1)).toEqual([OWN]);
});

test("a press outside the float (the app closing it) types the trigger back too", async () => {
  await start();
  const view = open();
  view.close();
  await app.settle();
  expect(typed()).toEqual([{ text: "/" }]);
});

test("a path the terminal refuses is said so", async () => {
  await start();
  app.answer("pane.call", () => {
    throw new Error("no such pane");
  });
  const view = open();
  await view.type("#insert-path-query", "main");
  await view.key("#insert-path", "enter");
  expect(app.notices).toEqual([{ msg: "insert-path: no such pane", level: "error" }]);
});
