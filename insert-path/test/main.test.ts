// The package's own half against `pumi/testing`'s fake app: the trigger it binds in a terminal,
// and the float it opens with what the picker needs.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");
let app: FakeApp;
afterEach(() => app?.stop());

async function start(options: Record<string, unknown> = {}): Promise<FakeApp> {
  app = await FakeApp.start({ dir, main: "src/main.ts", options });
  return app;
}

/** What the picker was opened with, as `pane.open` crossed. */
function opened(): { type: string; args: Record<string, unknown>; place: Record<string, unknown> } {
  const call = app.called("pane.open").at(-1)!;
  return { type: call[0], args: call[1], place: call[2] };
}

test("the trigger is bound in the terminal's key table", async () => {
  await start();
  expect([...app.keys.keys()]).toEqual(["terminal /"]);
  const call = app.called("key.set").at(-1)!;
  expect(call.slice(0, 2)).toEqual(["terminal", "/"]);
  expect(call[3]).toEqual({ desc: "Insert a path…" });
});

test("the trigger follows its option, and nothing else rebinds it", async () => {
  await start();
  const prefix = "local.insert_path";
  await app.fire("option.changed", { name: `${prefix}.quote` }, { match: `${prefix}.quote` });
  expect([...app.keys.keys()]).toEqual(["terminal /"]);
  // The user sets it: the value first, then the event, as the app does.
  app.options.set(`${prefix}.trigger`, "<D-/>");
  await app.fire(
    "option.changed",
    { name: `${prefix}.trigger`, old: "/", new: "<D-/>" },
    { match: `${prefix}.trigger` },
  );
  expect([...app.keys.keys()]).toEqual(["terminal <D-/>"]);
});

test("open puts the picker over the tab of the pane it was given", async () => {
  await start();
  expect(await app.serve("local.insert_path.open", { pane: 7 })).toBe(true);
  expect(opened()).toEqual({
    type: "local.insert_path.picker",
    args: { pane: 7, quote: true, cancel: "/" },
    place: { kind: "float", width: "28%", height: 18, row: 1, zindex: 60, focus: false, dismiss: ["press"] },
  });
});

test("the picker lists the terminal's directory, and its height is the option's", async () => {
  await start({ height: 24.6 });
  app.answer("option.get", (name: string) => (name === "pane_current_path" ? "/tmp/there" : (app.options.get(name) ?? null)));
  await app.serve("local.insert_path.open", { pane: 7 });
  const open = opened();
  expect(open.args.cwd).toBe("/tmp/there");
  expect(open.place.height).toBe(25);
});

test("a chord trigger has nothing to type back", async () => {
  await start({ trigger: "<D-/>" });
  await app.serve("local.insert_path.open", { pane: 7 });
  expect(opened().args.cancel).toBeNull();
});

test("no pane to pick a path for says so and opens nothing", async () => {
  await start();
  expect(await app.serve("local.insert_path.open")).toBe(false);
  expect(app.notices).toEqual([{ msg: "insert-path: no pane to pick a path for", level: "error" }]);
  expect(app.called("pane.open")).toEqual([]);
});

test("a picker that is already open is closed first", async () => {
  await start();
  app.answer("pane.list", [55]);
  await app.serve("local.insert_path.open", { pane: 7 });
  expect(app.called("pane.close")[0]).toEqual([55, true]);
  expect(opened().type).toBe("local.insert_path.picker");
});
