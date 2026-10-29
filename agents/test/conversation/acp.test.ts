// The ACP mapping: a whole synthetic turn, the requests, the setup answers, and the calls a
// command becomes.
import { expect, test } from "bun:test";

import {
  configOption,
  fromPermissionRequest,
  fromPromptResponse,
  fromSessionSetup,
  fromSessionUpdate,
  MODE_OPTION,
  MODEL_OPTION,
  permissionResponse,
  promptBlocks,
  setOptionChange,
  setOptionRequest,
  terminalOutput,
  type AcpSessionUpdate,
} from "../../src/conversation/acp.ts";
import { Producer, follow, type Update } from "../../src/conversation/change.ts";
import { emptyTranscript, findTool, newCommandId, optionOf, type Transcript } from "../../src/conversation/model.ts";
import { EDIT_PERMISSION, REPLAY, SETUP, SETUP_WITH_CONFIG, SHELL_PERMISSION, TURN } from "./fixtures.ts";

/** A producer on a test clock that never fires (tests flush), and what a view following it has. */
function harness() {
  let now = 1_000;
  const updates: Update[] = [];
  const producer = new Producer({
    transcript: emptyTranscript("epoch-acp"),
    publish: (update) => updates.push(update),
    now: () => now,
    timers: { set: () => 0, clear: () => {} },
  });
  const feed = (update: AcpSessionUpdate) => producer.push(...fromSessionUpdate(producer.transcript, update, producer));
  const view = (): Transcript | undefined => updates.reduce<Transcript | undefined>((t, u) => follow(t ?? emptyTranscript("epoch-acp"), u), undefined);
  return { producer, feed, view, tick: (ms: number) => (now += ms) };
}

test("a whole turn becomes the timeline a view sees", () => {
  const { producer, feed, view } = harness();
  producer.push(...fromSessionSetup(producer.transcript, SETUP, { cwd: "/work", agent: "Claude" }));
  for (const update of TURN.slice(0, 9)) feed(update);
  producer.push(...fromPermissionRequest(producer.transcript, "7", EDIT_PERMISSION, producer));
  expect(producer.transcript.status).toBe("blocked");
  producer.push({ type: "permissionResolved", id: "7" });
  for (const update of TURN.slice(9)) feed(update);
  producer.flush();

  const t = producer.transcript;
  expect(t.entries.map((entry) => entry.kind)).toEqual(["thought", "agent", "plan", "tool", "tool", "tool", "tool", "tool", "agent"]);
  expect(t.entries[0]!.text).toBe("The user wants the greeting changed.");
  expect(t.entries[1]!.text).toBe("I'll look at `src/greet.ts` first.");
  // The second plan replaced the turn's plan entry, and is the plan now.
  expect(t.entries[2]!.plan!.map((item) => item.status)).toEqual(["completed", "completed", "in_progress"]);
  expect(t.plan).toEqual(t.entries[2]!.plan!);

  const read = findTool(t, "toolu_read")!.tool!;
  expect(read).toMatchObject({ kind: "read", status: "completed", title: "Read src/greet.ts", locations: [{ path: "/work/src/greet.ts" }] });
  expect(read.content[0]).toEqual({ type: "text", text: '```ts\nexport const greet = () => "hi";\n```' });

  const edit = findTool(t, "toolu_edit")!.tool!;
  expect(edit.kind).toBe("edit");
  expect(edit.status).toBe("completed");
  expect(edit.content[0]).toEqual({ type: "diff", path: "/work/src/greet.ts", old: 'export const greet = () => "hi";\n', new: 'export const greet = () => "hello";\n' });

  const shell = findTool(t, "call_tests")!.tool!;
  expect(shell.kind).toBe("shell");
  expect(shell.content).toEqual([{ type: "terminal", id: "term-1", output: "", exitCode: 0 }]);
  expect(findTool(t, "toolu_new")!.tool!.kind).toBe("write");
  const mcp = findTool(t, "toolu_mcp")!.tool!;
  expect(mcp.kind).toBe("mcp");
  expect(mcp.content).toEqual([{ type: "text", text: "3 results" }]);

  expect(t.commands).toEqual([{ name: "review", description: "Review the changes" }, { name: "compact", description: "Compact the context", hint: "what to keep" }]);
  expect(t.usage).toEqual({ tokens: 50_000, contextSize: 200_000, contextPct: 25, cost: { amount: 0.12, currency: "USD" } });
  expect(t.session).toMatchObject({ id: "sess-1", cwd: "/work", agent: "Claude", model: "Large", title: "Change the greeting" });
  expect(optionOf(t, "mode")!.current).toBe("acceptEdits");
  expect(t.permissions).toEqual([]);
  expect(t.status).toBe("working");

  // The view, following batch by batch, has the same.
  expect(view()).toEqual(t);
});

