// Codex's session file (`~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`) as the
// conversation's changes. Each line is `{timestamp, type, payload}`: `response_item`s are what the
// model saw and said (messages, reasoning, tool calls and their output), `event_msg`s what the
// session did (a turn starting, ending or aborted, the tokens used), `turn_context` the model.
// The `event_msg` copies of messages (`user_message`, `agent_message`) are left out: the
// `response_item`s say them. No `import … from "pumi"` here.
import { noticeChange, type Change, type Stamp } from "../conversation/change.ts";
import type { ToolContent, Transcript, Usage } from "../conversation/model.ts";
import { imageOf, num, obj, objs, resultContent, str, timeOf, toolPush, toolResult, type Parser, type Rec } from "./common.ts";

/** Text Codex puts in a user message for the model, not typed by the user. */
const CONTEXT = /^\s*(<(environment_context|user_instructions|recommended_plugins|permissions|skill|turn_aborted|user_shell_command|image|\/image)\b|# AGENTS\.md)/;

export class CodexParser implements Parser {
  #usage: Usage = {};

  record(record: Rec, t: Transcript, stamp: Stamp): Change[] {
    const payload = obj(record.payload);
    if (!payload) return [];
    const at = timeOf(record.timestamp, stamp);
    switch (record.type) {
      case "response_item":
        return item(payload, t, at, stamp);
      case "event_msg":
        return this.#event(payload, at, stamp);
      case "turn_context": {
        const model = str(payload.model);
        return model && t.session && t.session.model !== model ? [{ type: "session", session: { ...t.session, model } }] : [];
      }
      case "compacted":
        return [noticeChange("The conversation was compacted.", "info", stamp)];
      default:
        return [];
    }
  }

  #event(payload: Rec, at: number, stamp: Stamp): Change[] {
    switch (payload.type) {
      case "task_complete": {
        const durationMs = num(payload.duration_ms);
        return [{ type: "push", entry: { id: stamp.id(), kind: "turn", at, turn: { stop: "end_turn", ...(durationMs !== undefined ? { durationMs } : {}) } } }];
      }
      case "turn_aborted": {
        const durationMs = num(payload.duration_ms);
        return [{ type: "push", entry: { id: stamp.id(), kind: "turn", at, turn: { stop: "cancelled", ...(durationMs !== undefined ? { durationMs } : {}) } } }];
      }
      case "token_count": {
        const info = obj(payload.info);
        const last = obj(info?.last_token_usage);
        const tokens = num(last?.total_tokens);
        const contextSize = num(info?.model_context_window);
        if (tokens === undefined) return [];
        this.#usage = { tokens, ...(contextSize ? { contextSize, contextPct: Math.min(100, Math.round((tokens / contextSize) * 100)) } : {}) };
        return [{ type: "usage", usage: this.#usage }];
      }
      case "error":
        return [noticeChange(str(payload.message) ?? "Codex hit an error.", "error", stamp)];
      default:
        return [];
    }
  }
}

function item(payload: Rec, t: Transcript, at: number, stamp: Stamp): Change[] {
  switch (payload.type) {
    case "message":
      return message(payload, at, stamp);
    case "reasoning": {
      const text = objs(payload.summary)
        .map((part) => str(part.text) ?? "")
        .filter((part) => part !== "")
        .join("\n\n");
      return text ? [{ type: "push", entry: { id: stamp.id(), kind: "thought", at, text } }] : [];
    }
    case "function_call":
    case "custom_tool_call":
    case "local_shell_call":
    case "web_search_call":
    case "tool_search_call": {
      const id = str(payload.call_id) ?? str(payload.id);
      if (!id) return [];
      const name = str(payload.name) ?? (payload.type === "local_shell_call" ? "shell" : payload.type === "web_search_call" ? "web_search" : "tool_search");
      const input = callInput(payload);
      const push = toolPush(id, name, input, callContent(name, input), at, stamp);
      // A web search has no output record: its call says it is done.
      if (payload.type === "web_search_call" && push.entry.tool) push.entry.tool.status = "completed";
      return [push];
    }
    case "function_call_output":
    case "custom_tool_call_output":
    case "tool_search_output": {
      const id = str(payload.call_id);
      if (!id) return [];
      const { content, failed } = output(payload.output);
      return toolResult(t, id, failed, content);
    }
    default:
      return [];
  }
}

function message(payload: Rec, at: number, stamp: Stamp): Change[] {
  const role = payload.role;
  if (role !== "user" && role !== "assistant") return [];
  const texts: string[] = [];
  const changes: Change[] = [];
  for (const part of objs(payload.content)) {
    const text = typeof part.text === "string" ? part.text : undefined;
    if (text !== undefined && text.trim() !== "" && !(role === "user" && CONTEXT.test(text))) texts.push(text);
    const image = imageOf(part);
    if (image && role === "user") changes.push({ type: "push", entry: { id: stamp.id(), kind: "image", at, image, from: "user" } });
  }
  if (texts.length > 0) changes.unshift({ type: "push", entry: { id: stamp.id(), kind: role === "user" ? "user" : "agent", at, text: texts.join("\n\n") } });
  return changes;
}

/** A call's arguments: `function_call`'s are a JSON string; a custom tool's input is its text (a shell's code, a patch). */
function callInput(payload: Rec): Rec | undefined {
  if (typeof payload.arguments === "string") {
    try {
      return obj(JSON.parse(payload.arguments)) ?? { arguments: payload.arguments };
    } catch {
      return { arguments: payload.arguments };
    }
  }
  if (typeof payload.input === "string") return payload.name === "exec" || payload.name === "shell" ? { command: payload.input } : { input: payload.input };
  const action = obj(payload.action);
  if (action) {
    if (Array.isArray(action.command)) return { command: action.command };
    if (str(action.query)) return { query: action.query };
    return action;
  }
  return obj(payload.arguments) ?? obj(payload.input);
}

/** What a call shows before its output: a patch's text. */
function callContent(name: string, input: Rec | undefined): ToolContent[] {
  const patch = name === "apply_patch" ? str(input?.input) : undefined;
  return patch ? [{ type: "text", text: patch }] : [];
}

/** A call's output: text (a JSON `{output, metadata: {exit_code}}` unwrapped), or content blocks. */
function output(value: unknown): { content: ToolContent[]; failed: boolean } {
  if (typeof value === "string") {
    try {
      const parsed = obj(JSON.parse(value));
      if (parsed && typeof parsed.output === "string") {
        const exit = num(obj(parsed.metadata)?.exit_code);
        return { content: resultContent(parsed.output), failed: exit !== undefined && exit !== 0 };
      }
    } catch {
      // Plain text, as most outputs are.
    }
    return { content: resultContent(value), failed: false };
  }
  const record = obj(value);
  if (record) return { content: resultContent(record.content ?? record.output), failed: record.success === false };
  return { content: resultContent(value), failed: false };
}
