// What the package does when the app starts: its page in the left sidebar, beside the core
// plugins', titled and with its icon — unless a reload left one there already.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");
const main = new URL("../src/main.ts", import.meta.url);
const type = "local.shell_scripts.scripts";
let app: FakeApp;

afterEach(() => app?.stop());

/** The app, with `pane.list` finding the panes the test says. */
async function start(panes: number[]): Promise<FakeApp> {
  app = await FakeApp.start({ dir, main, answers: { "pane.list": () => panes } });
  return app;
}

test("its page goes in the left sidebar, titled and with its icon", async () => {
  await start([]);
  expect(app.called("pane.open")).toEqual([
    [type, {}, { kind: "slot", slot: "sidebar.left", order: 31, focus: false }],
  ]);
  const [title, icon] = app.called("option.set");
  expect([title[0], title[1]]).toEqual(["title", "Shell Scripts"]);
  expect([icon[0], icon[1]]).toEqual(["@icon", "terminal"]);
  expect(title[2]).toEqual(icon[2]);
});

test("a page a reload left behind is not added again", async () => {
  await start([7]);
  expect(app.called("pane.open")).toEqual([]);
  expect(app.called("option.set")).toEqual([]);
});
