// Where Codex keeps a session: `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl` under its home.
import { join } from "node:path";

import { list, type FormatWhere } from "../../../src/api.ts";

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

/** Codex's session `id`. */
export function locateCodex(id: string, where: FormatWhere): string | undefined {
  return codexFile(id, where.env.CODEX_HOME ?? join(where.home, ".codex"));
}
