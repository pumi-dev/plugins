// Claude Code's session file, on synthetic records shaped like the real ones.
import { describe, expect, test } from "bun:test";

import { ClaudeParser } from "../src/parse/claude.ts";
import { rows, run } from "./harness.ts";

const base = { sessionId: "s-1", cwd: "/work/demo", isSidechain: false, timestamp: "2026-01-02T10:00:00.000Z" };

describe("ClaudeParser", () => {
  test("a turn: the prompt, thinking, a tool call and its result, the reply, the turn's end", () => {
    const t = run(new ClaudeParser(), [
      { type: "permission-mode", permissionMode: "default", sessionId: "s-1" },
      { ...base, type: "user", uuid: "u1", message: { role: "user", content: "list the files" } },
      { ...base, type: "assistant", uuid: "a1", message: { id: "m1", model: "claude-test-1", content: [{ type: "thinking", thinking: "I should run ls.", signature: "x" }], usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } } },
      { ...base, type: "assistant", uuid: "a2", message: { id: "m1", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls", description: "List files" } }] } },
      { ...base, type: "user", uuid: "u2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "a.txt\nb.txt", is_error: false }] }, toolUseResult: { stdout: "a.txt\nb.txt", stderr: "" } },
      { ...base, type: "assistant", uuid: "a3", message: { id: "m2", content: [{ type: "text", text: "There are two files." }] } },
      { ...base, type: "system", subtype: "turn_duration", durationMs: 4200 },
      { type: "summary", summary: "Listing files", leafUuid: "a3" },
    ]);
    expect(rows(t)).toEqual(["user: list the files", "thought: I should run ls.", "tool: Bash completed", "agent: There are two files.", "turn: end_turn"]);
    const tool = t.entries[2]!.tool!;
    expect(tool.kind).toBe("shell");
    expect(tool.content).toEqual([{ type: "terminal", output: "a.txt\nb.txt" }]);
    expect(t.entries[4]!.turn!.durationMs).toBe(4200);
    expect(t.usage.tokens).toBe(105);
    expect(t.session).toMatchObject({ model: "claude-test-1", title: "Listing files" });
  });

  test("an edit shows its change, then the patch Claude resolved against the file", () => {
    const t = run(new ClaudeParser(), [
      { ...base, type: "assistant", uuid: "a1", message: { content: [{ type: "tool_use", id: "toolu_2", name: "Edit", input: { file_path: "/work/demo/a.ts", old_string: "x = 1", new_string: "x = 2" } }] } },
      {
        ...base,
        type: "user",
        uuid: "u1",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "The file was updated." }] },
        toolUseResult: { filePath: "/work/demo/a.ts", structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ["-x = 1", "+x = 2"] }] },
      },
    ]);
    const tool = t.entries[0]!.tool!;
    expect(tool.kind).toBe("edit");
    expect(tool.status).toBe("completed");
    expect(tool.content[0]).toEqual({ type: "diff", path: "/work/demo/a.ts", new: "", unified: "--- /work/demo/a.ts\n+++ /work/demo/a.ts\n@@ -3,1 +3,1 @@\n-x = 1\n+x = 2" });
  });

  test("slash commands, their output, injected text, an interruption and a subagent's records", () => {
    const t = run(new ClaudeParser(), [
      { ...base, type: "user", uuid: "u1", message: { role: "user", content: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>" } },
      { ...base, type: "user", uuid: "u2", message: { role: "user", content: "<local-command-stdout>Set model to \u001b[1mopus\u001b[22m</local-command-stdout>" } },
      { ...base, type: "user", uuid: "u3", isMeta: true, message: { role: "user", content: "Caveat: injected" } },
      { ...base, type: "user", uuid: "u4", isSidechain: true, message: { role: "user", content: "a subagent's prompt" } },
      { ...base, type: "user", uuid: "u5", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
      { ...base, type: "attachment", uuid: "q1", attachment: { type: "queued_command", commandMode: "prompt", prompt: "and then this" } },
      "{not json",
    ]);
    expect(rows(t)).toEqual(["user: /model opus", "notice: Set model to opus", "turn: cancelled", "user: and then this"]);
  });
});
