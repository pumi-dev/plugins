// The restore recipes, as core/agents/src/restore.rs has them: what pumi ships, what the settings
// add to, replace in and take out of them, and how a session becomes one word of a command line.
import { expect, test } from "bun:test";

import { command, DEFAULTS, line, quote, recipes } from "../src/restore.ts";

test("every recipe pumi ships has a place for the session", () => {
  expect(Object.keys(DEFAULTS)).toContain("claude");
  expect(Object.keys(DEFAULTS)).toContain("pi");
  for (const recipe of Object.values(DEFAULTS)) expect(command(recipe, "abc-123")).not.toBeNull();
});

test("the settings add a recipe, replace one and remove one", () => {
  const said = recipes({
    claude: ["claude", "--resume", "{session}", "--model", "opus"],
    codex: [],
    aider: ["aider", "--restore", "{session}"],
  });
  expect(said.get("claude")!.at(-1)).toBe("opus");
  expect(said.has("codex")).toBe(false);
  expect(command(said.get("aider")!, "x")).toBe("aider --restore x");
  expect(line("codex", "x", { codex: [] })).toBeNull();
  expect(line("codex", "x", null)).toBe("codex resume x");
});

test("a session is one quoted word, or no line at all", () => {
  const claude = DEFAULTS.claude!;
  expect(command(claude, "abc-123")).toBe("claude --resume abc-123");
  expect(command(claude, "a b; rm -rf ~")).toBe("claude --resume 'a b; rm -rf ~'");
  expect(command(claude, "--dangerously-skip-permissions")).toBeNull();
  expect(command(claude, " ")).toBeNull();
  expect(command(claude, "a\nb")).toBeNull();
  expect(command(["claude"], "abc")).toBeNull();
});

test("a word that is plain stays bare, and one that is not is quoted for a shell", () => {
  expect(quote("--model")).toBe("--model");
  expect(quote("a:b,c+d@e%f=g")).toBe("a:b,c+d@e%f=g");
  expect(quote("it's")).toBe("'it'\\''s'");
  expect(quote("")).toBe("''");
});
