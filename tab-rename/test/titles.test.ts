import { expect, test } from "bun:test";
import { basename, clean, key, topic } from "../src/titles.ts";

test("an agent's title is the task it names", () => {
  expect(topic("π - Fixing double-press c key binding bug - me", "pi", "me")).toBe("Fixing double-press c key binding bug");
  expect(topic("✳ Refactor the auth middleware", "claude")).toBe("Refactor the auth middleware");
  expect(topic("⠐ Claude Code", "claude")).toBeNull();
  // A title that is only the agent and its folder says nothing.
  expect(topic("π - pumi", "pi", "pumi")).toBeNull();
  expect(topic("~/code/pumi", "pi")).toBeNull();
  expect(topic("", "pi")).toBeNull();
});

test("the model's answer becomes a tab name", () => {
  expect(clean("Key Binding Fix", 3)).toBe("Key Binding Fix");
  expect(clean('"DoublePressKeyBinding"', 3)).toBe("Double Press Key Binding");
  expect(clean("Screenshot UI Redesign!", 3)).toBe("Screenshot UI Redesign");
  expect(clean("One Two Three Four Five Six", 2)).toBe("One Two Three");
  expect(clean("🚀 Node.js Upgrade", 3)).toBe("Node.js Upgrade");
  expect(clean("  ...  ", 3)).toBeNull();
  expect(clean("Screenshot Ui Redesign", 3, ["Redesign screenshot UI"])).toBe("Screenshot UI Redesign");
});

test("the same topics are the same key", () => {
  expect(key(["a", "b"], 3)).toBe(key(["a", "b"], 3));
  expect(key(["a", "b"], 3)).not.toBe(key(["a", "b"], 2));
  expect(basename("/Users/me/pumi/")).toBe("pumi");
});
