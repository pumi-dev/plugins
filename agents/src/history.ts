// Every conversation the agents enabled here have kept on this Mac, whichever tab or terminal
// started them: pi's session files, Claude Code's project logs, Codex's rollouts. The History
// panel lists them (`ui/history.tsx`) and a press opens one in a chat tab that resumes it. Each
// file is read from its beginning only (`HEAD`), which holds the session's id, its directory and
// the first thing the user said. No `import … from "pumi"` here.
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { catalogAgent, type CatalogAgent } from "./catalog.ts";
import type { Engine } from "./session/wire.ts";

/** A past session, as the History panel draws it and opens it. */
export interface PastSession {
  /** The catalog's id (`pi`). */
  agent: string;
  /** What the menu calls its agent (`Pi`). */
  name: string;
  /** The agent's own id for it: what a chat tab resumes it with. */
  session: string;
  title: string;
  /** Where it ran: a tab's directory. */
  cwd: string;
  /** Its file, written last when it was last used (ms). */
  updatedAt: number;
  /** What a chat tab resumes it with. */
  engine: Engine;
}

/** How much of a session file is read: its first records hold what the panel needs. */
const HEAD = 64_000;

/** How many sessions the list keeps: the newest, which a search of its own narrows. */
const KEPT = 300;

/** What a panel gets: the sessions, newest first, and the mark of each agent it names. */
export interface Past {
  sessions: PastSession[];
  /** Each agent's id, and its mark as a data URI (`icons.ts`), for the row's picture. */
  marks: Record<string, string | undefined>;
}

type Rec = Record<string, any>;

const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const obj = (value: unknown): Rec | undefined => (typeof value === "object" && value !== null ? (value as Rec) : undefined);
const list = (value: unknown): Rec[] => (Array.isArray(value) ? value.filter((each): each is Rec => typeof each === "object" && each !== null) : []);

/**
 * The past sessions of the agents `enabled` names (`pi`, `claude`, …), newest first: what each
 * one's own store holds, read where it keeps it.
 */
export async function history(enabled: string[]): Promise<Past> {
  const agents = enabled.map((id) => catalogAgent(id)).filter((agent): agent is CatalogAgent => agent !== undefined && SCANS[agent.id] !== undefined);
  const found = await Promise.all(agents.map((agent) => SCANS[agent.id]!(agent).catch(() => [])));
  const sessions = found.flat().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, KEPT);
  const marks: Record<string, string | undefined> = {};
  for (const session of sessions) marks[session.agent] ??= await markOf(session.agent);
  return { sessions, marks };
}

/** The scans, by the catalog's id: the stores this plugin knows how to read. */
const SCANS: Record<string, (agent: CatalogAgent) => Promise<PastSession[]>> = {
  pi: (agent) => piSessions(agent),
  claude: (agent) => claudeSessions(agent),
  codex: (agent) => codexSessions(agent),
};

/** `agent`'s sessions as a row of its own: what a chat tab resumes it with. */
function row(agent: CatalogAgent, session: string, title: string, cwd: string, path: string, when?: string): PastSession {
  return {
    agent: agent.id,
    name: agent.title,
    session,
    title,
    cwd,
    updatedAt: written(path) ?? (when ? Date.parse(when) : 0) ?? Date.now(),
    engine: (agent.sdk ?? "acp") as Engine,
  };
}

function written(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** The files under `dir` whose name `wanted` takes, at most `deep` folders down. */
function files(dir: string, wanted: (name: string) => boolean, deep = 3): string[] {
  const out: string[] = [];
  const walk = (at: string, left: number) => {
    let names: string[];
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(at, name);
      let isDirectory = false;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        if (left > 0) walk(path, left - 1);
      } else if (wanted(name)) out.push(path);
    }
  };
  walk(dir, deep);
  return out;
}

/** A session file's first records, each a line; the line the read cut is left out. */
async function head(path: string): Promise<Rec[]> {
  let text: string;
  try {
    text = await Bun.file(path).slice(0, HEAD).text();
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const out: Rec[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // The line the read cut, or one a parser wrote differently: not a record.
    }
  }
  return out;
}

// ── pi ──────────────────────────────────────────────────────────────────────────────────────

/** pi's sessions: `~/.pi/agent/sessions/<its directory>/<time>_<id>.jsonl`, named by its own. */
async function piSessions(agent: CatalogAgent): Promise<PastSession[]> {
  const root = process.env.PI_SESSION_DIR ?? join(homedir(), ".pi", "agent", "sessions");
  const out: PastSession[] = [];
  for (const path of files(root, (name) => name.endsWith(".jsonl"))) {
    const records = await head(path);
    const header = records.find((each) => each.type === "session");
    const session = str(header?.id);
    const cwd = str(header?.cwd);
    if (!session || !cwd) continue;
    const info = records.find((each) => each.type === "session_info");
    const title = str(info?.name) ?? said(records, "pi") ?? "New Agent Thread";
    out.push(row(agent, session, title, cwd, path, str(header?.timestamp)));
  }
  return out;
}

// ── Claude Code ─────────────────────────────────────────────────────────────────────────────

