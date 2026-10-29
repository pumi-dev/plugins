// A synthetic ACP session, in the shapes agents send (claude-code-acp's `_meta.claudeCode.toolName`,
// codex-acp's terminals, the older `modes`/`models` and the newer `configOptions`). Written by
// hand: no real transcript is copied here.
import type { AcpRequestPermission, AcpSessionSetup, AcpSessionUpdate } from "../../src/conversation/acp.ts";

export const SETUP: AcpSessionSetup = {
  sessionId: "sess-1",
  modes: {
    currentModeId: "default",
    availableModes: [
      { id: "default", name: "Always ask", description: "Ask before each edit" },
      { id: "acceptEdits", name: "Accept edits" },
      { id: "plan", name: "Plan" },
    ],
  },
  models: {
    currentModelId: "model-large",
    availableModels: [
      { modelId: "model-large", name: "Large" },
      { modelId: "model-small", name: "Small", description: "Faster" },
    ],
  },
};

export const SETUP_WITH_CONFIG: AcpSessionSetup = {
  sessionId: "sess-2",
  modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "m-2",
      options: [
        { group: "fast", name: "Fast", options: [{ value: "m-1", name: "Model One" }] },
        { group: "smart", name: "Smart", options: [{ value: "m-2", name: "Model Two", description: "Slower, better" }] },
      ],
    },
    { id: "effort", name: "Thinking", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] },
    { id: "web", name: "Web search", category: "_custom", type: "boolean", currentValue: false },
  ],
};

/** One turn: think, say, read a file, edit it (asking first), run the tests, plan, use. */
export const TURN: AcpSessionUpdate[] = [
  { sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review the changes" }, { name: "compact", description: "Compact the context", input: { hint: "what to keep" } }] },
  { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "The user wants the greeting " } },
  { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "changed." } },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "I'll look at " } },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "`src/greet.ts` first." } },
  { sessionUpdate: "plan", entries: [{ content: "Read greet.ts", priority: "high", status: "in_progress" }, { content: "Change the greeting", priority: "medium", status: "pending" }, { content: "Run the tests", priority: "low", status: "pending" }] },
  { sessionUpdate: "tool_call", toolCallId: "toolu_read", title: "Read src/greet.ts", kind: "read", status: "pending", locations: [{ path: "/work/src/greet.ts" }], rawInput: { file_path: "/work/src/greet.ts" }, _meta: { claudeCode: { toolName: "Read" } } },
  { sessionUpdate: "tool_call_update", toolCallId: "toolu_read", status: "completed", content: [{ type: "content", content: { type: "text", text: "```ts\nexport const greet = () => \"hi\";\n```" } }] },
  { sessionUpdate: "tool_call", toolCallId: "toolu_edit", title: "Edit src/greet.ts", kind: "edit", status: "pending", locations: [{ path: "/work/src/greet.ts", line: 1 }], rawInput: { file_path: "/work/src/greet.ts", old_string: "hi", new_string: "hello" }, content: [{ type: "diff", path: "/work/src/greet.ts", oldText: 'export const greet = () => "hi";\n', newText: 'export const greet = () => "hello";\n' }] },
  // (the permission request for toolu_edit comes here; see EDIT_PERMISSION)
  { sessionUpdate: "tool_call_update", toolCallId: "toolu_edit", status: "completed" },
  { sessionUpdate: "plan", entries: [{ content: "Read greet.ts", priority: "high", status: "completed" }, { content: "Change the greeting", priority: "medium", status: "completed" }, { content: "Run the tests", priority: "low", status: "in_progress" }] },
  { sessionUpdate: "tool_call", toolCallId: "call_tests", title: "bun test", kind: "execute", status: "in_progress", rawInput: { command: ["bun", "test"] }, content: [{ type: "terminal", terminalId: "term-1" }] },
  { sessionUpdate: "tool_call_update", toolCallId: "call_tests", status: "completed", rawOutput: { exit_code: 0 } },
  { sessionUpdate: "tool_call", toolCallId: "toolu_new", title: "Write src/farewell.ts", kind: "edit", status: "completed", content: [{ type: "diff", path: "/work/src/farewell.ts", newText: 'export const bye = () => "bye";\n' }] },
  { sessionUpdate: "tool_call", toolCallId: "toolu_mcp", title: "mcp__docs__search", kind: "other", status: "completed", rawOutput: "3 results" },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done: the greeting is now **hello**." } },
  { sessionUpdate: "usage_update", used: 50_000, size: 200_000, cost: { amount: 0.12, currency: "USD" } },
  { sessionUpdate: "session_info_update", title: "Change the greeting" },
  { sessionUpdate: "current_mode_update", currentModeId: "acceptEdits" },
];

export const EDIT_PERMISSION: AcpRequestPermission = {
  sessionId: "sess-1",
  toolCall: { toolCallId: "toolu_edit", title: "Edit src/greet.ts", rawInput: { file_path: "/work/src/greet.ts" } },
  options: [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "allow_always", name: "Always allow edits", kind: "allow_always" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
};

/** A request for a tool call the agent had not announced. */
export const SHELL_PERMISSION: AcpRequestPermission = {
  sessionId: "sess-1",
  toolCall: { toolCallId: "call_rm", title: "rm -rf build", kind: "execute", rawInput: { command: "rm -rf build" } },
  options: [
    { optionId: "yes", name: "Yes", kind: "allow_once" },
    { optionId: "no", name: "No", kind: "reject_once" },
    { optionId: "custom", name: "Tell it something else", kind: "_custom_kind" },
  ],
};

/** A `session/load` replay: the user's words come back as chunks too, with an image. */
export const REPLAY: AcpSessionUpdate[] = [
  { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Rename the " } },
  { sessionUpdate: "user_message_chunk", content: { type: "text", text: "function, see " } },
  { sessionUpdate: "user_message_chunk", content: { type: "resource_link", uri: "file:///work/src/greet.ts", name: "greet.ts" } },
  { sessionUpdate: "user_message_chunk", content: { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" } },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Renamed." } },
];
