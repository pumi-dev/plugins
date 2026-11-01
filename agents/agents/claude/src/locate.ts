// Where Claude Code keeps a session: `projects/<its directory, encoded>/<id>.jsonl` under its config.
import { join } from "node:path";

import { canonical, isFile, list, type FormatWhere } from "../../../src/api.ts";

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

/** Claude Code's session `id`, from the tab's directory. */
export function locateClaude(id: string, where: FormatWhere): string | undefined {
  return claudeFile(id, where.cwd, where.env.CLAUDE_CONFIG_DIR ?? join(where.home, ".claude"));
}
