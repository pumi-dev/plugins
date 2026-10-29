// What the hook function answers an agent's hook, in the agent's own format: the well-known keys
// of its input (Claude's, Codex's, Cursor's; pi's and OpenCode's from their files), the state each
// point of its life reports, a permission asked in pumi and its answer as the agent's decision,
// and a queued prompt handed on at a turn's end. `main.ts` runs it. No `import … from "pumi"` here.
import type { HookAgent, HookEvent } from "./integrations.ts";

const EVENTS: HookEvent[] = ["start", "prompt", "stop", "compact", "permission", "question", "resume"];

export function hookEvent(word: unknown): HookEvent | undefined {
  return EVENTS.find((event) => event === word);
}

/** How what the agent is told goes out. */
export type Format = "text" | "hooks" | "cursor";

/** The format an agent's hook prints: its shape says. */
export function formatOf(agent: HookAgent | undefined): Format {
  switch (agent?.shape.kind) {
    case "hooks":
      return "hooks";
    case "cursor":
      return "cursor";
    default:
      return "text";
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** What a hook is told, from its input. */
export interface Told {
  session?: string;
  /** The session file's absolute path. */
  transcript?: string;
  model?: string;
  /** The event that ran the hook, as the agent names it (Claude's `hook_event_name`). */
  hookEvent?: string;
}

/** One line of text, short enough to be an option's value. */
export function plainLine(text: string): boolean {
  return text.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/.test(text);
}

function firstString(input: Json, keys: string[]): string | undefined {
  for (const key of keys) if (typeof input[key] === "string") return input[key] as string;
  return undefined;
}

/** The model, as an agent's hook names it: a name (`claude-sonnet-4-5`), or `{provider, id}`, or `{display_name}`. */
export function modelOf(input: Json): string | undefined {
  const model = input.model;
  if (typeof model === "string") return model;
  if (!isObject(model)) return undefined;
  const provider = typeof model.provider === "string" ? model.provider : undefined;
  const id = typeof model.id === "string" ? model.id : undefined;
  if (provider && id) return `${provider}/${id}`;
  if (id) return id;
  return typeof model.display_name === "string" ? model.display_name : undefined;
}

/** The session, its file and the model, from a hook's input: what is not one plain line is left out. */
export function told(given: unknown): Told {
  const input = isObject(given) ? given : {};
  const session = firstString(input, ["session_id", "conversation_id", "sessionId"]);
  const transcript = firstString(input, ["transcript_path", "transcriptPath", "session_file"]);
  const model = modelOf(input);
  const out: Told = {};
  if (session && plainLine(session)) out.session = session;
  if (transcript && plainLine(transcript) && transcript.startsWith("/")) out.transcript = transcript;
  if (model && plainLine(model)) out.model = model;
  const ran = firstString(input, ["hook_event_name"]);
  if (ran && /^[A-Za-z]{1,64}$/.test(ran)) out.hookEvent = ran;
  return out;
}

/** The state each point of an agent's life reports; none for those that say nothing of it. */
export function reportState(event: HookEvent): "idle" | "working" | "done" | undefined {
  switch (event) {
    case "start":
      return "idle";
    case "prompt":
      return "working";
    case "stop":
      return "done";
    default:
      return undefined;
  }
}

/** The OSC 7501 report of `state` (and why it is blocked, `kind`), as the agent would send it: `tab.call`'s `report` body. */
export function reportBody(agent: string, state: string, kind?: "permission" | "question"): string {
  return `state=${state}${kind ? `:kind=${kind}` : ""}:app=${agent}`;
}

/**
 * What the agent is told about the workspace, in its format: Claude's (and the like) as the
 * hook's `additionalContext` for the event that ran it, Cursor's as `additional_context`, and the
 * rest as the text itself.
 */
export function contextOutput(format: Format, agent: HookAgent | undefined, event: "start" | "prompt", text: string, hookEvent?: string): string {
  switch (format) {
    case "text":
      return text;
    case "hooks": {
      const shape = agent?.shape.kind === "hooks" ? agent.shape : undefined;
      const named = event === "start" ? shape?.start : (shape?.prompt ?? shape?.start);
      const name = hookEvent || named || (event === "start" ? "SessionStart" : "UserPromptSubmit");
      return JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: text } });
    }
    case "cursor":
      return JSON.stringify({ additional_context: text });
  }
}

/**
 * How a turn began, from its input: Claude's `source` (`resume`, `compact`) or pi's `resumed` at a
 * start, and OpenCode's `full`, which asks for the whole context at each prompt.
 */
export function startOf(given: unknown): { resumed: boolean; compacted: boolean; full: boolean } {
  const input = isObject(given) ? given : {};
  return { resumed: input.source === "resume" || input.resumed === true, compacted: input.source === "compact", full: input.full === true };
}

/** A queued prompt, as the stop hook hands it on: the turn goes on with it. */
export function continuation(format: Format, text: string): string {
  switch (format) {
    case "text":
      return text;
    // Claude's Stop: `block` keeps the agent going, with `reason` as what it is told next.
    case "hooks":
      return JSON.stringify({ decision: "block", reason: text });
    case "cursor":
      return JSON.stringify({ followup_message: text });
  }
}

/** What a permission hook asks (`request.open`), from its input: Claude's `tool_name` and `tool_input`, and an "always" option when it suggests a rule. */
export function permissionAsk(label: string, given: unknown): Json | undefined {
  const input = isObject(given) ? given : {};
  const tool = typeof input.tool_name === "string" && input.tool_name !== "" ? input.tool_name : undefined;
  if (!tool) return undefined;
  const args = isObject(input.tool_input) ? input.tool_input : {};
  const named = firstString(args, ["command", "file_path", "path", "url", "pattern"]);
  const what = named === undefined ? undefined : [...(named.split("\n")[0] ?? "")].slice(0, 160).join("");
  const title = what ? `${label} wants to use ${tool}: ${what}` : `${label} wants to use ${tool}`;
  const options: Json[] = [{ id: "allow", label: "Allow", kind: "allow_once" }];
  if (Array.isArray(input.permission_suggestions) && input.permission_suggestions.length > 0) options.push({ id: "always", label: "Always allow", kind: "allow_always" });
  options.push({ id: "deny", label: "Deny", kind: "reject_once" });
  const detail = typeof args.description === "string" ? args.description : null;
  return { kind: "permission", title, detail, tool, options };
}

/** Claude's `PermissionRequest` decision for an answer; none (its own prompt asks) for no answer, or one it does not know. */
export function permissionDecision(answer: unknown, given: unknown): string | undefined {
  const input = isObject(given) ? given : {};
  const picked = isObject(answer) ? answer : {};
  let decision: Json;
  switch (picked.option) {
    case "allow":
      decision = { behavior: "allow" };
      break;
    case "always":
      decision = { behavior: "allow", updatedPermissions: input.permission_suggestions ?? null };
      break;
    case "deny": {
      const message = typeof picked.text === "string" && picked.text !== "" ? picked.text : "Denied in pumi";
      decision = { behavior: "deny", message };
      break;
    }
    default:
      return undefined;
  }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
}
