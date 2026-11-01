// The plugin's sub-plugins, loaded: each one's agents, formats and engines into the registry
// (`registry.ts`). pumi lists them (`registry.list("plugin", {parent})`), the ones the plugin ships
// in `agents/` and any installed, and says when one changes (`registry.changed` with `parent`).
// On a pumi from before sub-plugins, the ones in `agents/` are read from disk. The window loads
// their data alone; the worker imports their code too (`main`), whose `formats` export is the
// formats it reads. No `import … from "pumi"` here: each half gives its own `list`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

import { setRegistry, type AgentDef, type EngineDef, type FormatDef, type Registry, SUB_API } from "./registry.ts";

/** A sub-plugin, as `registry.list("plugin", {parent})` describes it. */
export interface SubEntry {
  id: string;
  path: string;
  /** package.json's `main`: the module whose exports are its code. */
  main?: string | null;
  /** package.json's `pumi`. */
  manifest?: Record<string, unknown> | null;
  active: boolean;
  bundled?: boolean;
  error?: string | null;
}

/** The directory the plugin ships its sub-plugins in (`subPlugins.bundled`). */
export const BUNDLED = "agents";

/** The sub-plugins in `dir/agents`, as pumi would list them: for a pumi that does not. */
export function readBundled(dir: string): SubEntry[] {
  const root = join(dir, BUNDLED);
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return [];
  }
  const out: SubEntry[] = [];
  for (const name of names) {
    const path = join(root, name);
    if (!existsSync(join(path, "package.json"))) continue;
    try {
      const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      const pumi = pkg?.pumi;
      const id = `${pumi?.owner ?? "pumi_dev"}/${pumi?.name ?? name}`;
      out.push({ id, path, main: typeof pkg.main === "string" ? pkg.main : null, manifest: pumi ?? null, active: true, bundled: true });
    } catch (err) {
      out.push({ id: name, path, active: false, bundled: true, error: (err as Error).message });
    }
  }
  return out;
}