test("streamed text appends to the newest entry of its kind, and starts anew after anything else", () => {
  const { producer, feed } = harness();
  feed({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a" } });
  feed({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "b" } });
  feed({ sessionUpdate: "tool_call", toolCallId: "x", title: "ls", kind: "execute" });
  feed({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "c" } });
  feed({ sessionUpdate: "agent_message_chunk", content: { type: "audio", data: "", mimeType: "audio/wav" } });
  expect(producer.transcript.entries.map((entry) => [entry.kind, entry.text])).toEqual([
    ["agent", "ab"],
    ["tool", undefined],
    ["agent", "c"],
  ]);
});

test("a replay brings the user's words back, with their links and images", () => {
  const { producer, feed } = harness();
  for (const update of REPLAY) feed(update);
  const [user, image, agent] = producer.transcript.entries;
  expect(user).toMatchObject({ kind: "user", text: "Rename the function, see [greet.ts](file:///work/src/greet.ts)" });
  expect(image).toMatchObject({ kind: "image", from: "user", image: { mimeType: "image/png", data: "iVBORw0KGgo=" } });
  expect(agent).toMatchObject({ kind: "agent", text: "Renamed." });
});

test("a request for a call not yet seen announces the call too", () => {
  const { producer } = harness();
  producer.push(...fromPermissionRequest(producer.transcript, "9", SHELL_PERMISSION, producer));
  const t = producer.transcript;
  expect(findTool(t, "call_rm")!.tool).toMatchObject({ kind: "shell", status: "pending", title: "rm -rf build" });
  expect(t.permissions).toEqual([
    {
      id: "9",
      toolId: "call_rm",
      title: "rm -rf build",
      detail: "rm -rf build",
      options: [
        { id: "yes", label: "Yes", kind: "allow_once" },
        { id: "no", label: "No", kind: "reject_once" },
        { id: "custom", label: "Tell it something else", kind: "other" },
      ],
    },
  ]);
  expect(t.status).toBe("blocked");
});

test("an answer goes back as ACP's outcome", () => {
  expect(permissionResponse("allow")).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  expect(permissionResponse()).toEqual({ outcome: { outcome: "cancelled" } });
});

test("a terminal's output lands in every call showing it, and an update keeps it", () => {
  const { producer, feed } = harness();
  feed(TURN[11]!);
  producer.push(...terminalOutput(producer.transcript, "term-1", "3 pass\n", 0));
  feed({ sessionUpdate: "tool_call_update", toolCallId: "call_tests", content: [{ type: "terminal", terminalId: "term-1" }] });
  expect(findTool(producer.transcript, "call_tests")!.tool!.content).toEqual([{ type: "terminal", id: "term-1", output: "3 pass\n", exitCode: 0 }]);
  expect(terminalOutput(producer.transcript, "other", "x")).toEqual([]);
});

test("a shell's raw output, when it says no content, is its terminal", () => {
  const { producer, feed } = harness();
  feed({ sessionUpdate: "tool_call", toolCallId: "s", title: "echo hi", kind: "execute", status: "in_progress" });
  feed({ sessionUpdate: "tool_call_update", toolCallId: "s", status: "failed", rawOutput: { stdout: "hi", stderr: "oops", exitCode: 2 } });
  expect(findTool(producer.transcript, "s")!.tool).toMatchObject({ status: "failed", content: [{ type: "terminal", output: "hi\noops", exitCode: 2 }] });
});

test("an update that says nothing new changes nothing", () => {
  const { producer, feed } = harness();
  feed({ sessionUpdate: "tool_call", toolCallId: "q", title: "Q", kind: "search" });
  expect(fromSessionUpdate(producer.transcript, { sessionUpdate: "tool_call_update", toolCallId: "q" }, producer)).toEqual([]);
});

test("sub-agents are told apart by name or input", () => {
  const { producer, feed } = harness();
  feed({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Explore", kind: "think", rawInput: { subagent_type: "explore", description: "Find it" } });
  feed({ sessionUpdate: "tool_call", toolCallId: "t2", title: "Task", kind: "other", _meta: { claudeCode: { toolName: "Task" } } });
  expect(findTool(producer.transcript, "t1")!.tool!.kind).toBe("subagent");
  expect(findTool(producer.transcript, "t2")!.tool!.kind).toBe("subagent");
});

test("the older modes and models become options, and configOptions win over them", () => {
  const t = emptyTranscript("e");
  const [, older] = fromSessionSetup(t, SETUP);
  expect(older).toEqual({
    type: "options",
    options: [
      { id: MODE_OPTION, category: "mode", name: "Mode", current: "default", choices: [{ id: "default", name: "Always ask", description: "Ask before each edit" }, { id: "acceptEdits", name: "Accept edits" }, { id: "plan", name: "Plan" }] },
      { id: MODEL_OPTION, category: "model", name: "Model", current: "model-large", choices: [{ id: "model-large", name: "Large" }, { id: "model-small", name: "Small", description: "Faster" }] },
    ],
  });
  const [session, newer] = fromSessionSetup(t, SETUP_WITH_CONFIG, { agent: "Codex" });
  expect(session).toEqual({ type: "session", session: { id: "sess-2", agent: "Codex", model: "Model Two" } });
  const options = (newer as { options: unknown[] }).options;
  expect(options).toEqual([
    { id: "model", category: "model", name: "Model", current: "m-2", choices: [{ id: "m-1", name: "Model One", group: "Fast" }, { id: "m-2", name: "Model Two", description: "Slower, better", group: "Smart" }] },
    { id: "effort", category: "thought_level", name: "Thinking", current: "medium", choices: [{ id: "low", name: "Low" }, { id: "medium", name: "Medium" }, { id: "high", name: "High" }] },
    { id: "web", category: "other", name: "Web search", current: false },
    { id: MODE_OPTION, category: "mode", name: "Mode", current: "ask", choices: [{ id: "ask", name: "Ask" }] },
  ]);
});

test("config_option_update replaces the options, keeping an older mode it leaves out", () => {
  const { producer, feed } = harness();
  producer.push(...fromSessionSetup(producer.transcript, SETUP));
  feed({ sessionUpdate: "config_option_update", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "a", options: [{ value: "a", name: "A" }] }] });
  expect(producer.transcript.options.map((option) => option.id)).toEqual(["model", MODE_OPTION]);
});

