// Where pi (and omp, which writes pi's files) keeps a session: `sessions/<its directory, encoded>/<time>_<id>.jsonl`.
import { join } from "node:path";

import { list, type AgentSpec, type FormatWhere } from "../../../src/api.ts";

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

/** `spec`'s session `id` (pi's, or omp's under its own home), from the tab's directory. */
export function locatePi(spec: AgentSpec, id: string, where: FormatWhere): string | undefined {
  const own = join(where.home, spec.home);
  const root = spec.id === "pi" ? (where.env.PI_CODING_AGENT_DIR ?? own) : own;
  return piFile(id, where.cwd, where.env.PI_CODING_AGENT_SESSION_DIR ?? join(root, "sessions"));
}
