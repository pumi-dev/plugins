// The page against pumi/testing's fake app: no pumi running. The repository is a temporary one
// `format.eval` says the current pane is in, and its scripts are `test/runs.ts`'s `.run` files.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";
import type { Manifest } from "pumi";

/** The manifest `script-panel`'s own package.json has, with a view and options the tests drive. */
const manifest: Manifest = {
  name: "script-panel",
  api: 1,
  contributes: {
    views: [{ id: "scripts", title: "Scripts", icon: "list" }],
    options: {
      depth: { type: "number", default: 4, desc: "How many directories below the repository root to look in." },
      commands: { type: "boolean", default: true, desc: "Show how each script runs, beside its name." },
    },
  },
};

const dir = join(import.meta.dir, "..");
const main = new URL("./panel-main.ts", import.meta.url);
let app: FakeApp;
let repo = "";

afterEach(() => {
  app?.stop();
  if (repo) rmSync(repo, { recursive: true, force: true });
});

/** Writes a file, making its directories. */
function write(root: string, path: string, text = "") {
  const at = join(root, path);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text);
}

/** A repository of `.run` files (`"tools/a": ["test.run"]`), and the app whose pane is in it. */
async function start(scripts: Record<string, string[]> = {}, options: Record<string, unknown> = {}): Promise<FakeApp> {
  repo = mkdtempSync(join(tmpdir(), "script-panel-page-"));
  mkdirSync(join(repo, ".git"));
  for (const [where, names] of Object.entries(scripts)) for (const name of names) write(repo, join(where, name));
  app = await FakeApp.start({
    dir,
    main,
    manifest,
    options,
    answers: { "format.eval": () => repo },
  });
  return app;
}

test("the page lists the repository's scripts, grouped and counting them", async () => {
  await start({ "": ["build.run"], tools: ["one.run", "test.run"] });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text("#group-0")).toBe("▾.1");
  expect(page.text("#item-0-0")).toBe("build.runsh build.run");
  expect(page.text("#group-1")).toBe("▾tools2");
  expect(page.text("#item-1-0")).toBe("one.runsh one.run");
  expect(page.text("#item-1-1")).toBe("test.runsh test.run");
  expect(page.text()).toBe("3 scripts · 2 placesRescan▾.1build.runsh build.run▾tools2one.runsh one.runtest.runsh test.run");
  expect(page.snapshot()).toMatchSnapshot();
  expect(page.errors).toEqual([]);
});

test("a group folds its items away, and unfolds them", async () => {
  await start({ "": ["build.run"], tools: ["one.run"] });
  const page = app.open("scripts");
  await app.settle();
  await page.click("#group-1");
  expect(page.findAll((node) => (node.props.id ?? "").startsWith("item-1-"))).toEqual([]);
  expect(page.text("#group-1")).toBe("▸tools1");
  expect(page.text()).toBe("2 scripts · 2 placesRescan▾.1build.runsh build.run▸tools1");
});

test("an item opens a terminal in its directory and types its command there", async () => {
  await start({ tools: ["one.run"] });
  const page = app.open("scripts");
  await app.settle();
  await page.click("#item-0-0");
  expect(app.called("pane.open")).toEqual([["terminal", { cwd: join(repo, "tools") }, {}]]);
  expect(app.called("pane.call")).toEqual([[expect.any(Number), "input", { text: "sh one.run\r" }]]);
});

test("a page that finds nothing says so", async () => {
  await start({ tools: ["notes.txt"] });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text()).toBe("0 scripts · 0 placesRescanNo .run files found");
});

test("the commands show only when the finder's options say so", async () => {
  await start({ tools: ["one.run"] }, { commands: false });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text("#item-0-0")).toBe("one.run");
});

test("Rescan lists what the repository holds now", async () => {
  await start({ tools: ["one.run"] });
  const page = app.open("scripts");
  await app.settle();
  write(repo, "tools/two.run");
  await page.click("#rescan");
  expect(page.text("#group-0")).toBe("▾tools2");
});

test("the page follows the current pane's repository", async () => {
  await start({ tools: ["one.run"] });
  const page = app.open("scripts");
  await app.settle();
  const other = mkdtempSync(join(tmpdir(), "script-panel-other-"));
  mkdirSync(join(other, ".git"));
  write(other, "deploy.run");
  app.answer("format.eval", () => other);
  await app.fire("cwd.changed", { cwd: other }, { match: other });
  expect(page.text()).toBe("1 script · 1 placeRescan▾.1deploy.runsh deploy.run");
  rmSync(other, { recursive: true, force: true });
});

test("an option that changed is read again, and the page scanned again", async () => {
  await start({ "": ["top.run"], "one/two": ["deep.run"] });
  let page = app.open("scripts");
  await app.settle();
  expect(page.text()).toBe("2 scripts · 2 placesRescan▾.1top.runsh top.run▾one/two1deep.runsh deep.run");
  app.options.set("local.script_panel.depth", 1);
  await app.fire("option.changed", { name: "local.script_panel.depth" }, { match: "local.script_panel.depth" });
  expect(page.text()).toBe("1 script · 1 placeRescan▾.1top.runsh top.run");
  await page.close();
  // A page opened after the change reads the options itself.
  page = app.open("scripts");
  await app.settle();
  expect(page.text()).toBe("1 script · 1 placeRescan▾.1top.runsh top.run");
});

test("a closed page looks no more", async () => {
  await start({ tools: ["one.run"] });
  const page = app.open("scripts");
  await app.settle();
  const looked = app.called("format.eval").length;
  page.close();
  await app.fire("cwd.changed", { cwd: repo }, { match: repo });
  await app.fire("option.changed", { name: "local.script_panel.depth" }, { match: "local.script_panel.depth" });
  expect(app.called("format.eval").length).toBe(looked);
});
