// The agents' marks (`src/icons.ts`): each one, a file of its sub-plugin, an `@icon` the app takes, a
// `data:` image of at most 16 KB (`pumi_api::icon::MAX_ICON`).
import { describe, expect, test } from "bun:test";

import { agentIcon } from "../src/icons.ts";
import { catalog } from "../src/catalog.ts";

describe("an agent's mark", () => {
  test("is a data URI the app draws, for each agent whose sub-plugin has one", () => {
    const marked = catalog().filter((agent) => agent.icon).map((agent) => agent.id);
    expect(marked.sort()).toEqual(["claude", "copilot", "cursor", "gemini", "omp", "opencode", "pi", "qwen"]);
    for (const id of marked) {
      const icon = agentIcon(id)!;
      expect(icon).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(icon.length).toBeLessThanOrEqual(16 * 1024);
      expect(Buffer.from(icon.split(",")[1]!, "base64").toString("utf8")).toStartWith("<svg");
    }
  });

  test("is pi's for omp, which shares it, and none for an agent without one", () => {
    expect(agentIcon("omp")).toBe(agentIcon("pi")!);
    expect(agentIcon("codex")).toBeUndefined();
    expect(agentIcon("../package")).toBeUndefined();
  });
});
