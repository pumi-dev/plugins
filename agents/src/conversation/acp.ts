// ACP (Agent Client Protocol, https://agentclientprotocol.com) as Changes: what an ACP client hears
// from its agent (`session/update`, `session/request_permission`, the answers to `session/new`,
// `session/load` and `session/prompt`) becomes the conversation's changes, read against the
// producer's transcript as it is; and what a view asks (`Command`) becomes the ACP calls. The ACP
// types here are the part of the schema this reads, written out so nothing is installed for them.
// No `import … from "pumi"` here.
import type { Change, Stamp, ToolPatch } from "./change.ts";
import { endTurnChanges, textChange } from "./change.ts";
import {
  describeInput,
  findTool,
  optionOf,
  type Choice,
  type Command,
  type ConfigOption,
  type Entry,
  type Image,
  type Location,
  type OptionCategory,
  type PermissionKind,
  type PlanItem,
  type StopReason,
  type Tool,
  type ToolContent,
  type ToolKind,
  type ToolStatus,
  type Transcript,
  type Usage,
} from "./model.ts";

// ── ACP's shapes ────────────────────────────────────────────────────────────────────────────

type Meta = { _meta?: Record<string, unknown> | null };

export type AcpContentBlock =
  | ({ type: "text"; text: string } & Meta)
  | ({ type: "image"; data: string; mimeType: string; uri?: string | null } & Meta)
  | ({ type: "audio"; data: string; mimeType: string } & Meta)
  | ({ type: "resource_link"; uri: string; name: string; title?: string | null; description?: string | null; mimeType?: string | null } & Meta)
  | ({ type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string | null } } & Meta);

export type AcpToolCallContent =
  | ({ type: "content"; content: AcpContentBlock } & Meta)
  | ({ type: "diff"; path: string; oldText?: string | null; newText: string } & Meta)
  | ({ type: "terminal"; terminalId: string } & Meta);

