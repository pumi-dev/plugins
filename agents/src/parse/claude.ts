// Claude Code's session file (`~/.claude/projects/<project>/<id>.jsonl`) as the conversation's
// changes. Each line is a record: `user` (a prompt, or the results of tool calls), `assistant` (one
// content block of a reply: text, thinking or a tool_use), `system` (a turn's length, a compaction,
// a local command's output), `summary` (the title), `cost-state`, and bookkeeping left out. A
// subagent's records (`isSidechain`) and injected ones (`isMeta`) are not the conversation's.
// No `import … from "pumi"` here.
import { noticeChange, type Change, type Stamp } from "../conversation/change.ts";
import type { ToolContent, Transcript, Usage } from "../conversation/model.ts";
import { imageOf, num, obj, objs, plain, resultContent, str, timeOf, toolPush, toolResult, type Parser, type Rec } from "./common.ts";

export class ClaudeParser implements Parser {
  #usage: Usage = {};

  record(record: Rec, t: Transcript, stamp: Stamp): Change[] {
    if (record.isSidechain === true) return [];
    const at = timeOf(record.timestamp, stamp);
    switch (record.type) {
      case "user":
        return this.#user(record, t, at, stamp);
      case "assistant":
        return this.#assistant(record, t, at, stamp);
      case "attachment":
        return queuedPrompt(record, at, stamp);
      case "system":
        return system(record, at, stamp);
      case "summary": {
        const title = str(record.summary);
        return title && t.session ? [{ type: "session", session: { ...t.session, title } }] : [];
      }
      case "cost-state": {
        const cost = num(record.totalCostUSD);
        if (!cost) return [];
        this.#usage = { ...this.#usage, cost: { amount: cost, currency: "USD" } };
        return [{ type: "usage", usage: this.#usage }];
      }
      default:
        return [];
    }
  }

  #user(record: Rec, t: Transcript, at: number, stamp: Stamp): Change[] {
    const message = obj(record.message);
    if (record.isCompactSummary === true) return [noticeChange("The conversation was compacted.", "info", stamp)];
    const content = message?.content;
    const changes: Change[] = [];
    // A prompt's record uuid: what a rewind or a fork of the conversation names.
    const source = str(record.uuid);
    if (typeof content === "string") {
      if (record.isMeta !== true) changes.push(...promptText(content, at, stamp, source));
      return changes;
    }
    const result = obj(record.toolUseResult);
    for (const block of objs(content)) {
      if (block.type === "tool_result") {
        const id = str(block.tool_use_id);
        if (!id) continue;
        const output = resultContent(block.content).map((part) => (part.type === "text" ? { ...part, text: plain(part.text) } : part));
        changes.push(...toolResult(t, id, block.is_error === true, [...patchOf(result), ...output]));
        continue;
      }
      if (record.isMeta === true) continue;
      if (block.type === "text") changes.push(...promptText(str(block.text) ?? "", at, stamp, source));
      const image = imageOf(block);
      if (image) changes.push({ type: "push", entry: { id: stamp.id(), kind: "image", at, image, from: "user" } });
    }
    return changes;
  }

