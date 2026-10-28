// pi's live file (`<session file>.live`) shown as it comes, then settled by the file's own records:
// the streamed text grows in place, a running command's output shows in its card, and nothing shows
// twice once the session file has the message.
import { describe, expect, test } from "bun:test";

import { Producer } from "../src/conversation/change.ts";
import { emptyTranscript } from "../src/conversation/model.ts";
import { records } from "../src/parse/common.ts";
import { PiParser } from "../src/parse/pi.ts";
import { assistantTimestamp, Live, parseLive, type LiveSnapshot } from "../src/live.ts";
import { rows } from "./harness.ts";

const header = { type: "session", version: 3, id: "s-1", timestamp: "2026-01-02T10:00:00.000Z", cwd: "/work/demo" };
const msg = (id: string, parentId: string | null, message: object) => ({ type: "message", id, parentId, timestamp: "2026-01-02T10:00:01.000Z", message });

/** A producer fed as the bridge feeds it: records from the session file, reads of the live file. */
function feed() {
  const producer = new Producer({ transcript: emptyTranscript("epoch-0000", { id: "s-1", agent: "pi" }), publish: () => {} });
  const parser = new PiParser();
  const live = new Live();
  return {
    producer,
    record(record: object) {
      const [rec] = records([JSON.stringify(record)]);
      let changes = parser.record(rec!, producer.transcript, producer);
      if (assistantTimestamp(rec!) !== undefined) changes = live.settle(assistantTimestamp(rec!), changes, producer.transcript);
      producer.push(...changes);
    },
    live(snapshot: LiveSnapshot) {
      producer.push(...live.show(snapshot, producer.transcript, producer));
    },
  };
}

describe("Live", () => {
  test("the live file is read only in its version", () => {
    expect(parseLive(JSON.stringify({ v: 1, message: { timestamp: 5, content: [{ type: "thinking", text: "hm" }, { type: "text", text: "hi" }] }, tools: { c1: { name: "bash", output: "out" } } }))).toEqual({
      message: { timestamp: 5, content: [{ type: "thinking", text: "hm" }, { type: "text", text: "hi" }] },
      tools: { c1: "out" },
    });
    expect(parseLive(JSON.stringify({ v: 2 }))).toBeUndefined();
    expect(parseLive("{cut")).toBeUndefined();
  });

  test("a streamed reply grows in place, then the file's record takes its place", () => {
    const f = feed();
    f.record(header);
    f.record(msg("e1", null, { role: "user", content: "hello", timestamp: 1 }));
    f.live({ message: { timestamp: 2, content: [{ type: "thinking", text: "Say" }] }, tools: {} });
    f.live({ message: { timestamp: 2, content: [{ type: "thinking", text: "Say hi." }, { type: "text", text: "Hi" }] }, tools: {} });
    f.live({ message: { timestamp: 2, content: [{ type: "thinking", text: "Say hi." }, { type: "text", text: "Hi there" }] }, tools: {} });
    expect(rows(f.producer.transcript)).toEqual(["user: hello", "thought: Say hi.", "agent: Hi there"]);
    f.record(msg("e2", "e1", { role: "assistant", stopReason: "stop", timestamp: 2, content: [{ type: "thinking", thinking: "Say hi." }, { type: "text", text: "Hi there!" }] }));
    expect(rows(f.producer.transcript)).toEqual(["user: hello", "thought: Say hi.", "agent: Hi there!", "turn: end_turn"]);
    // A read of the live file that comes late shows nothing again.
    f.live({ message: { timestamp: 2, content: [{ type: "text", text: "Hi there" }] }, tools: {} });
    expect(rows(f.producer.transcript)).toHaveLength(4);
  });

  test("a running command's output shows in its card until its result", () => {
    const f = feed();
    f.record(header);
    f.record(msg("e1", null, { role: "assistant", stopReason: "toolUse", timestamp: 2, content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "make" } }] }));
    f.live({ message: null, tools: { c1: "building a\n" } });
    f.live({ message: null, tools: { c1: "building a\nbuilding b\n" } });
    const tool = () => f.producer.transcript.entries.at(-1)!.tool!;
    expect(tool().status).toBe("running");
    expect(tool().content).toEqual([{ type: "terminal", output: "building a\nbuilding b\n" }]);
    f.record(msg("e2", "e1", { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "built" }], isError: false }));
    expect(tool()).toMatchObject({ status: "completed", content: [{ type: "terminal", output: "built" }] });
    // Once it ended, a late read leaves the result alone.
    f.live({ message: null, tools: { c1: "building a\n" } });
    expect(tool().content).toEqual([{ type: "terminal", output: "built" }]);
  });
});
