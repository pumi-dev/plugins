// The PATH agents are found and run on: an app opened from the Dock has a short one, so the login
// shell's is read and put first.
import { expect, test } from "bun:test";

import { isShortPath, mergePaths, pathAfterMark } from "../src/session/launch.ts";

const home = "/Users/me";

test("the Dock's PATH is short; a shell's, with the user's own directories, is not", () => {
  expect(isShortPath("/usr/bin:/bin:/usr/sbin:/sbin", home)).toBe(true);
  expect(isShortPath(undefined, home)).toBe(true);
  expect(isShortPath("/Users/me/.nvm/versions/node/v24/bin:/usr/bin", home)).toBe(false);
  // A directory beside home, not in it.
  expect(isShortPath("/Users/meme/bin:/usr/bin", home)).toBe(true);
});

test("a PATH with only the directories pumi adds for an app opened from the Dock is still short", () => {
  expect(isShortPath("/Users/me/.local/bin:/Users/me/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", home)).toBe(true);
  expect(isShortPath("/Users/me/.local/bin:/Users/me/.nvm/versions/node/v24/bin:/usr/bin", home)).toBe(false);
});

test("the PATH is what the shell says after the mark, past what its startup files print", () => {
  expect(pathAfterMark("Welcome!\n\x1b[1mmotd\x1b[0m\n__pumi_agents_path__\n/a/bin:/usr/bin\n")).toBe("/a/bin:/usr/bin");
  expect(pathAfterMark("__pumi_agents_path__\r\n/a/bin\r\n")).toBe("/a/bin");
  expect(pathAfterMark("no mark\n/a/bin\n")).toBeUndefined();
  expect(pathAfterMark("__pumi_agents_path__\n")).toBeUndefined();
});

test("the login shell's directories come first, then the app's not in them", () => {
  expect(mergePaths("/nvm/bin:/usr/bin", "/usr/bin:/bin")).toBe("/nvm/bin:/usr/bin:/bin");
  expect(mergePaths(undefined, "/usr/bin:/bin")).toBe("/usr/bin:/bin");
});