  #assistant(record: Rec, t: Transcript, at: number, stamp: Stamp): Change[] {
    const message = obj(record.message);
    if (!message) return [];
    const changes: Change[] = [];
    if (record.isApiErrorMessage === true) {
      const text = objs(message.content)
        .map((block) => str(block.text) ?? "")
        .join("");
      return [noticeChange(text || "The request to the model failed.", "error", stamp)];
    }
    for (const block of objs(message.content)) {
      if (block.type === "text") {
        const text = str(block.text);
        if (text) changes.push({ type: "push", entry: { id: stamp.id(), kind: "agent", at, text } });
      } else if (block.type === "thinking") {
        const text = str(block.thinking);
        if (text) changes.push({ type: "push", entry: { id: stamp.id(), kind: "thought", at, text } });
      } else if (block.type === "tool_use") {
        const id = str(block.id);
        const name = str(block.name) ?? "tool";
        if (id) changes.push(toolPush(id, name, block.input, callContent(name, block.input), at, stamp));
      }
    }
    const model = str(message.model);
    if (model && model !== "<synthetic>" && t.session && t.session.model !== model) changes.push({ type: "session", session: { ...t.session, model } });
    const usage = obj(message.usage);
    if (usage) {
      const tokens = (num(usage.input_tokens) ?? 0) + (num(usage.cache_read_input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0) + (num(usage.output_tokens) ?? 0);
      if (tokens > 0) {
        this.#usage = { ...this.#usage, tokens };
        changes.push({ type: "usage", usage: this.#usage });
      }
    }
    return changes;
  }
}

/** What a typed prompt says: a slash command as `/name args`, its output as a notice, an interruption as a stopped turn, else the text. */
function promptText(text: string, at: number, stamp: Stamp, source?: string): Change[] {
  const from = source ? { source } : {};
  if (text.trim() === "") return [];
  if (/^\[Request interrupted by user/.test(text)) return [{ type: "push", entry: { id: stamp.id(), kind: "turn", at, turn: { stop: "cancelled" } } }];
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim();
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    return [{ type: "push", entry: { id: stamp.id(), kind: "user", at, text: args ? `${name} ${args}` : name, ...from } }];
  }
  const stdout = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(text)?.[1];
  if (stdout !== undefined) return stdout.trim() === "" ? [] : [noticeChange(plain(stdout).trim(), "info", stamp)];
  if (/^<local-command-caveat>/.test(text) || /^<system-reminder>/.test(text)) return [];
  return [{ type: "push", entry: { id: stamp.id(), kind: "user", at, text, ...from } }];
}

/** A prompt sent while a turn ran is written as a `queued_command` attachment, not a `user` record. */
function queuedPrompt(record: Rec, at: number, stamp: Stamp): Change[] {
  const attachment = obj(record.attachment);
  if (attachment?.type !== "queued_command" || attachment.commandMode !== "prompt") return [];
  const origin = obj(attachment.origin)?.kind;
  if (origin !== undefined && origin !== "human") return [];
  const prompt = typeof attachment.prompt === "string" ? attachment.prompt : objs(attachment.prompt).map((block) => str(block.text) ?? "").join("\n");
  return promptText(prompt, at, stamp, str(record.uuid));
}

function system(record: Rec, at: number, stamp: Stamp): Change[] {
  switch (record.subtype) {
    case "turn_duration": {
      const durationMs = num(record.durationMs);
      return [{ type: "push", entry: { id: stamp.id(), kind: "turn", at, turn: { stop: "end_turn", ...(durationMs !== undefined ? { durationMs } : {}) } } }];
    }
    case "compact_boundary":
      return [noticeChange("The conversation was compacted.", "info", stamp)];
    case "api_error":
      return [noticeChange(str(record.content) ?? "The request to the model failed; Claude is retrying.", "warning", stamp)];
    case "local_command":
      return promptText(str(record.content) ?? "", at, stamp);
    default:
      return [];
  }
}

/** What a call shows before it has a result: an edit's or a write's change. */
function callContent(name: string, input: unknown): ToolContent[] {
  const args = obj(input);
  const path = args ? str(args.file_path) : undefined;
  if (!args || !path) return [];
  if (name === "Edit" && typeof args.new_string === "string") return [{ type: "diff", path, old: str(args.old_string) ?? "", new: args.new_string }];
  if (name === "Write" && typeof args.content === "string") return [{ type: "diff", path, new: args.content }];
  if (name === "MultiEdit") {
    return objs(args.edits).flatMap((edit): ToolContent[] => (typeof edit.new_string === "string" ? [{ type: "diff", path, old: str(edit.old_string) ?? "", new: edit.new_string }] : []));
  }
  return [];
}

/** The patch Claude resolved against the file (`toolUseResult.structuredPatch`), as a unified diff. */
function patchOf(result: Rec | undefined): ToolContent[] {
  const path = result ? str(result.filePath) : undefined;
  const hunks = objs(result?.structuredPatch);
  if (!path || hunks.length === 0) return [];
  const lines = [`--- ${path}`, `+++ ${path}`];
  for (const hunk of hunks) {
    lines.push(`@@ -${num(hunk.oldStart) ?? 0},${num(hunk.oldLines) ?? 0} +${num(hunk.newStart) ?? 0},${num(hunk.newLines) ?? 0} @@`);
    if (Array.isArray(hunk.lines)) for (const line of hunk.lines) if (typeof line === "string") lines.push(line);
  }
  return [{ type: "diff", path, new: "", unified: lines.join("\n") }];
}
