// The page against pumi/testing's fake app: the repository is a temporary one `format.eval` says
// the current pane is in, and its scripts are shell scripts: a `#!` naming a shell, or a `.sh` file.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");
const main = new URL("../src/main.ts", import.meta.url);
let app: FakeApp;
let repo = "";

afterEach(() => {
  app?.stop();
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = "";
});

/** The file `path` in the repository, executable when `executable` says so. */
function write(path: string, text = "", executable = false): void {
  const at = join(repo, path);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text, { mode: executable ? 0o755 : 0o644 });
}

/**
 * A repository of scripts (`{ "scripts/build.sh": ["#!/bin/bash", true] }`) and the app whose
 * current pane is in it. It answers `pane.list` with one page, so startup adds no sidebar page.
 */
async function start(
  scripts: Record<string, [text: string, executable?: boolean]> = {},
  options: Record<string, unknown> = {},
): Promise<FakeApp> {
  repo = mkdtempSync(join(tmpdir(), "shell-scripts-page-"));
  mkdirSync(join(repo, ".git"));
  for (const [path, [text, executable]] of Object.entries(scripts)) write(path, text, executable);
  app = await FakeApp.start({
    dir,
    main,
    options,
    answers: { "format.eval": () => repo, "pane.list": [7] },
  });
  return app;
}

test("the page lists the repository's scripts, grouped and counting them", async () => {
  await start({
    "scripts/build.sh": ["#!/usr/bin/env bash\n", true],
    "scripts/deploy": ["#!/bin/zsh\n"],
    "top.sh": ["", false],
  });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text("#group-0")).toBe("▾.1");
  expect(page.text("#item-0-0")).toBe("top.shsh top.sh");
  expect(page.text("#group-1")).toBe("▾scripts2");
  expect(page.text("#item-1-0")).toBe("build.shbash build.sh");
  expect(page.text("#item-1-1")).toBe("deployzsh deploy");
  expect(page.text()).toBe(
    "3 scripts · 2 placesRescan▾.1top.shsh top.sh▾scripts2build.shbash build.shdeployzsh deploy",
  );
  expect(page.snapshot()).toMatchSnapshot();
  expect(page.errors).toEqual([]);
});

test("an item opens a terminal in its directory and types its command there", async () => {
  await start({ "scripts/deploy": ["#!/bin/zsh\n"] });
  const page = app.open("scripts");
  await app.settle();
  await page.click("#item-0-0");
  expect(app.called("pane.open")).toEqual([["terminal", { cwd: join(repo, "scripts") }, {}]]);
  expect(app.called("pane.call")).toEqual([[expect.any(Number), "input", { text: "zsh deploy\r" }]]);
});

test("its own option that changed is read again, and the page scanned again", async () => {
  await start({ "scripts/build.sh": ["#!/bin/bash\n"], "scripts/deploy": ["#!/bin/zsh\n"] });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text("#group-0")).toBe("▾scripts2");
  app.options.set("local.shell_scripts.shebang", false);
  await app.fire("option.changed", { name: "local.shell_scripts.shebang" }, { match: "local.shell_scripts.shebang" });
  expect(page.text("#group-0")).toBe("▾scripts1");
  expect(page.text()).toBe("1 script · 1 placeRescan▾scripts1build.shbash build.sh");
});

test("the commands show only when its option says so", async () => {
  await start({ "scripts/build.sh": ["#!/bin/bash\n"] }, { show_command: false });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text("#item-0-0")).toBe("build.sh");
});

test("a repository of no scripts says so", async () => {
  await start({ "notes.txt": ["nothing to run\n"] });
  const page = app.open("scripts");
  await app.settle();
  expect(page.text()).toBe("0 scripts · 0 placesRescanNo shell scripts found");
});
