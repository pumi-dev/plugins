// Where an agent keeps the session a tab is in: the trait's `transcript` when its hook said, else
// worked out from its `session` and the tab's directory by the format its sub-plugin reads
// (`registry.ts` `FormatDef.locate`), as each agent lays its files out. Reads directories
// (node:fs) but no `import … from "pumi"`.
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";

import type { AgentSpec } from "./agents.ts";
import { formatOf } from "./registry.ts";

export interface Where {
  /** The trait's `transcript`: the session file's absolute path, when the hook gave it. */
  transcript?: string;
  /** The trait's `session`: the session's id (pi's may be its file's path). */
  session?: string;
  /** The tab's directory. */
  cwd?: string;
  /** `os.homedir()` and the environment, for a test to put elsewhere. */
  home?: string;
  env?: Record<string, string | undefined>;
}

/** The session file, or `undefined` while it is not there (an agent writes it with its first prompt). */
export function locate(spec: AgentSpec, where: Where): string | undefined {
  if (where.transcript?.startsWith("/") && isFile(where.transcript)) return where.transcript;
  const session = where.session ?? "";
  if (session.startsWith("/") && session.endsWith(".jsonl")) return isFile(session) ? session : undefined;
  if (session === "") return undefined;
  return formatOf(spec.format)?.locate(spec, session, { cwd: where.cwd, home: where.home ?? homedir(), env: where.env ?? process.env });
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────

export function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function canonical(path: string): string {
  try {
    const real = existsSync(path) ? realpathSync.native(path) : path;
    return process.platform === "darwin" ? real.normalize("NFC") : real;
  } catch {
    return path;
  }
}
