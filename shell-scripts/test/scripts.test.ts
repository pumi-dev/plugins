// What is a script, and with which shell it runs: the rules of `shell-scripts` over a temporary
// repository, with no pumi running (`groupScripts` walks it, `finder` says what each directory
// holds).
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupScripts } from "../../lib/script-panel/src/finder.ts";

import { finder, interpreter, parseExtensions, shellOf, type Settings } from "../src/scripts.ts";

/** The settings the options' defaults say. */
function defaults(over: Partial<Settings> = {}): Settings {
  return {
    depth: 4,
    extensions: parseExtensions("sh, bash, zsh, ksh, fish"),
    shebang: true,
    showCommand: true,
    ...over,
  };
}

let repo = "";

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = "";
});

/** A repository: `.git`, and whatever `write` puts in it. */
function repository(): string {
  repo = mkdtempSync(join(tmpdir(), "shell-scripts-"));
  mkdirSync(join(repo, ".git"));
  return repo;
}

/** The file `path` in the repository, executable when `executable` says so. */
function write(path: string, text = "", executable = false): void {
  const at = join(repo, path);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text, { mode: executable ? 0o755 : 0o644 });
}

/** Every script found below `root`, as `label: command`. */
function found(root: string, settings = defaults()): string[] {
  return groupScripts(finder(settings), root).flatMap((group) =>
    group.items.map((item) => `${group.label}: ${item.command}`),
  );
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
  expect(found(root, defaults({ extensions: parseExtensions("xx") }))).toEqual([".: bash build.xx", ".: sh deploy.xx"]);
});

test("a #! line is read only when the options say so, and only for a file without an extension", () => {
  const root = repository();
  write("deploy", "#!/bin/zsh\n");
  write("notes", "just text\n");
  write("tool.py", "#!/bin/zsh\n");
  expect(found(root)).toEqual([".: zsh deploy"]);
  expect(found(root, defaults({ shebang: false }))).toEqual([]);
});

test("hidden files, directories and the options' depth are respected", () => {
  const root = repository();
  write(".hidden.sh", "#!/bin/sh\n");
  write("one/run.sh", "#!/bin/sh\n");
  write("one/two/deep.sh", "#!/bin/sh\n");
  mkdirSync(join(root, "dir.sh"), { recursive: true });
  expect(found(root)).toEqual(["one: sh run.sh", "one/two: sh deep.sh"]);
  expect(found(root, defaults({ depth: 1 }))).toEqual(["one: sh run.sh"]);
});

test("the finder says what to call what it lists, and what to say when there is nothing", () => {
  const find = finder(defaults({ depth: 2, showCommand: false }));
  expect(find.depth).toBe(2);
  expect(find.showDetail).toBe(false);
  expect(find.empty).toBe("No shell scripts found");
  expect(interpreter(defaults(), "build.sh", join(repository(), "build.sh"))).toBe("sh");
});
