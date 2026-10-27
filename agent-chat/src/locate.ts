// Where an agent keeps the session a tab is in: `@agent.transcript` when its hook said, else
// worked out from `@agent.session` and the tab's directory, as each agent lays its files out.
// Reads directories (node:fs) but no `import … from "pumi"`.
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Format } from "./agents.ts";

export interface Where {
  /** `@agent.transcript`: the session file's absolute path, when the hook gave it. */
  transcript?: string;
  /** `@agent.session`: the session's id (pi's may be its file's path). */
  session?: string;
  /** The tab's directory. */
  cwd?: string;
  /** `os.homedir()` and the environment, for a test to put elsewhere. */
  home?: string;
  env?: Record<string, string | undefined>;
}

/** The session file, or `undefined` while it is not there (an agent writes it with its first prompt). */
export function locate(format: Format, agent: string, where: Where): string | undefined {
  if (where.transcript?.startsWith("/") && isFile(where.transcript)) return where.transcript;
  const home = where.home ?? homedir();
  const env = where.env ?? process.env;
  const session = where.session ?? "";
  if (session.startsWith("/") && session.endsWith(".jsonl")) return isFile(session) ? session : undefined;
  if (session === "") return undefined;
  switch (format) {
    case "claude":
      return claudeFile(session, where.cwd, env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"));
    case "codex":
      return codexFile(session, env.CODEX_HOME ?? join(home, ".codex"));
    case "pi": {
      const root = agent === "omp" ? join(home, ".omp", "agent") : (env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent"));
      return piFile(session, where.cwd, env.PI_CODING_AGENT_SESSION_DIR ?? join(root, "sessions"));
    }
  }
}

// ── Claude ──────────────────────────────────────────────────────────────────────────────────

const PROJECT_DIR_CAP = 200;

/**
 * Claude Code's folder for a project under `projects/`: the directory with every character but a
 * letter or a digit made `-`, cut at 200 with a hash of the whole after (the Claude Agent SDK's
 * own encoding, as Paseo ports it: providers/claude/project-dir.ts).
 */
export function claudeProjectName(cwd: string): string {
  const replaced = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  if (replaced.length <= PROJECT_DIR_CAP) return replaced;
  let hash = 0;
  for (let i = 0; i < cwd.length; i++) hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0;
  return `${replaced.slice(0, PROJECT_DIR_CAP)}-${Math.abs(hash).toString(36)}`;
}

/** `projects/<encoded cwd>/<id>.jsonl`, else the first project folder that has `<id>.jsonl` (a resumed session stays where it began). */
function claudeFile(id: string, cwd: string | undefined, config: string): string | undefined {
  const projects = join(config, "projects");
  const name = `${id}.jsonl`;
  if (cwd) {
    for (const dir of new Set([canonical(cwd), cwd])) {
      const file = join(projects, claudeProjectName(dir), name);
      if (isFile(file)) return file;
    }
  }
  for (const dir of list(projects)) {
    const file = join(projects, dir, name);
    if (isFile(file)) return file;
  }
  return undefined;
}

// ── Codex ───────────────────────────────────────────────────────────────────────────────────

/** `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, newest day first. */
function codexFile(id: string, codexHome: string): string | undefined {
  const sessions = join(codexHome, "sessions");
  const newest = (dir: string) => list(dir).sort().reverse();
  for (const year of newest(sessions)) {
    for (const month of newest(join(sessions, year))) {
      for (const day of newest(join(sessions, year, month))) {
        const dir = join(sessions, year, month, day);
        const file = list(dir).find((name) => name.startsWith("rollout-") && name.endsWith(`${id}.jsonl`));
        if (file) return join(dir, file);
      }
    }
  }
  return undefined;
}

// ── pi ──────────────────────────────────────────────────────────────────────────────────────

/** pi's folder for a directory under `sessions/`: `/Users/me/src` is `--Users-me-src--`. */
export function piProjectName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** `sessions/<encoded cwd>/<time>_<id>.jsonl`, else any folder's. */
function piFile(id: string, cwd: string | undefined, sessions: string): string | undefined {
  const named = (dir: string) => {
    const file = list(dir).find((name) => name.endsWith(`_${id}.jsonl`));
    return file ? join(dir, file) : undefined;
  };
  if (cwd) {
    const found = named(join(sessions, piProjectName(cwd)));
    if (found) return found;
  }
  for (const dir of list(sessions)) {
    const found = named(join(sessions, dir));
    if (found) return found;
  }
  return undefined;
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function canonical(path: string): string {
  try {
    const real = existsSync(path) ? realpathSync.native(path) : path;
    return process.platform === "darwin" ? real.normalize("NFC") : real;
  } catch {
    return path;
  }
}
