// The models Claude Code's `/model` takes: its aliases, and the models its settings and environment name.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Choice } from "../../../src/api.ts";

/** Claude Code's model aliases, which `/model` takes besides full model names. */
const CLAUDE_ALIASES: Choice[] = [
  { id: "default", name: "Default", description: "The model your account uses by default" },
  { id: "opus", name: "Opus", description: "The latest Opus" },
  { id: "sonnet", name: "Sonnet", description: "The latest Sonnet" },
  { id: "haiku", name: "Haiku", description: "The latest Haiku" },
  { id: "opusplan", name: "Opus Plan", description: "Opus in plan mode, Sonnet otherwise" },
];

/** A JSON file's object, or nothing. */
function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

/** Claude's choices: its aliases, and the models its settings and environment name. */
export function claudeModels(cwd: string | undefined, env: Record<string, string | undefined>): Choice[] {
  const named = new Set<string>();
  for (const path of [join(homedir(), ".claude", "settings.json"), ...(cwd ? [join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json")] : [])]) {
    const settings = readJson(path);
    const model = str(settings?.model);
    if (model) named.add(model);
    const said = settings?.env as Record<string, unknown> | undefined;
    for (const name of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"]) {
      const each = str(said?.[name]);
      if (each) named.add(each);
    }
  }
  for (const name of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"]) {
    const each = str(env[name]);
    if (each) named.add(each);
  }
  const aliases = new Set(CLAUDE_ALIASES.map((each) => each.id));
  return [...CLAUDE_ALIASES, ...[...named].filter((id) => !aliases.has(id)).map((id) => ({ id, name: id, group: "Configured" }))];
}

