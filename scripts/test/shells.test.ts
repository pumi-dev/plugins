// The shell half of the page: what is a script, and with which shell it runs — over a temporary
// repository, with no pumi running (`groupScripts` walks it, `shellGroups` says what a directory
// holds).
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groupScripts } from "../../lib/script-panel/src/finder.ts";

import { defaults, finder } from "../src/read.ts";
import { interpreter, parseExtensions, shellOf, shellGroups, type ShellSettings } from "../src/shells.ts";
import { temp } from "./files.ts";

/** The shell settings the options' defaults say. */
const shells = (): ShellSettings => ({ extensions: parseExtensions("sh, bash, zsh, ksh, fish"), shebang: true });

let repo = "";

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = "";
});

/** A repository: `.git`, and whatever `write` puts in it. */
function repository(): string {
  repo = temp("shells");
  mkdirSync(join(repo, ".git"));
  return repo;
}

/** The file `path` in the repository, executable when `executable` says so. */
function write(path: string, text = "", executable = false): void {
  const at = join(repo, path);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text, { mode: executable ? 0o755 : 0o644 });
}

/** Every shell script found below `root`, as `label: command`. */
function found(root: string, settings = defaults()): string[] {
  return groupScripts(finder(settings), root).flatMap((group) => group.items.map((item) => `${group.label}: ${item.command}`));
}

/** The page's finder with only the shell half on, as `over` says it. */
function onlyShells(over: Partial<Parameters<typeof defaults>[0]> = {}) {
  return defaults({ ...over, packages: false });
}

test("a shebang names its shell, through env and its switches", () => {
  expect(shellOf("#!/bin/bash")).toBe("bash");
  expect(shellOf("#!/usr/bin/env bash")).toBe("bash");
  expect(shellOf("#!/usr/bin/env -S zsh -e")).toBe("zsh");
  expect(shellOf("#!/bin/sh -eu")).toBe("sh");
  expect(shellOf("#! /usr/local/bin/FISH")).toBe("fish");
  expect(shellOf("#!/usr/bin/env python3")).toBeNull();
  expect(shellOf("#!/usr/bin/env -S")).toBeNull();
  expect(shellOf("#!/")).toBeNull();
  expect(shellOf("print('#!/bin/bash')")).toBeNull();
  expect(shellOf("")).toBeNull();
});

test("extensions are trimmed, lowercased and must be plain names", () => {
  expect([...parseExtensions("sh, .Bash ,, bad ext, c++, awk")].sort()).toEqual(["awk", "bash", "c++", "sh"]);
  expect([...parseExtensions("")]).toEqual([]);
});

test("scripts are found and run with their shell, executable or not", () => {
  const root = repository();
  write("scripts/build.sh", "#!/usr/bin/env bash\necho hi\n", true);
  write("scripts/deploy", "#!/bin/zsh\n");
  write("scripts/tool.py", "#!/usr/bin/env python3\n");
  write("scripts/notes", "just text\n");
  expect(found(root)).toEqual(["scripts: bash build.sh", "scripts: zsh deploy"]);
});

test("a script is named to its shell, so one without its executable bit runs too", () => {
  const root = repository();
  write("build.sh", "#!/bin/bash\n", true);
  write("check.sh", "#!/bin/bash\n");
  expect(found(root)).toEqual([".: bash build.sh", ".: bash check.sh"]);
});

test("an extension that is no shell's still runs with sh, and its #! wins when it names one", () => {
  const root = repository();
  write("build.xx", "#!/usr/bin/env bash\n");
  write("deploy.xx", "no shebang here\n");
  expect(found(root, onlyShells({ extensions: parseExtensions("xx") }))).toEqual([".: bash build.xx", ".: sh deploy.xx"]);
});

test("a #! line is read only when the options say so, and only for a file without an extension", () => {
  const root = repository();
  write("deploy", "#!/bin/zsh\n");
  write("notes", "just text\n");
  write("tool.py", "#!/bin/zsh\n");
  expect(found(root)).toEqual([".: zsh deploy"]);
  expect(found(root, onlyShells({ shebang: false }))).toEqual([]);
});

test("hidden files, directories and the options' depth are respected", () => {
  const root = repository();
  write(".hidden.sh", "#!/bin/sh\n");
  write("one/run.sh", "#!/bin/sh\n");
  write("one/two/deep.sh", "#!/bin/sh\n");
  mkdirSync(join(root, "dir.sh"), { recursive: true });
  expect(found(root)).toEqual(["one: sh run.sh", "one/two: sh deep.sh"]);
  expect(found(root, onlyShells({ depth: 1 }))).toEqual(["one: sh run.sh"]);
});

test("a directory's shell scripts are one group, headed by its path and a terminal's glyph", () => {
  const root = repository();
  write("one/run.sh", "#!/bin/sh\n");
  write("one/check.sh", "#!/bin/bash\n");
  expect(shellGroups(shells(), join(root, "one"), root)).toEqual([
    {
      label: "one",
      dir: join(root, "one"),
      icon: "terminal",
      items: [
        { name: "check.sh", detail: "bash check.sh", command: "bash check.sh" },
        { name: "run.sh", detail: "sh run.sh", command: "sh run.sh" },
      ],
    },
  ]);
  expect(shellGroups(shells(), join(root, "nowhere"), root)).toEqual([]);
  expect(interpreter(shells(), "build.sh", join(root, "build.sh"))).toBe("sh");
});