test("a setOption command becomes the call that sets it", () => {
  const { producer } = harness();
  producer.push(...fromSessionSetup(producer.transcript, SETUP));
  const t = producer.transcript;
  const id = newCommandId();
  expect(setOptionRequest(t, { type: "setOption", id, category: "mode", value: "plan" }, "sess-1")).toEqual({ method: "session/set_mode", params: { sessionId: "sess-1", modeId: "plan" } });
  expect(setOptionRequest(t, { type: "setOption", id, category: "model", value: "model-small" }, "sess-1")).toEqual({ method: "session/set_model", params: { sessionId: "sess-1", modelId: "model-small" } });
  expect(setOptionRequest(t, { type: "setOption", id, category: "model", value: "nope" }, "sess-1")).toBeUndefined();
  expect(setOptionRequest(t, { type: "setOption", id, category: "thought_level", value: "high" }, "sess-1")).toBeUndefined();

  const config = { ...t, options: [configOption(SETUP_WITH_CONFIG.configOptions![2]!)] };
  expect(setOptionRequest(config, { type: "setOption", id, category: "other", option: "web", value: true }, "s")).toEqual({ method: "session/set_config_option", params: { sessionId: "s", configId: "web", value: true } });
  expect(setOptionRequest(config, { type: "setOption", id, category: "other", option: "web", value: "yes" }, "s")).toBeUndefined();

  const set = setOptionChange(t, MODE_OPTION, "plan")!;
  producer.push(set);
  expect(optionOf(producer.transcript, "mode")!.current).toBe("plan");
  expect(setOptionChange(t, "missing", "x")).toBeUndefined();
});

test("a prompt's answer ends the turn: its summary, open calls canceled when stopped", () => {
  const { producer, feed, tick } = harness();
  feed({ sessionUpdate: "tool_call", toolCallId: "long", title: "sleep 100", kind: "execute", status: "in_progress" });
  producer.push(...fromPermissionRequest(producer.transcript, "p", EDIT_PERMISSION, producer));
  tick(4_200);
  producer.push(...fromPromptResponse(producer.transcript, { stopReason: "cancelled", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedReadTokens: 3 } }, 1_000, producer));
  const t = producer.transcript;
  expect(findTool(t, "long")!.tool!.status).toBe("canceled");
  expect(t.permissions).toEqual([]);
  expect(t.entries[t.entries.length - 1]).toMatchObject({ kind: "turn", turn: { stop: "cancelled", durationMs: 4_200, tokens: { input: 10, output: 5, total: 15, cached: 3 } } });
  expect(t.status).toBe("done");

  const ended = fromPromptResponse(t, { stopReason: "end_turn" }, 5_000, producer);
  expect(ended.some((change) => change.type === "tool")).toBe(false);
  expect(fromPromptResponse(t, { stopReason: "something_new" }, 5_000, producer).find((change) => change.type === "push")).toMatchObject({ entry: { turn: { stop: "other" } } });
});

test("a prompt goes out as ACP content blocks", () => {
  expect(promptBlocks("hi", [{ mimeType: "image/png", data: "AAA" }, { mimeType: "image/jpeg", uri: "/tmp/shot.jpg" }])).toEqual([
    { type: "text", text: "hi" },
    { type: "image", data: "AAA", mimeType: "image/png" },
    { type: "resource_link", uri: "/tmp/shot.jpg", name: "shot.jpg", mimeType: "image/jpeg" },
  ]);
  expect(promptBlocks("")).toEqual([]);
});

test("a mode update with no mode option, and an info update with no title, change nothing", () => {
  const t = emptyTranscript("e");
  const stamp = { id: () => "x", now: () => 0 };
  expect(fromSessionUpdate(t, { sessionUpdate: "current_mode_update", currentModeId: "plan" }, stamp)).toEqual([]);
  expect(fromSessionUpdate(t, { sessionUpdate: "session_info_update", updatedAt: "2025-01-01T00:00:00Z" }, stamp)).toEqual([]);
});
