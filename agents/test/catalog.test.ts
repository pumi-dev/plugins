// The catalog: the choices each agent has, the one `modes` gives it, how that opens it, and what
// "Open agents in" (`prefer`) sets them all to.
import { expect, test } from "bun:test";

import { CATALOG, catalogAgent, choiceOf, choicesOf, followsPrefer, guiMode, modeOf, preferOf, preferred } from "../src/catalog.ts";

const agent = (id: string) => catalogAgent(id)!;

test("an agent with an SDK or ACP has a GUI; one with neither has Off and Terminal", () => {
  expect(choicesOf(agent("claude"))).toEqual(["off", "terminal", "gui"]);
  expect(choicesOf(agent("kiro"))).toEqual(["off", "terminal", "gui"]);
  expect(choicesOf(agent("omp"))).toEqual(["off", "terminal"]);
  expect(choicesOf(agent("amp"))).toEqual(["off", "terminal"]);
  for (const each of CATALOG) expect(choicesOf(each)).toContain(each.default);
});

test("a choice is what `modes` says, else the default; ACP and SDK are GUI, Chat over the terminal is Terminal", () => {
  expect(choiceOf(agent("kiro"), undefined)).toBe("terminal");
  expect(choiceOf(agent("kiro"), { kiro: "gui" })).toBe("gui");
  expect(choiceOf(agent("kiro"), { kiro: "acp" })).toBe("gui");
  expect(choiceOf(agent("pi"), { pi: "sdk" })).toBe("gui");
  expect(choiceOf(agent("pi"), { pi: "chat" })).toBe("terminal");
  expect(choiceOf(agent("amp"), { amp: "gui" })).toBe("terminal");
  expect(choiceOf(agent("pi"), { pi: "off" })).toBe("off");
});

test("a GUI runs the SDK, else ACP; with ACP preferred, ACP, else the SDK", () => {
  expect(guiMode(agent("pi"))).toBe("sdk");
  expect(guiMode(agent("pi"), "acp")).toBe("acp");
  expect(guiMode(agent("kiro"))).toBe("acp");
  expect(guiMode(agent("kiro"), "sdk")).toBe("acp");
  expect(guiMode(agent("amp"))).toBeUndefined();
  expect(modeOf(agent("codex"), { codex: "gui" })).toBe("sdk");
  expect(modeOf(agent("codex"), { codex: "gui" }, "acp")).toBe("acp");
  expect(modeOf(agent("codex"), { codex: "terminal" }, "sdk")).toBe("terminal");
  expect(modeOf(agent("codex"), { codex: "off" })).toBe("off");
});

test("Open agents in sets every agent, those off left off", () => {
  const modes = { pi: "off", claude: "terminal" };
  const gui = preferred(modes, "sdk");
  expect(gui.pi).toBe("off");
  expect(gui.claude).toBe("gui");
  expect(gui.kiro).toBe("gui");
  expect(gui.amp).toBe("terminal");
  expect(Object.values(preferred({ ...gui, pi: "off" }, "terminal")).filter((c) => c !== "off").every((c) => c === "terminal")).toBe(true);
  expect(preferOf("acp")).toBe("acp");
  expect(preferOf("chat")).toBe("terminal");
});

test("Open agents in sets every agent when it changes, and at start when set before any agent has a choice", () => {
  expect(followsPrefer("terminal", "sdk", { pi: "terminal" })).toBe(true);
  expect(followsPrefer("sdk", "sdk", {})).toBe(false);
  // Set as the plugin was installed: the first start follows it.
  expect(followsPrefer(undefined, "sdk", {})).toBe(true);
  expect(followsPrefer(undefined, "sdk", undefined)).toBe(true);
  // An agent set by hand, or the terminal (every default), is left as it is.
  expect(followsPrefer(undefined, "sdk", { pi: "terminal" })).toBe(false);
  expect(followsPrefer(undefined, "terminal", {})).toBe(false);
});
