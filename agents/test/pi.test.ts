// pi's session file, on synthetic records shaped like the real ones: a tree of entries, read as the
// branch its last entry is on.
import { describe, expect, test } from "bun:test";

import { PiParser } from "../src/parse/pi.ts";
import { rows, run } from "./harness.ts";

const header = { type: "session", version: 3, id: "s-1", timestamp: "2026-01-02T10:00:00.000Z", cwd: "/work/demo" };
const msg = (id: string, parentId: string | null, message: object) => ({ type: "message", id, parentId, timestamp: "2026-01-02T10:00:01.000Z", message });
const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0.25 } };

describe("PiParser", () => {
  test("a turn: the prompt, a tool call and its result, the reply", () => {
    const t = run(new PiParser(), [
      header,
      { type: "model_change", id: "e0", parentId: null, provider: "test", modelId: "model-1" },
      msg("e1", "e0", { role: "user", content: [{ type: "text", text: "read a.txt" }], timestamp: 1 }),
      msg("e2", "e1", { role: "assistant", provider: "test", model: "model-1", stopReason: "toolUse", usage, content: [{ type: "thinking", thinking: "Read it." }, { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.txt" } }] }),
      msg("e3", "e2", { role: "toolResult", toolCallId: "call_1", toolName: "read", content: [{ type: "text", text: "hello" }], isError: false }),
      msg("e4", "e3", { role: "assistant", provider: "test", model: "model-1", stopReason: "stop", usage, content: [{ type: "text", text: "It says hello." }] }),
      { type: "custom", id: "e5", parentId: "e4", customType: "state", data: {} },
      { type: "session_info", id: "e6", parentId: "e5", name: "Reading a file" },
    ]);
    expect(rows(t)).toEqual(["user: read a.txt", "thought: Read it.", "tool: read completed", "agent: It says hello.", "turn: end_turn"]);
    expect(t.entries[2]!.tool!.content).toEqual([{ type: "text", text: "hello" }]);
    expect(t.session).toMatchObject({ model: "test/model-1", title: "Reading a file" });
    expect(t.usage).toEqual({ tokens: 15, cost: { amount: 0.5, currency: "USD" } });
  });

  test("the branch the last entry is on, not the one left", () => {
    const t = run(new PiParser(), [
      header,
      msg("e1", null, { role: "user", content: "first" }),
      msg("e2", "e1", { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "the old answer" }] }),
      msg("e3", "e1", { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "the new answer" }] }),
    ]);
    expect(rows(t)).toEqual(["user: first", "agent: the new answer", "turn: end_turn"]);
  });

  test("an entry on another branch than the last one read asks for the file again", () => {
    const parser = new PiParser();
    run(parser, [header, msg("e1", null, { role: "user", content: "a" }), msg("e2", "e1", { role: "user", content: "b" })]);
    expect(parser.continues({ type: "message", id: "e3", parentId: "e2" })).toBe(true);
    expect(parser.continues({ type: "message", id: "e3", parentId: "e1" })).toBe(false);
  });

  test("an edit's patch, a `!` command, an aborted turn", () => {
    const t = run(new PiParser(), [
      header,
      msg("e1", null, { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "c1", name: "edit", arguments: { path: "/w/a.ts", edits: [{ oldText: "1", newText: "2" }] } }] }),
      msg("e2", "e1", { role: "toolResult", toolCallId: "c1", toolName: "edit", content: [{ type: "text", text: "Edited." }], details: { patch: "--- /w/a.ts\n+++ /w/a.ts\n@@ -1 +1 @@\n-1\n+2" }, isError: false }),
      msg("e3", "e2", { role: "bashExecution", command: "git status", output: "clean", exitCode: 0, cancelled: false, truncated: false }),
      msg("e4", "e3", { role: "assistant", stopReason: "aborted", content: [] }),
    ]);
    expect(rows(t)).toEqual(["tool: edit completed", "tool: bash completed", "turn: cancelled"]);
    expect(t.entries[0]!.tool!.content[0]).toMatchObject({ type: "diff", path: "/w/a.ts", unified: "--- /w/a.ts\n+++ /w/a.ts\n@@ -1 +1 @@\n-1\n+2" });
    expect(t.entries[1]!.tool!.content).toEqual([{ type: "terminal", output: "clean", exitCode: 0 }]);
  });

  test("a user message keeps its entry's id, which a rewind names", () => {
    const t = run(new PiParser(), [header, msg("e1", null, { role: "user", content: "first" })]);
    expect(t.entries[0]).toMatchObject({ kind: "user", text: "first", source: "e1" });
  });

  test("a rewind's entry moves the session: to another parent, or to a new root before the first message", () => {
    const parser = new PiParser();
    run(parser, [header, msg("e1", null, { role: "user", content: "a" }), msg("e2", "e1", { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "b" }] })]);
    expect(parser.continues({ type: "custom", id: "r1", parentId: null, customType: "pumi-rewind", data: { to: "e1" } })).toBe(false);
    const t = run(new PiParser(), [header, msg("e1", null, { role: "user", content: "a" }), { type: "custom", id: "r1", parentId: null, customType: "pumi-rewind", data: { to: "e1" } }]);
    expect(rows(t)).toEqual([]);
  });
});