/** The sub-plugins of `parent`: as pumi lists them, else (a pumi without them) those in `dir`. */
export async function listSubPlugins(list: () => Promise<unknown>, dir: string): Promise<SubEntry[]> {
  try {
    const listed = await list();
    if (Array.isArray(listed)) return listed as SubEntry[];
  } catch {
    // A pumi from before sub-plugins refuses `parent`.
  }
  return readBundled(dir);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWords = (value: unknown): value is string[] => Array.isArray(value) && value.every((word) => typeof word === "string");
const ID = /^[a-z0-9][a-z0-9_-]*$/;

/** `file`, a path in the sub-plugin at `dir`, as an absolute path; none for one that leaves it. */
function within(dir: string, file: unknown): string | undefined {
  if (typeof file !== "string" || file === "" || isAbsolute(file)) return undefined;
  const path = normalize(resolve(dir, file));
  return path.startsWith(normalize(dir) + sep) ? path : undefined;
}

/** The agents a sub-plugin's manifest gives, its files made absolute; what is wrong with one, in `errors`. */
export function agentsOf(sub: SubEntry, errors: string[]): AgentDef[] {
  const given = sub.manifest?.agents;
  if (given === undefined) return [];
  if (!Array.isArray(given)) {
    errors.push(`${sub.id}: \`agents\` is a list`);
    return [];
  }
  const out: AgentDef[] = [];
  for (const each of given) {
    if (!isObject(each) || typeof each.id !== "string" || !ID.test(each.id) || typeof each.title !== "string" || typeof each.program !== "string") {
      errors.push(`${sub.id}: an agent needs an \`id\` (lowercase), a \`title\` and a \`program\``);
      continue;
    }
    const def = { ...each, from: sub.id } as unknown as AgentDef;
    if (each.icon !== undefined) def.icon = within(sub.path, each.icon);
    if (def.resume !== undefined && !isWords(def.resume)) delete def.resume;
    const hook = def.hook;
    if (hook) {
      const shape = hook.shape as { kind?: unknown; file?: unknown; template?: unknown } | undefined;
      if (!shape || !["hooks", "cursor", "file"].includes(String(shape.kind)) || typeof shape.file !== "string") {
        errors.push(`${sub.id}: ${def.id}'s hook has no \`shape\` the plugin knows (hooks, cursor, file)`);
        delete def.hook;
      } else if (shape.kind === "file") {
        const template = within(sub.path, shape.template);
        if (template) def.hook = { ...hook, shape: { kind: "file", file: shape.file, template } };
        else {
          errors.push(`${sub.id}: ${def.id}'s hook has no \`template\` in the sub-plugin`);
          delete def.hook;
        }
      }
    }
    out.push(def);
  }
  return out;
}

/** The engines a sub-plugin's manifest gives, by id, their modules made absolute. */
export function enginesOf(sub: SubEntry, errors: string[]): EngineDef[] {
  const given = sub.manifest?.engines;
  if (given === undefined) return [];
  if (!isObject(given)) {
    errors.push(`${sub.id}: \`engines\` is an object, by id`);
    return [];
  }
  const out: EngineDef[] = [];
  for (const [id, each] of Object.entries(given)) {
    const module = isObject(each) ? within(sub.path, each.module) : undefined;
    if (!ID.test(id) || id === "acp" || !isObject(each) || !module) {
      errors.push(`${sub.id}: engine \`${id}\` needs a \`module\` in the sub-plugin (and \`acp\` is the plugin's own)`);
      continue;
    }
    out.push({
      id,
      module,
      ...(isWords(each.run) ? { run: each.run } : {}),
      ...(isWords(each.session) ? { session: each.session } : {}),
      ...(each.process === false ? { process: false } : {}),
      from: sub.id,
    });
  }
  return out;
}

/** The formats a sub-plugin says its code reads. */
function formatIds(sub: SubEntry): string[] {
  const given = sub.manifest?.formats;
  return isWords(given) ? given : [];
}

/** Each load imports the modules again: a sub-plugin refreshed (`pumi plugin dev`) runs as it is now. */
let loads = 0;

/** What a loaded sub-plugin's module gives: its `formats`, by id. */
async function importFormats(sub: SubEntry, ids: string[], errors: string[]): Promise<Map<string, FormatDef>> {
  const out = new Map<string, FormatDef>();
  const main = within(sub.path, sub.main);
  if (!main) {
    if (ids.length) errors.push(`${sub.id}: it says it reads ${ids.join(", ")}, and has no \`main\``);
    return out;
  }
  try {
    const module = (await import(`${main}?v=${loads}`)) as { formats?: Record<string, FormatDef> };
    for (const id of ids) {
      const format = module.formats?.[id];
      if (format && typeof format.parser === "function" && typeof format.locate === "function") out.set(id, format);
      else errors.push(`${sub.id}: its \`formats\` export has no ${id} (a \`parser\` and a \`locate\`)`);
    }
  } catch (err) {
    errors.push(`${sub.id}: ${main}: ${(err as Error).message}`);
  }
  return out;
}

/**
 * The registry the active sub-plugins in `subs` make, in their order: an id an earlier one has is
 * left out, with an error. With `code`, each one's module is imported for its formats (the worker);
 * without, a format is known by name alone (the window).
 */
export async function registryOf(subs: SubEntry[], code: boolean): Promise<{ registry: Registry; errors: string[] }> {
  const errors: string[] = [];
  const registry: Registry = { agents: [], formats: new Map(), engines: new Map() };
  loads++;
  for (const sub of subs) {
    if (!sub.active) continue;
    const api = sub.manifest?.parentApi;
    if (typeof api === "number" && api > SUB_API) {
      errors.push(`${sub.id}: it is written for the agents' sub-plugin API ${api}; this plugin has ${SUB_API}`);
      continue;
    }
    for (const agent of agentsOf(sub, errors)) {
      const had = registry.agents.find((each) => each.id === agent.id);
      if (had) errors.push(`${sub.id}: agent \`${agent.id}\` is ${had.from}'s already`);
      else registry.agents.push(agent);
    }
    for (const engine of enginesOf(sub, errors)) {
      const had = registry.engines.get(engine.id);
      if (had) errors.push(`${sub.id}: engine \`${engine.id}\` is ${had.from}'s already`);
      else registry.engines.set(engine.id, engine);
    }
    const ids = formatIds(sub).filter((id) => {
      if (!registry.formats.has(id)) return true;
      errors.push(`${sub.id}: format \`${id}\` is read by another sub-plugin already`);
      return false;
    });
    if (!code) {
      for (const id of ids) registry.formats.set(id, null);
      continue;
    }
    for (const [id, format] of await importFormats(sub, ids, errors)) registry.formats.set(id, format);
  }
  return { registry, errors };
}

/** Lists the sub-plugins and fills the registry from them; answers what was wrong. */
export async function loadSubPlugins(list: () => Promise<unknown>, dir: string, code: boolean): Promise<string[]> {
  const subs = await listSubPlugins(list, dir);
  const { registry, errors } = await registryOf(subs, code);
  setRegistry(registry);
  return errors;
}
