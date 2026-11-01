// The models pi's (and omp's) `/model` takes: those its settings enable, else what `--list-models` lists.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { agentPathReady, findProgram, type AgentSpec, type Choice } from "../../../src/api.ts";

/** A JSON file's object, or nothing. */
function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
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
export async function piModels(spec: AgentSpec): Promise<Choice[]> {
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

