// The models the chat's model picker offers, per agent, and how a pick goes in. Claude Code and pi
// take `/model <name>` typed into their prompt and switch at once; Codex's `/model` is a picker of
// its own, so the chat opens it in its terminal. No `import … from "pumi"` here.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Choice, ConfigOption } from "./conversation/model.ts";
import type { AgentSpec } from "./agents.ts";
import { agentPathReady, findProgram } from "./session/launch.ts";

/** The choice that opens the agent's own picker in its terminal. */
export const PICK_IN_TERMINAL = "pumi:terminal";

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
function claudeModels(cwd: string | undefined, env: Record<string, string | undefined>): Choice[] {
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

/**
 * pi's `--list-models` table as choices (`provider/model`, by provider). With `enabledModels` in its
 * settings, only those: pi's `/model` matches no other then.
 */
export function parsePiModels(table: string, enabled: string[] = []): Choice[] {
  const choices: Choice[] = [];
  for (const line of table.split("\n").slice(1)) {
    const [provider, model] = line.trim().split(/\s+/);
    if (!provider || !model) continue;
    const id = `${provider}/${model}`;
    if (enabled.length > 0 && !enabled.some((each) => each === model || each === id)) continue;
    choices.push({ id, name: model, group: provider });
  }
  return choices;
}

/** The agent's program: on the PATH, else where its installers put it (a worker's PATH can be short). */
function programOf(spec: AgentSpec, path: string): string | undefined {
  const home = homedir();
  const found = findProgram(spec.id, path);
  if (found) return found;
  for (const dir of [join(home, ".local", "bin"), join(home, spec.home, "bin"), join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]) {
    const path = join(dir, spec.id);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/**
 * pi's models (or omp's). With `enabledModels` in its settings, those: its `/model` matches no
 * other then, and takes them as they are written. Else what its `--list-models` lists.
 */
async function piModels(spec: AgentSpec): Promise<Choice[]> {
  const settings = readJson(join(homedir(), spec.home, "settings.json"));
  const enabled = Array.isArray(settings?.enabledModels) ? (settings.enabledModels as unknown[]).filter((each): each is string => typeof each === "string" && each.trim() !== "") : [];
  if (enabled.length > 0) return enabled.map((id) => ({ id, name: id }));
  const path = await agentPathReady();
  const program = programOf(spec, path);
  if (!program) return [];
  // On the login shell's PATH: pi runs on a `node` an app opened from the Dock does not see.
  const run = Bun.spawn([program, "--list-models"], { stdout: "pipe", stderr: "ignore", stdin: "ignore", cwd: homedir(), env: { ...process.env, PATH: path } });
  const timer = setTimeout(() => run.kill(), 15_000);
  try {
    const out = await new Response(run.stdout).text();
    await run.exited;
    return parsePiModels(out);
  } finally {
    clearTimeout(timer);
  }
}

/** The models `spec`'s agent can be switched to from the chat; none for one that picks in its terminal. */
export async function modelsFor(spec: AgentSpec, cwd: string | undefined, env: Record<string, string | undefined> = process.env): Promise<Choice[]> {
  switch (spec.format) {
    case "claude":
      return claudeModels(cwd, env);
    case "pi":
      return piModels(spec).catch(() => []);
    case "codex":
      return [];
  }
}

/**
 * The model picker, as the conversation's option: the models it offers, the current one first
 * among them when it is not one of them, and for an agent that picks in its own terminal (or with
 * none found), the choice that opens that.
 */
export function modelOption(current: string | undefined, choices: Choice[], label: string): ConfigOption {
  // A model is named with its provider or without (`kiro/claude-x`, `claude-x`): either names it.
  const names = (id: string) => current !== undefined && (id === current || id.endsWith(`/${current}`) || current.endsWith(`/${id}`));
  const found = choices.find((each) => each.id === current) ?? choices.find((each) => names(each.id));
  const listed = current === undefined || found ? choices : [{ id: current, name: current, group: "Now" }, ...choices];
  const now = found?.id;
  return {
    id: "model",
    category: "model",
    name: "Model",
    current: now ?? current ?? PICK_IN_TERMINAL,
    choices: [...listed, { id: PICK_IN_TERMINAL, name: `More in ${label}…`, description: "Its own model picker, in its terminal", group: " " }],
  };
}

/** What is typed to switch to `model`. */
export function modelCommand(model: string): string {
  return `/model ${model}`;
}
