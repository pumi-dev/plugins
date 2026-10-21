// The page against pumi/testing's fake app: no pumi running. The repository is a temporary one
// `format.eval` says the current pane is in, and its scripts are `package.json` files' in it.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

import { manifest, temp, write } from "./files.ts";

/** The package's directory: its package.json is the manifest the fake reads the view from. */
const dir = join(import.meta.dir, "..");
const main = new URL("../src/main.ts", import.meta.url);

let running: FakeApp | undefined;
let repo = "";

afterEach(() => {
  running?.stop();
  running = undefined;
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = "";
});

/**
 * The app on a repository of `files` (`"packages/ui/package.json"` → its text), its pane in it, and
 * the panes of the page's type `there` already has.
 */
async function start(files: Record<string, string> = {}, options: Record<string, unknown> = {}, there: number[] = []): Promise<FakeApp> {
  repo = temp("page");
  mkdirSync(join(repo, ".git"), { recursive: true });
  for (const [path, text] of Object.entries(files)) write(repo, path, text);
  running = await FakeApp.start({
    dir,
    main,
    options,
    answers: { "format.eval": () => repo, "pane.list": () => there },
  });
  return running;
}

test("the page lists every package's scripts, grouped and counting them", async () => {
  const app = await start({
    "package.json": manifest({ test: "bun test", build: "tsc -p ." }, { packageManager: "pnpm@9.1.0", workspaces: ["packages/*"] }),
    "packages/ui/package.json": manifest({ "test:unit": "vitest" }),
    "packages/ui/yarn.lock": "",
    "node_modules/dep/package.json": manifest({ x: "x" }),
  });
  const page = app.open("scripts");
  await app.settle();
  expect(page.errors).toEqual([]);
  expect(page.text("#group-0")).toBe("▾package.json2");
  expect(page.text("#item-0-0")).toBe("buildtsc -p .");
  expect(page.text("#item-0-1")).toBe("testbun test");
  expect(page.text("#group-1")).toBe("▾packages/ui/package.json1");
  expect(page.text("#item-1-0")).toBe("test:unitvitest");
  expect(page.text()).toBe(
    "3 scripts · 2 placesRescan▾package.json2buildtsc -p .testbun test▾packages/ui/package.json1test:unitvitest",
  );
  expect(page.snapshot()).toMatchSnapshot();
});

test("an item runs its script in its package's directory, with that package's manager", async () => {
  const app = await start({
    "package.json": manifest({ build: "tsc -p ." }, { packageManager: "pnpm@9.1.0", workspaces: ["packages/*"] }),
    "packages/ui/package.json": manifest({ "test:unit": "vitest" }),
    "packages/ui/yarn.lock": "",
  });
  const page = app.open("scripts");
  await app.settle();
  await page.click("#item-0-0");
  expect(app.called("pane.open").filter(([type]) => type === "terminal")).toEqual([["terminal", { cwd: repo }, {}]]);
  expect(app.called("pane.call")).toEqual([[expect.any(Number), "input", { text: "pnpm run build\r" }]]);
  await page.click("#item-1-0");
  expect(app.called("pane.open").filter(([type]) => type === "terminal")).toEqual([
    ["terminal", { cwd: repo }, {}],
    ["terminal", { cwd: join(repo, "packages/ui") }, {}],
  ]);
  expect(app.called("pane.call").at(-1)).toEqual([expect.any(Number), "input", { text: "yarn run test:unit\r" }]);
});

test("a repository without a package.json with scripts says so", async () => {
  const app = await start({ "package.json": JSON.stringify({ name: "no scripts" }) });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text()).toBe("0 scripts · 0 placesRescanNo package.json with scripts found");
});

test("the pages with most scripts come first when the option says", async () => {
  const app = await start(
    {
      "package.json": manifest({ build: "tsc -p ." }, { workspaces: ["packages/*"] }),
      "packages/ui/package.json": manifest({ test: "vitest", lint: "eslint ." }),
    },
    { sort: "scripts" },
  );
  const page = app.open("scripts");
  await app.settle();
  expect(page.text("#group-0")).toBe("▾packages/ui/package.json2");
  expect(page.text("#group-1")).toBe("▾package.json1");
});

test("the commands show only when the option says so", async () => {
  const app = await start({ "package.json": manifest({ build: "tsc -p ." }) }, { show_command: false });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text("#item-0-0")).toBe("build");
});

test("the page is put in the left sidebar at startup, titled and with its icon", async () => {
  const app = await start();
  expect(app.called("pane.open")).toEqual([[`${app.init.prefix}scripts`, {}, { kind: "slot", slot: "sidebar.left", order: 30, focus: false }]]);
  expect(app.called("option.set")).toEqual([
    ["title", "NPM Scripts", { pane: expect.any(Number) }],
    ["@icon", "package", { pane: expect.any(Number) }],
  ]);
});

test("a page already in the sidebar is left alone", async () => {
  const app = await start({}, {}, [7]);
  expect(app.called("pane.open")).toEqual([]);
  expect(app.called("option.set")).toEqual([]);
});
