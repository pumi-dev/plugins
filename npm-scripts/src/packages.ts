// The package's half of the scripts page: every `package.json` with scripts in the current pane's
// repository, workspaces included, each script run with the package's own manager — its
// `packageManager` field (corepack's `"pnpm@9.1.0"`), else the first lockfile from its directory up
// to the root, else npm.
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { option, pkg } from "pumi";
import { label, quote, type Finder, type Group, type Item } from "script-panel";

/** The lockfiles that say which manager a directory uses; the first found wins. */
const LOCKFILES: readonly (readonly [file: string, manager: string])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

/** How many directories below the repository root to look in without an option saying. */
const DEPTH = 4;

/** The manager of the package in `dir`, by name: what runs its scripts. */
export function manager(manifest: Record<string, unknown>, dir: string, root: string): string {
  const declared = typeof manifest.packageManager === "string" ? manifest.packageManager.split("@")[0] : "";
  if (declared !== "") return declared;
  for (let at = dir; ; ) {
    const found = LOCKFILES.find(([file]) => isFile(join(at, file)));
    if (found) return found[1];
    const up = dirname(at);
    if (at === root || up === at) break;
    at = up;
  }
  return "npm";
}

/** Whether `path` is a file. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** What `dir`'s `package.json` holds, or `null` when there is none, or it does not parse. */
function manifest(dir: string): Record<string, unknown> | null {
  try {
    const read: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return read !== null && typeof read === "object" && !Array.isArray(read) ? (read as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The scripts of the package in `dir`, under the label its `package.json` has in the repository. */
export function packageGroup(dir: string, root: string): Group | null {
  const held = manifest(dir);
  const scripts = held?.scripts;
  if (!held || scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) return null;
  const run = manager(held, dir, root);
  const items: Item[] = Object.entries(scripts as Record<string, unknown>)
    .filter(([, command]) => typeof command === "string")
    .map(([name, command]) => ({ name, detail: command as string, command: `${run} run ${quote(name)}` }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (items.length === 0) return null;
  return { label: label(join(dir, "package.json"), root), dir, items };
}

/** The page's finder, its options read now: how deep to look, in what order, and with what detail. */
export async function read(): Promise<Finder> {
  const depth = await whole("max_depth", DEPTH);
  const order = await option.get("sort");
  return {
    depth: Math.min(Math.max(depth, 1), 10),
    showDetail: (await option.get("show_command")) !== false,
    empty: "No package.json with scripts found",
    optionMatch: pkg.prefixed("*"),
    group: packageGroup,
    sort(groups: Group[]): void {
      groups.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
      // A stable sort: the packages with as many scripts stay in path order.
      if (order === "scripts") groups.sort((a, b) => b.items.length - a.items.length);
    },
  };
}

/** The whole number the option `name` holds, or `fallback` when it holds something else. */
async function whole(name: string, fallback: number): Promise<number> {
  const value = await option.get(name);
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}
