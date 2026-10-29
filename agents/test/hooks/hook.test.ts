// What the hook function answers an agent's hook (`src/hooks/hook.ts`): the cases of pumi's
// `pumi skill hook` it took them from.
import { describe, expect, test } from "bun:test";

import { contextOutput, continuation, formatOf, hookEvent, modelOf, permissionAsk, permissionDecision, plainLine, reportBody, reportState, startOf, told } from "../../src/hooks/hook.ts";
import { findAgent } from "../../src/hooks/integrations.ts";

describe("a hook's event", () => {
  test("says what the agent is doing", () => {
    expect(reportState("start")).toBe("idle");
    expect(reportState("prompt")).toBe("working");
    expect(reportState("stop")).toBe("done");
    expect(reportState("compact")).toBeUndefined();
    expect(reportState("permission")).toBeUndefined();
    expect(hookEvent("question")).toBe("question");
    expect(hookEvent("resume")).toBe("resume");
    expect(hookEvent("full")).toBeUndefined();
    expect(hookEvent("reset")).toBeUndefined();
  });

  test("is reported as the agent would, in OSC 7501's words", () => {
    expect(reportBody("claude", "blocked", "question")).toBe("state=blocked:kind=question:app=claude");
    expect(reportBody("claude", "working")).toBe("state=working:app=claude");
  });

  test("tells the agent the workspace in its format", () => {
    const claude = findAgent("claude");
    expect(JSON.parse(contextOutput("hooks", claude, "start", "map"))).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "map" } });
    expect(JSON.parse(contextOutput("hooks", claude, "prompt", "map"))).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "map" } });
    // Gemini's prompt hook is `BeforeAgent`; the event the hook names wins.
    expect(JSON.parse(contextOutput("hooks", findAgent("gemini"), "prompt", "map")).hookSpecificOutput.hookEventName).toBe("BeforeAgent");
    expect(JSON.parse(contextOutput("hooks", undefined, "prompt", "map", "Other")).hookSpecificOutput.hookEventName).toBe("Other");
    expect(contextOutput("cursor", findAgent("cursor"), "start", "map")).toBe(`{"additional_context":"map"}`);
    expect(contextOutput("text", findAgent("pi"), "start", "map")).toBe("map");
  });

  test("is answered in its agent's format", () => {
    expect(formatOf(findAgent("claude"))).toBe("hooks");
    expect(formatOf(findAgent("cursor"))).toBe("cursor");
    expect(formatOf(findAgent("pi"))).toBe("text");
    expect(formatOf(undefined)).toBe("text");
  });
});

describe("a hook's input", () => {
  test("is read by its well-known keys", () => {
    const claude = { session_id: "s", transcript_path: "/home/u/.claude/projects/p/s.jsonl", model: "claude-x", source: "resume", hook_event_name: "SessionStart" };
    expect(told(claude)).toEqual({ session: "s", transcript: "/home/u/.claude/projects/p/s.jsonl", model: "claude-x", hookEvent: "SessionStart" });
    expect(startOf(claude)).toEqual({ resumed: true, compacted: false, full: false });
    expect(startOf({ source: "compact" })).toEqual({ resumed: false, compacted: true, full: false });
    expect(startOf({ resumed: true, full: true })).toEqual({ resumed: true, compacted: false, full: true });
    const pi = { session_file: "/s.jsonl", model: { provider: "anthropic", id: "m" } };
    expect(told(pi)).toEqual({ transcript: "/s.jsonl", model: "anthropic/m" });
    expect(modelOf({ model: { display_name: "Opus" } })).toBe("Opus");
    expect(told({ conversation_id: "c", transcript_path: "rel.jsonl" })).toEqual({ session: "c" });
    expect(told("not an object")).toEqual({});
    expect(told({ session_id: "a\nb" })).toEqual({});
    expect(plainLine("a\nb")).toBe(false);
    expect(plainLine("/a b/c.jsonl")).toBe(true);
  });
});

describe("a queued prompt at a turn's end", () => {
  test("keeps the agent going, in its format", () => {
    expect(continuation("hooks", "go on")).toBe(`{"decision":"block","reason":"go on"}`);
    expect(continuation("cursor", "go on")).toBe(`{"followup_message":"go on"}`);
    expect(continuation("text", "go on")).toBe("go on");
  });
});

describe("a permission", () => {
  const input = {
    tool_name: "Bash",
    tool_input: { command: "make deploy\necho done", description: "Deploy" },
    permission_suggestions: [{ type: "addRules" }],
  };

  test("is asked with the tool, what it runs, and the options the agent offers", () => {
    const ask = permissionAsk("Claude Code", input)!;
    expect(ask.title).toBe("Claude Code wants to use Bash: make deploy");
    expect(ask.tool).toBe("Bash");
    expect(ask.detail).toBe("Deploy");
    expect((ask.options as { id: string }[]).map((each) => each.id)).toEqual(["allow", "always", "deny"]);
    expect(permissionAsk("x", {})).toBeUndefined();
    const plain = permissionAsk("x", { tool_name: "Read" })!;
    expect(plain.title).toBe("x wants to use Read");
    expect((plain.options as { id: string }[]).map((each) => each.id)).toEqual(["allow", "deny"]);
  });

  test("its answer is Claude's decision", () => {
    const decision = (answer: unknown) => JSON.parse(permissionDecision(answer, input)!).hookSpecificOutput;
    expect(decision({ option: "allow" })).toEqual({ hookEventName: "PermissionRequest", decision: { behavior: "allow" } });
    expect(decision({ option: "always" }).decision.updatedPermissions).toEqual(input.permission_suggestions);
    expect(decision({ option: "deny", text: "not now" }).decision).toEqual({ behavior: "deny", message: "not now" });
    expect(decision({ option: "deny" }).decision.message).toBe("Denied in pumi");
    expect(permissionDecision(null, input)).toBeUndefined();
    expect(permissionDecision({ option: "later" }, input)).toBeUndefined();
  });
});
