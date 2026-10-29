// The catalog: which modes each agent has, and the mode `modes` gives it.
import { expect, test } from "bun:test";

import { CATALOG, catalogAgent, modeOf, modesOf } from "../src/catalog.ts";

test("each agent has the modes its integrations give it", () => {
  expect(modesOf(catalogAgent("claude")!)).toEqual(["off", "terminal", "chat", "acp", "sdk"]);
  expect(modesOf(catalogAgent("omp")!)).toEqual(["off", "terminal", "chat"]);
  expect(modesOf(catalogAgent("kiro")!)).toEqual(["off", "terminal", "acp"]);
  expect(modesOf(catalogAgent("amp")!)).toEqual(["off", "terminal"]);
  for (const agent of CATALOG) expect(modesOf(agent)).toContain(agent.default);
});

test("a mode is what `modes` says, else the default; one an agent lacks is the default", () => {
  const kiro = catalogAgent("kiro")!;
  expect(modeOf(kiro, undefined)).toBe("terminal");
  expect(modeOf(kiro, { kiro: "acp" })).toBe("acp");
  expect(modeOf(kiro, { kiro: "sdk" })).toBe("terminal");
  expect(modeOf(catalogAgent("pi")!, { pi: "off" })).toBe("off");
});