export type AcpToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
export type AcpToolStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AcpToolCall extends Meta {
  toolCallId: string;
  title?: string | null;
  kind?: AcpToolKind | null;
  status?: AcpToolStatus | null;
  content?: AcpToolCallContent[] | null;
  locations?: { path: string; line?: number | null }[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpPlanEntry {
  content: string;
  priority?: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export interface AcpAvailableCommand {
  name: string;
  description?: string;
  input?: { hint: string } | null;
}

export interface AcpConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

export type AcpConfigOption = Meta & {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
} & (
    | { type: "select"; currentValue: string; options: AcpConfigSelectOption[] | { group: string; name: string; options: AcpConfigSelectOption[] }[] }
    | { type: "boolean"; currentValue: boolean }
  );

export type AcpSessionUpdate =
  | ({ sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk"; content: AcpContentBlock; messageId?: string | null } & Meta)
  | ({ sessionUpdate: "tool_call"; title: string } & AcpToolCall)
  | ({ sessionUpdate: "tool_call_update" } & AcpToolCall)
  | ({ sessionUpdate: "plan"; entries: AcpPlanEntry[] } & Meta)
  | ({ sessionUpdate: "available_commands_update"; availableCommands: AcpAvailableCommand[] } & Meta)
  | ({ sessionUpdate: "current_mode_update"; currentModeId: string } & Meta)
  | ({ sessionUpdate: "config_option_update"; configOptions: AcpConfigOption[] } & Meta)
  | ({ sessionUpdate: "session_info_update"; title?: string | null; updatedAt?: string | null } & Meta)
  | ({ sessionUpdate: "usage_update"; used: number; size: number; cost?: { amount: number; currency: string } | null } & Meta);

/** `session/update`'s params. */
export interface AcpSessionNotification {
  sessionId: string;
  update: AcpSessionUpdate;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

/** `session/request_permission`'s params. */
export interface AcpRequestPermission {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
}

/** `session/request_permission`'s answer. */
export interface AcpPermissionResponse {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
}

export interface AcpSessionModes {
  currentModeId: string;
  availableModes: { id: string; name: string; description?: string | null }[];
}

export interface AcpSessionModels {
  currentModelId: string;
  availableModels: { modelId: string; name: string; description?: string | null }[];
}

/** What `session/new`, `session/load` and `session/resume` answer. */
export interface AcpSessionSetup {
  sessionId?: string;
  modes?: AcpSessionModes | null;
  models?: AcpSessionModels | null;
  configOptions?: AcpConfigOption[] | null;
}

/** `session/prompt`'s answer. */
export interface AcpPromptResponse {
  stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" | string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; thoughtTokens?: number | null; cachedReadTokens?: number | null; cachedWriteTokens?: number | null } | null;
}

/** An ACP request a client sends. */
export interface AcpRequest {
  method: string;
  params: Record<string, unknown>;
}

// ── The agent's side, as changes ────────────────────────────────────────────────────────────

/** The option ids that stand for ACP's older `modes` and `models` (not `configOptions`). */
export const MODE_OPTION = "acp.mode";
export const MODEL_OPTION = "acp.model";

/** One `session/update`, as changes to `t` (the producer's transcript as it is now). */
export function fromSessionUpdate(t: Transcript, update: AcpSessionUpdate, stamp: Stamp): Change[] {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const kind = update.sessionUpdate === "user_message_chunk" ? "user" : update.sessionUpdate === "agent_message_chunk" ? "agent" : "thought";
      const block = update.content;
      if (block.type === "image") {
        return [{ type: "push", entry: { id: stamp.id(), kind: "image", at: stamp.now(), image: imageOf(block), from: kind === "user" ? "user" : "agent" } }];
      }
      const text = blockText(block);
      return text === "" ? [] : [textChange(t, kind, text, stamp)];
    }
    case "tool_call":
    case "tool_call_update":
      return toolChanges(t, update, stamp);
    case "plan": {
      const plan = update.entries.map(planItem);
      return [{ type: "plan", plan }, planEntryChange(t, plan, stamp)];
    }
    case "available_commands_update":
      return [{ type: "commands", commands: update.availableCommands.map((each) => ({ name: each.name, description: each.description || undefined, hint: each.input?.hint || undefined })) }];
    case "current_mode_update": {
      const mode = optionOf(t, "mode");
      if (!mode) return [];
      return [{ type: "options", options: t.options.map((each) => (each === mode ? { ...each, current: update.currentModeId } : each)) }];
    }
    case "config_option_update":
      return [{ type: "options", options: mergeOptions(t.options, update.configOptions.map(configOption)) }];
    case "session_info_update": {
      if (update.title === undefined) return [];
      return [{ type: "session", session: { ...(t.session ?? { id: "" }), title: update.title ?? undefined } }];
    }
    case "usage_update":
      return [{ type: "usage", usage: usageOf(update.used, update.size, update.cost ?? undefined, t.usage) }];
  }
  return [];
}

/** `session/request_permission` (JSON-RPC id `id`): the request, and its tool call when it is new. */
export function fromPermissionRequest(t: Transcript, id: string, request: AcpRequestPermission, stamp: Stamp): Change[] {
  const changes: Change[] = [];
  const known = findTool(t, request.toolCall.toolCallId);
  if (!known) changes.push(...toolChanges(t, { ...request.toolCall, title: request.toolCall.title ?? "Tool" }, stamp));
  const tool = known?.tool;
  const input = request.toolCall.rawInput ?? tool?.input;
  const locations = request.toolCall.locations ?? tool?.locations;
  changes.push({
    type: "permissionAsked",
    permission: {
      id,
      toolId: request.toolCall.toolCallId,
      title: request.toolCall.title || tool?.title || "Allow this tool call?",
      detail: describeInput(input) ?? locations?.[0]?.path,
      options: request.options.map((option) => ({ id: option.optionId, label: option.name, kind: permissionKind(option.kind) })),
    },
  });
  return changes;
}

/** The answer to send back for request `optionId` (`undefined`: it was cancelled). */
export function permissionResponse(optionId?: string): AcpPermissionResponse {
  return optionId === undefined ? { outcome: { outcome: "cancelled" } } : { outcome: { outcome: "selected", optionId } };
}

/** What `session/new` / `load` / `resume` answered: the session, and its options. */
export function fromSessionSetup(t: Transcript, setup: AcpSessionSetup, info: { id?: string; cwd?: string; agent?: string; title?: string } = {}): Change[] {
  const options = setupOptions(setup);
  const model = options.find((each) => each.category === "model");
  const session = {
    ...t.session,
    id: setup.sessionId ?? info.id ?? t.session?.id ?? "",
    ...(info.cwd !== undefined ? { cwd: info.cwd } : {}),
    ...(info.agent !== undefined ? { agent: info.agent } : {}),
    ...(info.title !== undefined ? { title: info.title } : {}),
    ...(model ? { model: choiceName(model) } : {}),
  };
  return [
    { type: "session", session },
    { type: "options", options },
  ];
}

/** `session/prompt`'s answer, for a turn that began at `startedAt`: its summary, and the turn's end. */
export function fromPromptResponse(t: Transcript, response: AcpPromptResponse, startedAt: number, stamp: Stamp): Change[] {
  const usage = response.usage;
  return endTurnChanges(
    t,
    {
      stop: stopReason(response.stopReason),
      durationMs: Math.max(0, stamp.now() - startedAt),
      ...(usage
        ? {
            tokens: {
              input: usage.inputTokens,
              output: usage.outputTokens,
              total: usage.totalTokens,
              ...(usage.thoughtTokens != null ? { thought: usage.thoughtTokens } : {}),
              ...(usage.cachedReadTokens != null ? { cached: usage.cachedReadTokens } : {}),
            },
          }
        : {}),
    },
    stamp,
  );
}

/**
 * A client-side terminal's output (`terminal/output`, or what the client saw run), into every tool
 * call showing terminal `terminalId`.
 */
export function terminalOutput(t: Transcript, terminalId: string, output: string, exitCode?: number): Change[] {
  const changes: Change[] = [];
  for (const entry of t.entries) {
    const tool = entry.tool;
    if (!tool?.content.some((part) => part.type === "terminal" && part.id === terminalId)) continue;
    const content = tool.content.map((part): ToolContent => (part.type === "terminal" && part.id === terminalId ? { ...part, output, ...(exitCode !== undefined ? { exitCode } : {}) } : part));
    changes.push({ type: "tool", id: entry.id, patch: { content } });
  }
  return changes;
}

// ── The view's side, as ACP calls ───────────────────────────────────────────────────────────

/** A prompt's text and images as `session/prompt`'s `prompt`. */
export function promptBlocks(text: string, images: Image[] = []): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [];
  if (text !== "") blocks.push({ type: "text", text });
  for (const image of images) {
    if (image.data) blocks.push({ type: "image", data: image.data, mimeType: image.mimeType, ...(image.uri ? { uri: image.uri } : {}) });
    else if (image.uri) blocks.push({ type: "resource_link", uri: image.uri, name: image.uri.split("/").pop() || image.uri, mimeType: image.mimeType });
  }
  return blocks;
}

/**
 * The ACP request a `setOption` command is, for session `sessionId`: `session/set_mode` or
 * `session/set_model` for the older modes and models, else `session/set_config_option`.
 * `undefined` when the transcript has no such option or it does not take the value.
 */
export function setOptionRequest(t: Transcript, command: Extract<Command, { type: "setOption" }>, sessionId: string): AcpRequest | undefined {
  const option = optionOf(t, command.category, command.option);
  if (!option) return undefined;
  if (typeof option.current === "boolean" ? typeof command.value !== "boolean" : !option.choices?.some((choice) => choice.id === command.value)) return undefined;
  if (option.id === MODE_OPTION) return { method: "session/set_mode", params: { sessionId, modeId: command.value } };
  if (option.id === MODEL_OPTION) return { method: "session/set_model", params: { sessionId, modelId: command.value } };
  return { method: "session/set_config_option", params: { sessionId, configId: option.id, value: command.value } };
}

/** The option set to `value`, as the producer applies it once the agent agrees. */
export function setOptionChange(t: Transcript, optionId: string, value: string | boolean): Change | undefined {
  if (!t.options.some((each) => each.id === optionId)) return undefined;
  return { type: "options", options: t.options.map((each) => (each.id === optionId ? { ...each, current: value } : each)) };
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────────

/** A tool call or its update: a push when it is new, else a patch of what it says again. */
function toolChanges(t: Transcript, call: AcpToolCall, stamp: Stamp): Change[] {
  const entry = findTool(t, call.toolCallId);
  const known = entry?.tool;
  const content = call.content ? call.content.map((part) => toolContent(part, known)) : undefined;
  const output = call.rawOutput !== undefined ? rawOutputContent(call.rawOutput, known?.kind ?? kindOf(call), content ?? known?.content ?? []) : undefined;
  const merged = output ?? content;
  const kind = call.kind != null || call.title != null || call.rawInput !== undefined || merged ? kindOf(call, merged ?? known?.content, known?.kind) : undefined;
  if (!entry || !known) {
    const tool: Tool = {
      id: call.toolCallId,
      kind: kind ?? "other",
      title: call.title || "Tool",
      status: toolStatus(call.status) ?? "pending",
      content: merged ?? [],
      ...(call.rawInput !== undefined ? { input: call.rawInput } : {}),
      ...(call.locations?.length ? { locations: call.locations.map(location) } : {}),
    };
    return [{ type: "push", entry: { id: stamp.id(), kind: "tool", at: stamp.now(), tool } }];
  }
  const patch: ToolPatch = {};
  if (call.title) patch.title = call.title;
  if (kind && kind !== known.kind) patch.kind = kind;
  const status = toolStatus(call.status);
  if (status) patch.status = status;
  if (call.rawInput !== undefined) patch.input = call.rawInput;
  if (call.locations) patch.locations = call.locations.map(location);
  if (merged) patch.content = merged;
  return Object.keys(patch).length === 0 ? [] : [{ type: "tool", id: entry.id, patch }];
}

function toolContent(part: AcpToolCallContent, known: Tool | undefined): ToolContent {
  switch (part.type) {
    case "content":
      return part.content.type === "image" ? { type: "image", image: imageOf(part.content) } : { type: "text", text: blockText(part.content) };
    case "diff":
      return { type: "diff", path: part.path, ...(part.oldText != null ? { old: part.oldText } : {}), new: part.newText };
    case "terminal": {
      // An update says the terminal again; what it has shown so far stays.
      const seen = known?.content.find((each) => each.type === "terminal" && each.id === part.terminalId);
      return seen ?? { type: "terminal", id: part.terminalId, output: "" };
    }
  }
}

/**
 * What `rawOutput` adds when the call says no content of its own: a shell's output and exit code
 * as a terminal, anything else that is text as text.
 */
function rawOutputContent(raw: unknown, kind: ToolKind, content: ToolContent[]): ToolContent[] | undefined {
  const exitCode = numberField(raw, "exitCode") ?? numberField(raw, "exit_code");
  if (content.length > 0) {
    if (exitCode === undefined || !content.some((part) => part.type === "terminal")) return undefined;
    return content.map((part) => (part.type === "terminal" ? { ...part, exitCode } : part));
  }
  const text = typeof raw === "string" ? raw : (stringField(raw, "output") ?? joinStreams(raw));
  if (text === undefined) return undefined;
  if (kind === "shell") return [{ type: "terminal", output: text, ...(exitCode !== undefined ? { exitCode } : {}) }];
  return text === "" ? undefined : [{ type: "text", text }];
}

function joinStreams(raw: unknown): string | undefined {
  const out = stringField(raw, "stdout");
  const err = stringField(raw, "stderr");
  if (out === undefined && err === undefined) return undefined;
  return [out, err].filter((part) => part).join("\n");
}

/** A plan said in the running turn replaces the turn's plan entry; else it is a new one. */
function planEntryChange(t: Transcript, plan: PlanItem[], stamp: Stamp): Change {
  for (let at = t.entries.length - 1; at >= 0; at--) {
    const entry = t.entries[at]!;
    if (entry.kind === "user" || entry.kind === "turn") break;
    if (entry.kind === "plan") return { type: "replace", entry: { ...entry, plan } };
  }
  const entry: Entry = { id: stamp.id(), kind: "plan", at: stamp.now(), plan };
  return { type: "push", entry };
}

/** The ACP tool kind as one of ours, told apart further by the tool's name and content. */
export function kindOf(call: AcpToolCall, content?: ToolContent[], fallback?: ToolKind): ToolKind {
  const name = toolName(call);
  if (name?.startsWith("mcp__") || call.title?.startsWith("mcp__")) return "mcp";
  if (name === "Task" || name === "Agent" || stringField(call.rawInput, "subagent_type") !== undefined) return "subagent";
  switch (call.kind) {
    case "execute":
      return "shell";
    case "read":
      return "read";
    case "edit":
    case "delete":
    case "move": {
      const diffs = (content ?? []).filter((part) => part.type === "diff");
      return call.kind === "edit" && diffs.length > 0 && diffs.every((part) => part.old === undefined) ? "write" : "edit";
    }
    case "search":
      return "search";
    case "fetch":
      return "fetch";
    case "think":
    case "switch_mode":
    case "other":
      return "other";
  }
  return fallback ?? "other";
}

/** The agent's own name for the tool, when it says one in `_meta` (claude-code-acp does). */
function toolName(call: AcpToolCall): string | undefined {
  const meta = call._meta;
  if (!meta) return undefined;
  for (const value of Object.values(meta)) {
    const name = stringField(value, "toolName");
    if (name) return name;
  }
  return undefined;
}

function toolStatus(status: AcpToolStatus | null | undefined): ToolStatus | undefined {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

function location(each: { path: string; line?: number | null }): Location {
  return each.line != null ? { path: each.path, line: each.line } : { path: each.path };
}

function planItem(entry: AcpPlanEntry): PlanItem {
  return { content: entry.content, status: entry.status, ...(entry.priority ? { priority: entry.priority } : {}) };
}

function permissionKind(kind: string): PermissionKind {
  return kind === "allow_once" || kind === "allow_always" || kind === "reject_once" || kind === "reject_always" ? kind : "other";
}

function stopReason(reason: string): StopReason {
  return reason === "end_turn" || reason === "cancelled" || reason === "max_tokens" || reason === "max_turn_requests" || reason === "refusal" ? reason : "other";
}

/** The options a session starts with: its `configOptions`, else its modes and models. */
function setupOptions(setup: AcpSessionSetup): ConfigOption[] {
  const options: ConfigOption[] = (setup.configOptions ?? []).map(configOption);
  const has = (category: OptionCategory) => options.some((each) => each.category === category);
  if (setup.modes && !has("mode")) {
    options.push({
      id: MODE_OPTION,
      category: "mode",
      name: "Mode",
      current: setup.modes.currentModeId,
      choices: setup.modes.availableModes.map((mode) => ({ id: mode.id, name: mode.name, ...(mode.description ? { description: mode.description } : {}) })),
    });
  }
  if (setup.models && !has("model")) {
    options.push({
      id: MODEL_OPTION,
      category: "model",
      name: "Model",
      current: setup.models.currentModelId,
      choices: setup.models.availableModels.map((model) => ({ id: model.modelId, name: model.name, ...(model.description ? { description: model.description } : {}) })),
    });
  }
  return options;
}

/** The agent's new `configOptions`, keeping the older mode and model of a category they leave out. */
function mergeOptions(old: ConfigOption[], next: ConfigOption[]): ConfigOption[] {
  const legacy = old.filter((each) => (each.id === MODE_OPTION || each.id === MODEL_OPTION) && !next.some((option) => option.category === each.category));
  return [...next, ...legacy];
}

export function configOption(option: AcpConfigOption): ConfigOption {
  const category: OptionCategory = option.category === "mode" || option.category === "model" || option.category === "thought_level" ? option.category : "other";
  const base = { id: option.id, category, name: option.name, ...(option.description ? { description: option.description } : {}) };
  if (option.type === "boolean") return { ...base, current: option.currentValue };
  const choices: Choice[] = [];
  for (const each of option.options) {
    if ("group" in each) for (const choice of each.options) choices.push({ ...selectChoice(choice), group: each.name });
    else choices.push(selectChoice(each));
  }
  return { ...base, current: option.currentValue, choices };
}

function selectChoice(choice: AcpConfigSelectOption): Choice {
  return { id: choice.value, name: choice.name, ...(choice.description ? { description: choice.description } : {}) };
}

function choiceName(option: ConfigOption): string {
  return option.choices?.find((choice) => choice.id === option.current)?.name ?? String(option.current);
}

function usageOf(used: number, size: number, cost: Usage["cost"], old: Usage): Usage {
  return {
    ...old,
    tokens: used,
    contextSize: size,
    ...(size > 0 ? { contextPct: Math.min(100, Math.round((used * 100) / size)) } : {}),
    ...(cost ? { cost } : {}),
  };
}

/** A content block as markdown text: links for resources, their text for embedded ones. */
function blockText(block: AcpContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "resource_link":
      return `[${block.title || block.name}](${block.uri})`;
    case "resource":
      return block.resource.text !== undefined ? `\n\`\`\`\n${block.resource.text}\n\`\`\`\n` : `[${block.resource.uri}](${block.resource.uri})`;
    case "image":
    case "audio":
      return "";
  }
}

function imageOf(block: { data: string; mimeType: string; uri?: string | null }): Image {
  return { mimeType: block.mimeType, data: block.data, ...(block.uri ? { uri: block.uri } : {}) };
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : undefined;
}
