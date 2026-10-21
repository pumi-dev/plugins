// Where the sockets go: the data directory the server keeps its own in, and herdr's session
// directories, from an environment the test can write.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appName, dataDir, herdrConfigDir, home, sessionDir } from "../src/paths.ts";

const temp = () => mkdtempSync(join(tmpdir(), "herdr-paths-"));

test("pumi's data directory, as $PUMI_DATA_DIR says it", () => {
  expect(dataDir({ PUMI_DATA_DIR: "/tmp/d" })).toBe("/tmp/d");
  // Empty is as good as unset.
  expect(dataDir({ PUMI_DATA_DIR: "", HOME: "/h", XDG_DATA_HOME: "/x" })).toBe("/x/pumi");
});

test("else the platform's, for the app's name", () => {
  const mac = temp();
  mkdirSync(join(mac, "Library/Application Support"), { recursive: true });
  expect(dataDir({ HOME: mac }, `${mac}/Library/Application Support/pumi-dev/packages/amresyd.herdr`)).toBe(
    join(mac, "Library", "Application Support", "pumi-dev"),
  );
  // No Library: the XDG data home, or ~/.local/share when that is not set either.
  const linux = temp();
  expect(dataDir({ HOME: linux, XDG_DATA_HOME: "/x" })).toBe("/x/pumi");
  expect(dataDir({ HOME: "/h" })).toBe("/h/.local/share/pumi");
});

test("the app's name: $PUMI_APPNAME, else the one above the packages, else pumi", () => {
  expect(appName({ PUMI_APPNAME: "pumi-dev" })).toBe("pumi-dev");
  expect(appName({ PUMI_APPNAME: "" }, "/s/pumi/packages/amresyd.herdr")).toBe("pumi");
  expect(appName({}, "/s/pumi/packages/amresyd.herdr")).toBe("pumi");
  expect(appName({})).toBe("pumi");
  expect(home({ HOME: "/h" })).toBe("/h");
  expect(home({})).toBe("/");
});

test("herdr's session directories", () => {
  expect(herdrConfigDir({ HOME: "/h" })).toBe("/h/.config/herdr");
  expect(herdrConfigDir({ HOME: "/h", XDG_CONFIG_HOME: "/c" })).toBe("/c/herdr");
  expect(sessionDir("pumi", { HOME: "/h" })).toBe("/h/.config/herdr/sessions/pumi");
  // herdr's own default session is its config directory.
  expect(sessionDir("default", { HOME: "/h" })).toBe("/h/.config/herdr");
  expect(sessionDir("-", { HOME: "/h" })).toBe("/h/.config/herdr");
  // Names herdr would not take.
  expect(sessionDir("", { HOME: "/h" })).toBeUndefined();
  expect(sessionDir(".", { HOME: "/h" })).toBeUndefined();
  expect(sessionDir("..", { HOME: "/h" })).toBeUndefined();
  expect(sessionDir("a/b", { HOME: "/h" })).toBeUndefined();
  expect(sessionDir("ünï", { HOME: "/h" })).toBeUndefined();
  expect(sessionDir("x".repeat(65), { HOME: "/h" })).toBeUndefined();
  expect(sessionDir("x".repeat(64), { HOME: "/h" })).toBe(join("/h", ".config", "herdr", "sessions", "x".repeat(64)));
  expect(sessionDir("work_1.a-b", { HOME: "/h" })).toBe("/h/.config/herdr/sessions/work_1.a-b");
});
