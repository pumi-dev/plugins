// The catalog: the choices each agent has, the one `modes` gives it, and how that opens it.
import { expect, test } from "bun:test";

import { CATALOG, catalogAgent, choiceOf, choicesOf, modeOf } from "../src/catalog.ts";

test("an agent the plugin can show as a chat has Chat; one it cannot has Off and Terminal", () => {
  expect(choicesOf(catalogAgent("claude")!)).toEqual(["off", "terminal", "chat"]);
  expect(choicesOf(catalogAgent("omp")!)).toEqual(["off", "terminal", "chat"]);
  expect(choicesOf(catalogAgent("kiro")!)).toEqual(["off", "terminal", "chat"]);
  expect(choicesOf(catalogAgent("amp")!)).toEqual(["off", "terminal"]);
  for (const agent of CATALOG) expect(choicesOf(agent)).toContain(agent.default);
});

test("a choice is what `modes` says, else the default; ACP and SDK are Chat now", () => {
  const kiro = catalogAgent("kiro")!;
  expect(choiceOf(kiro, undefined)).toBe("terminal");
  expect(choiceOf(kiro, { kiro: "chat" })).toBe("chat");
  expect(choiceOf(kiro, { kiro: "acp" })).toBe("chat");
  expect(choiceOf(catalogAgent("pi")!, { pi: "sdk" })).toBe("chat");
  expect(choiceOf(catalogAgent("amp")!, { amp: "chat" })).toBe("terminal");
  expect(choiceOf(catalogAgent("pi")!, { pi: "off" })).toBe("off");
});

test("Chat is the terminal with the chat over it where the plugin reads the agent, else ACP", () => {
  expect(modeOf(catalogAgent("claude")!, { claude: "chat" })).toBe("chat");
  expect(modeOf(catalogAgent("pi")!, { pi: "acp" })).toBe("chat");
  expect(modeOf(catalogAgent("kiro")!, { kiro: "chat" })).toBe("acp");
  expect(modeOf(catalogAgent("codex")!, { codex: "terminal" })).toBe("terminal");
  expect(modeOf(catalogAgent("codex")!, { codex: "off" })).toBe("off");
});
