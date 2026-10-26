// Codex's rollout file, on synthetic records shaped like the real ones.
import { describe, expect, test } from "bun:test";

import { CodexParser } from "../src/parse/codex.ts";
import { rows, run } from "./harness.ts";

const at = "2026-01-02T10:00:00.000Z";
const item = (payload: object) => ({ timestamp: at, type: "response_item", payload });
const event = (payload: object) => ({ timestamp: at, type: "event_msg", payload });

describe("CodexParser", () => {
  test("a turn: context left out, the prompt, reasoning, a shell call and its output, the reply, the end", () => {
    const t = run(new CodexParser(), [
      { timestamp: at, type: "session_meta", payload: { id: "s-1", cwd: "/work/demo", cli_version: "0.0.0" } },
      { timestamp: at, type: "turn_context", payload: { model: "gpt-test", cwd: "/work/demo" } },
      event({ type: "task_started", turn_id: "t1", model_context_window: 200000 }),
      item({ type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions instructions>…" }] }),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /work/demo" }, { type: "input_text", text: "<environment_context>\n  <cwd>/work/demo</cwd>\n</environment_context>" }] }),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "what is in here?" }] }),
      event({ type: "user_message", message: "what is in here?" }),
      item({ type: "reasoning", summary: [{ type: "summary_text", text: "Look at the files." }], encrypted_content: "x" }),
      item({ type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "ls" }), call_id: "call_1" }),
      item({ type: "function_call_output", call_id: "call_1", output: "a.txt\n" }),
      item({ type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n*** Add File: b.txt\n+hi\n*** End Patch", call_id: "call_2", status: "completed" }),
      item({ type: "custom_tool_call_output", call_id: "call_2", output: JSON.stringify({ output: "Success.", metadata: { exit_code: 0 } }) }),
      item({ type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "One file, and now two." }] }),
      event({ type: "agent_message", message: "One file, and now two." }),
      event({ type: "token_count", info: { last_token_usage: { total_tokens: 50000 }, model_context_window: 200000 } }),
      event({ type: "task_complete", turn_id: "t1", duration_ms: 9000 }),
    ]);
    expect(rows(t)).toEqual(["user: what is in here?", "thought: Look at the files.", "tool: exec_command completed", "tool: apply_patch completed", "agent: One file, and now two.", "turn: end_turn"]);
    expect(t.entries[2]!.tool!.content).toEqual([{ type: "terminal", output: "a.txt\n" }]);
    expect(t.entries[3]!.tool!.kind).toBe("edit");
    expect(t.usage).toEqual({ tokens: 50000, contextSize: 200000, contextPct: 25 });
    expect(t.session?.model).toBe("gpt-test");
  });

  test("a failed command and an aborted turn", () => {
    const t = run(new CodexParser(), [
      item({ type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["false"] }), call_id: "c" }),
      item({ type: "function_call_output", call_id: "c", output: JSON.stringify({ output: "", metadata: { exit_code: 1 } }) }),
      event({ type: "turn_aborted", reason: "interrupted" }),
    ]);
    expect(rows(t)).toEqual(["tool: shell failed", "turn: cancelled"]);
  });
});
