// pi's session file (`~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl`; omp's under `~/.omp`) as
// the conversation's changes. The first line is `{type: "session", id, cwd}`; every other entry has
// an `id` and a `parentId`, so the file is a tree: the conversation is the branch from its last
// entry back to the root, and an entry whose parent is not the one before it (`/tree`, a fork in
// place) moves to another branch. `message`s are the user's, the assistant's (text, thinking,
// tool calls), tool results and `!` commands; `model_change`, `session_info`, `compaction` and
// displayed `custom_message`s say the rest. No `import … from "pumi"` here.
import { noticeChange, type Change, type Stamp } from "../conversation/change.ts";
import type { StopReason, ToolContent, Transcript, Usage } from "../conversation/model.ts";
import { imageOf, num, obj, objs, resultContent, str, timeOf, toolPush, toolResult, type Parser, type Rec } from "./common.ts";

export class PiParser implements Parser {
  #last: string | undefined;
  #usage: Usage = {};
  #cost = 0;

  /** The entries on the branch the last one is on, in the file's order; the header stays. */
  select(records: Rec[]): Rec[] {
    const byId = new Map<string, Rec>();
    let leaf: Rec | undefined;
    for (const record of records) {
      const id = str(record.id);
      if (id && record.type !== "session") {
        byId.set(id, record);
        leaf = record;
      }
    }
    const on = new Set<Rec>();
    for (let at = leaf; at && !on.has(at); at = byId.get(str(at.parentId) ?? "")) on.add(at);
    return records.filter((record) => record.type === "session" || on.has(record));
  }

  continues(record: Rec): boolean {
    if (record.type === "session" || !str(record.id)) return true;
    // A new root (`parentId: null` after the first entry: a rewind to before the first message) is another branch too.
    if (record.parentId === null) return this.#last === undefined;
    const parent = str(record.parentId);
    return this.#last === undefined || parent === undefined || parent === this.#last;
  }

  record(record: Rec, t: Transcript, stamp: Stamp): Change[] {
    if (record.type !== "session" && str(record.id)) this.#last = str(record.id);
    const at = timeOf(record.timestamp, stamp);
    switch (record.type) {
      case "message":
        return this.#message(record, obj(record.message) ?? {}, t, at, stamp);
      case "model_change": {
        const model = [str(record.provider), str(record.modelId)].filter(Boolean).join("/");
        return model && t.session && t.session.model !== model ? [{ type: "session", session: { ...t.session, model } }] : [];
      }
      case "session_info": {
        const title = str(record.name);
        return title && t.session ? [{ type: "session", session: { ...t.session, title } }] : [];
      }
      case "compaction":
        return [noticeChange("The conversation was compacted.", "info", stamp)];
      case "custom_message": {
        const text = record.display === true ? textOf(record.content) : "";
        return text ? [noticeChange(text, "info", stamp)] : [];
      }
      default:
        return [];
    }
  }

  #message(record: Rec, message: Rec, t: Transcript, at: number, stamp: Stamp): Change[] {
    switch (message.role) {
      case "user": {
        const source = str(record.id);
        const changes: Change[] = [];
        const text = textOf(message.content);
        if (text) changes.push({ type: "push", entry: { id: stamp.id(), kind: "user", at, text, ...(source ? { source } : {}) } });
        for (const block of objs(message.content)) {
          const image = imageOf(block);
          if (image) changes.push({ type: "push", entry: { id: stamp.id(), kind: "image", at, image, from: "user" } });
        }
        return changes;
      }
      case "assistant":
        return this.#assistant(message, t, at, stamp);
      case "toolResult": {
        const id = str(message.toolCallId);
        if (!id) return [];
        const patch = str(obj(message.details)?.patch);
        const diff: ToolContent[] = patch ? [{ type: "diff", path: patchPath(patch) ?? str(message.toolName) ?? "file", new: "", unified: patch }] : [];
        return toolResult(t, id, message.isError === true, [...diff, ...resultContent(message.content)]);
      }
      case "bashExecution": {
        const command = str(message.command);
        if (!command) return [];
        const push = toolPush(`bash:${stamp.id()}`, "bash", { command }, [{ type: "terminal", output: str(message.output) ?? "", ...exitOf(message) }], at, stamp);
        if (push.entry.tool) push.entry.tool.status = message.cancelled === true ? "canceled" : (num(message.exitCode) ?? 0) === 0 ? "completed" : "failed";
        return [push];
      }
      default:
        return [];
    }
  }

  #assistant(message: Rec, t: Transcript, at: number, stamp: Stamp): Change[] {
    const changes: Change[] = [];
    for (const block of objs(message.content)) {
      if (block.type === "text") {
        const text = str(block.text);
        if (text) changes.push({ type: "push", entry: { id: stamp.id(), kind: "agent", at, text } });
      } else if (block.type === "thinking") {
        const text = str(block.thinking);
        if (text) changes.push({ type: "push", entry: { id: stamp.id(), kind: "thought", at, text } });
      } else if (block.type === "toolCall") {
        const id = str(block.id);
        const name = str(block.name) ?? "tool";
        if (id) changes.push(toolPush(id, name, block.arguments, callContent(name, obj(block.arguments)), at, stamp));
      }
    }
    const model = [str(message.provider), str(message.model)].filter(Boolean).join("/");
    if (model && t.session && t.session.model !== model) changes.push({ type: "session", session: { ...t.session, model } });
    const usage = obj(message.usage);
    if (usage) {
      this.#cost += num(obj(usage.cost)?.total) ?? 0;
      const tokens = num(usage.totalTokens);
      this.#usage = { ...this.#usage, ...(tokens ? { tokens } : {}), ...(this.#cost > 0 ? { cost: { amount: this.#cost, currency: "USD" } } : {}) };
      changes.push({ type: "usage", usage: this.#usage });
    }
    const stop = stopOf(message.stopReason);
    if (stop) {
      const error = str(message.errorMessage);
      if (error && stop === "error") changes.push(noticeChange(error, "error", stamp));
      changes.push({ type: "push", entry: { id: stamp.id(), kind: "turn", at, turn: { stop } } });
    }
    return changes;
  }
}

/** How an assistant message ended its turn: `stop`, `aborted` and `error` do; `toolUse` goes on. */
export function stopOf(reason: unknown): StopReason | undefined {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "aborted":
      return "cancelled";
    case "error":
      return "error";
    case "length":
      return "max_tokens";
    default:
      return undefined;
  }
}

/** A message's text: a string, or its `text` blocks joined. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim() === "" ? "" : content;
  return objs(content)
    .map((block) => (block.type === "text" ? (str(block.text) ?? "") : ""))
    .filter((text) => text !== "")
    .join("\n\n");
}

/** What a call shows before its result: an edit's changes, a write's text. */
export function callContent(name: string, args: Rec | undefined): ToolContent[] {
  const path = args ? str(args.path) : undefined;
  if (!args || !path) return [];
  if (name === "write" && typeof args.content === "string") return [{ type: "diff", path, new: args.content }];
  if (name === "edit") {
    const edits = Array.isArray(args.edits) ? objs(args.edits) : [args];
    return edits.flatMap((edit): ToolContent[] => (typeof edit.newText === "string" ? [{ type: "diff", path, old: str(edit.oldText) ?? "", new: edit.newText }] : []));
  }
  return [];
}

function patchPath(patch: string): string | undefined {
  return /^\+\+\+ (.+)$/m.exec(patch)?.[1]?.trim();
}

function exitOf(message: Rec): { exitCode?: number } {
  const exitCode = num(message.exitCode);
  return exitCode === undefined ? {} : { exitCode };
}
