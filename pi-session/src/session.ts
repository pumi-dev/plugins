// What the strip knows of its pane, read when it acts so it is never stale: the session pi's hook
// reported (`@agent.session`: an id, or the path of a session file) and the pane's directory. pi
// names its session files `<time>_<id>.jsonl`, their first record `{"type": "session", "id": …}`.
import { closeSync, openSync, readSync } from "node:fs";

import { option, type PaneId } from "pumi";

/** A pi pane's session, as the hook reported it. */
export class Session {
  constructor(
    /** What pi's hook reported: an id, or a session file's path. */
    readonly value: string,
    /** The pane's directory, when it has one. */
    readonly cwd: string | null,
  ) {}

  /** The session of `pane`, or why it has none. */
  static async of(pane: PaneId): Promise<Session> {
    const text = async (name: string) => {
      const value = await option.get(name, { scope: "pane", id: pane });
      return typeof value === "string" && value !== "" ? value : null;
    };
    const value = await text("@agent.session");
    if (value === null) throw new Error("pi has not said which session it is in");
    return new Session(value, await text("pane_current_path"));
  }

  /** The session's id: the value itself, or read from its file's name or its first record. */
  id(): string | null {
    if (isId(this.value)) return this.value;
    return nameId(this.value) ?? headerId(this.value);
  }

  /** What Copy puts on the clipboard: the id, the file, and the directory, each on its own line. */
  summary(): string {
    const lines: string[] = [];
    const id = this.id();
    if (id !== null) lines.push(`pi session ${id}`);
    if (this.value.endsWith(".jsonl")) lines.push(`path: ${this.value}`);
    if (this.cwd !== null) lines.push(`cwd:  ${this.cwd}`);
    return lines.join("\n");
  }
}

/** A UUID: 8-4-4-4-12 hex digits. */
export function isId(id: string): boolean {
  if (id.length !== 36) return false;
  for (let i = 0; i < id.length; i++) {
    const c = id[i]!;
    const dash = i === 8 || i === 13 || i === 18 || i === 23;
    if (dash ? c !== "-" : !/[0-9a-fA-F]/.test(c)) return false;
  }
  return true;
}

/** pi names its session files `<time>_<id>.jsonl`. */
export function nameId(path: string): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const at = stem.lastIndexOf("_");
  if (at < 0) return null;
  const id = stem.slice(at + 1);
  return isId(id) ? id : null;
}

/** A session file's first record is `{"type": "session", "id": …}`. */
export function headerId(path: string): string | null {
  const line = firstLine(path);
  if (line === null) return null;
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  return record?.type === "session" && typeof record.id === "string" ? record.id : null;
}

/** The first line of the file at `path` (a session file's header, without reading the rest). */
function firstLine(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const newline = text.indexOf("\n");
    return newline < 0 ? text : text.slice(0, newline);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
