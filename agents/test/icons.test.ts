// The agents' marks (`src/icons.ts`): each one an `@icon` the app takes, a `data:` image of at most
// 16 KB (`pumi_api::icon::MAX_ICON`).
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { agentIcon } from "../src/icons.ts";

describe("an agent's mark", () => {
  test("is a data URI the app draws, for each file in icons/", () => {
    const names = readdirSync(join(import.meta.dir, "..", "icons")).filter((file) => file.endsWith(".svg")).map((file) => file.slice(0, -4));
    expect(names.sort()).toEqual(["claude", "copilot", "cursor", "gemini", "opencode", "pi", "qwen"]);
    for (const name of names) {
      const icon = agentIcon(name)!;
      expect(icon).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(icon.length).toBeLessThanOrEqual(16 * 1024);
      expect(Buffer.from(icon.split(",")[1]!, "base64").toString("utf8")).toStartWith("<svg");
    }
  });

  test("is another's for an agent that shares it, and none for one without", () => {
    expect(agentIcon("omp")).toBe(agentIcon("pi")!);
    expect(agentIcon("codex")).toBeUndefined();
    expect(agentIcon("../package")).toBeUndefined();
  });
});
