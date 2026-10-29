// What pi says and runs before its session file has it: the plugin's pi extension (its hook,
// `hooks/templates.ts`) keeps `<session file>.live` as the whole of the assistant message being streamed (its text and
// thinking) and each running tool's output so far. `Live` turns each read of it into the
// conversation's changes: the message's blocks as entries that grow, a running tool's output in
// its card. When the file's own record of the message comes, its entries take the live ones'
// places (`settle`), so nothing shows twice. No `import … from "pumi"` here.
import type { Change, Stamp } from "./conversation/change.ts";
import { findTool, type Entry, type EntryKind, type ToolContent, type Transcript } from "./conversation/model.ts";
import { num, obj, objs, type Rec } from "./parse/common.ts";

export interface LiveBlock {
  type: "text" | "thinking";
  text: string;
}

/** The live file, read. */
export interface LiveSnapshot {
  /** The assistant message being streamed; `timestamp` is the one its record in the file will have. */
  message: { timestamp?: number; content: LiveBlock[] } | null;
  /** Each running tool's output so far, by its call's id. */
  tools: Record<string, string>;
}

export const EMPTY: LiveSnapshot = { message: null, tools: {} };

/** The live file's text, read; `undefined` when it is not one (cut, or of another version). */
export function parseLive(text: string): LiveSnapshot | undefined {
  let value: Rec | undefined;
  try {
    value = obj(JSON.parse(text));
  } catch {
    return undefined;
  }
  if (!value || value.v !== 1) return undefined;
  const raw = obj(value.message);
  const message = raw
    ? {
        timestamp: num(raw.timestamp),
        content: objs(raw.content).flatMap((block): LiveBlock[] => (block.type === "text" || block.type === "thinking" ? [{ type: block.type, text: typeof block.text === "string" ? block.text : "" }] : [])),
      }
    : null;
  const tools: Record<string, string> = {};
  for (const [id, tool] of Object.entries(obj(value.tools) ?? {})) {
    const output = obj(tool)?.output;
    if (typeof output === "string") tools[id] = output;
  }
  return { message, tools };
}

/** One streamed message's entries: the id shown for each of its blocks, by the block's place. */
interface Shown {
  ids: (string | undefined)[];
  texts: string[];
}

export class Live {
  /** The messages shown live and not yet in the file, by their timestamp. */
  #shown = new Map<number, Shown>();
  /** The assistant messages the file has, by their timestamp: a late read of one shows nothing. */
  #done = new Set<number>();
  /** The output last shown for each running tool, by its call's id. */
  #outputs = new Map<string, string>();

  /** The transcript was read again: what was shown live is not in it. */
  reset(): void {
    this.#shown.clear();
    this.#outputs.clear();
  }

  /** The changes that show `snapshot` on `t`. */
  show(snapshot: LiveSnapshot, t: Transcript, stamp: Stamp): Change[] {
    const changes: Change[] = [];
    const message = snapshot.message;
    const ts = message?.timestamp;
    if (message && ts !== undefined && !this.#done.has(ts)) {
      let shown = this.#shown.get(ts);
      if (!shown) this.#shown.set(ts, (shown = { ids: [], texts: [] }));
      message.content.forEach((block, at) => {
        if (block.text.trim() === "") return;
        const kind: EntryKind = block.type === "text" ? "agent" : "thought";
        const id = shown.ids[at];
        const before = shown.texts[at] ?? "";
        if (id === undefined) {
          const entry: Entry = { id: stamp.id(), kind, at: stamp.now(), text: block.text };
          shown.ids[at] = entry.id;
          changes.push({ type: "push", entry });
        } else if (block.text === before) {
          return;
        } else if (block.text.startsWith(before)) {
          changes.push({ type: "append", id, text: block.text.slice(before.length) });
        } else {
          const entry = t.entries.find((each) => each.id === id);
          if (entry) changes.push({ type: "replace", entry: { ...entry, kind, text: block.text } });
        }
        shown.texts[at] = block.text;
      });
    }
    for (const [toolId, output] of Object.entries(snapshot.tools)) {
      if (output === "" || this.#outputs.get(toolId) === output) continue;
      const entry = findTool(t, toolId);
      if (!entry?.tool || entry.tool.status !== "running") continue;
      this.#outputs.set(toolId, output);
      const part: ToolContent = entry.tool.kind === "shell" ? { type: "terminal", output } : { type: "text", text: output };
      const kept = entry.tool.content.filter((each) => each.type === "diff");
      changes.push({ type: "tool", id: entry.id, patch: { content: [...kept, part] } });
    }
    for (const toolId of this.#outputs.keys()) if (!(toolId in snapshot.tools)) this.#outputs.delete(toolId);
    return changes;
  }

  /** The file has the assistant message of `timestamp` from now on: a late read of it shows nothing. */
  done(timestamp: number | undefined): void {
    if (timestamp !== undefined) this.#done.add(timestamp);
  }

  /**
   * The changes of an assistant record (`timestamp` its message's), with its text and thinking put
   * in the places of the entries shown live for it. An entry shown live that the record does not
   * have is emptied; one the record has beyond those is pushed after.
   */
  settle(timestamp: number | undefined, changes: Change[], t: Transcript): Change[] {
    this.done(timestamp);
    const shown = timestamp === undefined ? undefined : this.#shown.get(timestamp);
    if (!shown) return changes;
    this.#shown.delete(timestamp!);
    const live = shown.ids.filter((id): id is string => id !== undefined && t.entries.some((entry) => entry.id === id));
    const out = changes.map((change): Change => {
      if (change.type !== "push" || (change.entry.kind !== "agent" && change.entry.kind !== "thought")) return change;
      const id = live.shift();
      return id === undefined ? change : { type: "replace", entry: { ...change.entry, id } };
    });
    for (const id of live) {
      const entry = t.entries.find((each) => each.id === id);
      if (entry) out.push({ type: "replace", entry: { ...entry, text: "" } });
    }
    return out;
  }
}

/** The timestamp of a pi record's assistant message, when it is one. */
export function assistantTimestamp(record: Rec): number | undefined {
  const message = record.type === "message" ? obj(record.message) : undefined;
  return message?.role === "assistant" ? num(message.timestamp) : undefined;
}

/** The live file of a pi session file. */
export function liveFileOf(file: string): string {
  return `${file}.live`;
}