/** Claude's sessions: `~/.claude/projects/<its directory>/<id>.jsonl`, named by the file. */
async function claudeSessions(agent: CatalogAgent): Promise<PastSession[]> {
  const root = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, "projects") : join(homedir(), ".claude", "projects");
  const out: PastSession[] = [];
  for (const path of files(root, (name) => name.endsWith(".jsonl"), 1)) {
    const records = await head(path);
    const session = str(records.find((each) => each.type === "user" || each.type === "summary")?.sessionId) ?? basename(path, ".jsonl");
    const cwd = records.map((each) => str(each.cwd)).find(Boolean);
    if (!cwd) continue;
    const summary = records.map((each) => (each.type === "summary" ? str(each.summary) : undefined)).find(Boolean);
    const title = summary ?? said(records, "claude") ?? "New Agent Thread";
    out.push(row(agent, session, title, cwd, path));
  }
  return out;
}

// ── Codex ───────────────────────────────────────────────────────────────────────────────────

/** Codex's sessions: `~/.codex/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl`. */
async function codexSessions(agent: CatalogAgent): Promise<PastSession[]> {
  const root = process.env.CODEX_HOME ? join(process.env.CODEX_HOME, "sessions") : join(homedir(), ".codex", "sessions");
  const out: PastSession[] = [];
  for (const path of files(root, (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"))) {
    const records = await head(path);
    const meta = obj(records.find((each) => each.type === "session_meta")?.payload);
    const session = str(meta?.session_id) ?? str(meta?.id);
    const cwd = str(meta?.cwd);
    if (!session || !cwd) continue;
    const title = said(records, "codex") ?? "New Agent Thread";
    out.push(row(agent, session, title, cwd, path, str(meta?.timestamp)));
  }
  return out;
}

// ── What was said first ─────────────────────────────────────────────────────────────────────

/** The first thing the user said to `agent`, as a row's title. */
function said(records: Rec[], agent: string): string | undefined {
  for (const record of records) {
    const text = userText(record, agent);
    if (text) return titleOf(text);
  }
  return undefined;
}

/** What a record of `agent` holds of the user's, if it is their message. */
function userText(record: Rec, agent: string): string | undefined {
  if (agent === "pi") {
    if (record.type !== "message") return undefined;
    const message = obj(record.message);
    return message?.role === "user" ? blocks(message.content) : undefined;
  }
  if (agent === "claude") {
    if (record.type !== "user") return undefined;
    return blocks(obj(record.message)?.content);
  }
  if (agent === "codex") {
    const payload = obj(record.payload);
    if (record.type !== "response_item" || payload?.role !== "user") return undefined;
    return blocks(payload.content);
  }
  return undefined;
}

/** A message's content as text, whichever of the shapes it came in. */
function blocks(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  for (const block of list(content)) {
    const text = str(block.text);
    if (text) return text;
  }
  return undefined;
}

/** A prompt as a title: pumi's own preamble taken out, one line, short. */
export function titleOf(text: string): string {
  const said = text
    .replace(/<pumi-context[\s\S]*?<\/pumi-context>/g, "")
    .replace(/<pumi>[\s\S]*?<\/pumi>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (said === "") return "New Agent Thread";
  return said.length > 90 ? `${said.slice(0, 89).trimEnd()}…` : said;
}

async function markOf(agent: string): Promise<string | undefined> {
  const { agentIcon } = await import("./icons.ts");
  return agentIcon(agent);
}

/** How long ago, as the rows say it: `now`, `5m`, `2h`, `3d`, `1w`, `2mo`. */
export function ago(ms: number, now = Date.now()): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return `${Math.round(days / 30)}mo`;
}

/** The last name of a directory, which a row says where its session ran. */
export function where(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

interface Group {
  title: string;
  sessions: PastSession[];
}

/** The sessions in Today, Past Week and Older, in that order, the empty ones left out. */
export function groups(sessions: PastSession[], now = Date.now()): Group[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const week = today - 6 * 86_400_000;
  const out: Group[] = [
    { title: "Today", sessions: [] },
    { title: "Past Week", sessions: [] },
    { title: "Older", sessions: [] },
  ];
  for (const session of sessions) {
    if (session.updatedAt >= today) out[0]!.sessions.push(session);
    else if (session.updatedAt >= week) out[1]!.sessions.push(session);
    else out[2]!.sessions.push(session);
  }
  return out.filter((group) => group.sessions.length > 0);
}

/** An item of the virtualized list: a group's name, or one session of it. */
export type HistoryItem = { kind: "group"; key: string; title: string } | { kind: "session"; key: string; session: PastSession };

/** The groups as the list holds them: one flat run of items, each group's name before its rows. */
export function items(groups: Group[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const group of groups) {
    out.push({ kind: "group", key: `group:${group.title}`, title: group.title });
    for (const session of group.sessions) out.push({ kind: "session", key: `session:${session.agent}:${session.session}`, session });
  }
  return out;
}

/** What a search keeps: a title, a directory, or the agent's name that says it. */
export function matching(sessions: PastSession[], query: string): PastSession[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return sessions;
  const words = wanted.split(/\s+/);
  return sessions.filter((session) => {
    const haystack = `${session.title} ${session.cwd} ${session.name}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
