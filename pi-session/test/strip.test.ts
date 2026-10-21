// The view `strip`: its two buttons, and what each does with what its pane says.
import { afterEach, expect, test } from "bun:test";

import type { FakeApp, RenderedView } from "pumi/testing";

import { fake } from "./fake.ts";

const ID = "0198c3e2-7a51-7c62-9a53-3f1a2b4c5d6e";
const FILE = `/s/2026-10-17T10-00-00_${ID}.jsonl`;
let app: FakeApp;
afterEach(() => app?.stop());

/** The strip for pane `at`, with what that pane says of itself (`@agent_session`, `pane_current_path`). */
async function strip(said: Record<string, unknown>, opts: { options?: Record<string, unknown>; at?: number } = {}): Promise<RenderedView> {
  const started = await fake({ said, panes: { terminal: [] } }, opts.options);
  app = started.app;
  const at = opts.at ?? 7;
  return app.open("strip", { args: { pane: at } });
}

test("it draws Fork and Copy at the end of the strip", async () => {
  const view = await strip({ [`@agent_session@7`]: ID, [`pane_current_path@7`]: "/repo" });
  expect(view.snapshot()).toMatchSnapshot();
  expect(view.errors).toEqual([]);
});

test("Fork opens pi --fork <session> beside the pane, in its directory", async () => {
  const view = await strip({ [`@agent_session@7`]: ID, [`pane_current_path@7`]: "/repo" });
  await view.click("#fork");
  expect(app.called("pane.open")).toEqual([["terminal", { command: ["pi", "--fork", ID], cwd: "/repo" }, { beside: 7, split: "right" }]]);
  expect(app.notices).toEqual([]);
});

test("the fork goes where the side option says, and runs the command option", async () => {
  const view = await strip({ [`@agent_session@7`]: ID }, { options: { side: "down", command: "/opt/bin/pi --yolo" } });
  await view.click("#fork");
  expect(app.called("pane.open")).toEqual([["terminal", { command: ["/opt/bin/pi --yolo", "--fork", ID] }, { beside: 7, split: "down" }]]);
});

test("Copy puts the session's id, path and directory on the clipboard", async () => {
  const view = await strip({ [`@agent_session@7`]: FILE, [`pane_current_path@7`]: "/repo" });
  await view.click("#copy");
  const summary = `pi session ${ID}\npath: ${FILE}\ncwd:  /repo`;
  expect(app.called("system.clipboard.set")).toEqual([[summary]]);
  expect(app.notices).toEqual([{ msg: `Copied\n${summary}`, level: "info" }]);
});

test("a pane pi has not named a session for is said so, not acted on", async () => {
  const view = await strip({});
  await view.click("#fork");
  await view.click("#copy");
  expect(app.called("pane.open")).toEqual([]);
  expect(app.called("system.clipboard.set")).toEqual([]);
  expect(app.notices).toEqual([
    { msg: "pi-session: pi has not said which session it is in", level: "error" },
    { msg: "pi-session: pi has not said which session it is in", level: "error" },
  ]);
});

test("a strip opened without its pane acts on the pane it is in", async () => {
  const started = await fake({ said: { "@agent_session@4": ID }, panes: { terminal: [] } });
  app = started.app;
  const view = app.open("strip", { pane: 4 });
  await view.click("#fork");
  expect(app.called("pane.open")).toEqual([["terminal", { command: ["pi", "--fork", ID] }, { beside: 4, split: "right" }]]);
});
