// The page's finder: both halves at once. A directory can hold a `package.json`'s scripts and its
// own shell scripts, so a walk of the repository asks both what a directory makes, and the page
// lists them together — the package's group, then the directory's, each with the glyph of what it
// holds. The options say which kinds are listed at all (all of them, until one is turned off).
import { option } from "pumi";

import type { Finder, Group } from "../../lib/script-panel/src/finder.ts";

import { DEFAULT_EXTENSIONS, parseExtensions, shellGroups, type ShellSettings } from "./shells.ts";
import { packageGroups } from "./packages.ts";

/** What the page lists, as its options say it. */
export interface Settings extends ShellSettings {
  /** Whether every `package.json`'s scripts are listed. */
  packages: boolean;
  /** Whether the shell scripts are. */
  shells: boolean;
  /** How many directories below the repository root to look in. */
  depth: number;
  /** Whether an item shows what it runs beside its name. */
  showCommand: boolean;
  /** The order the groups are listed in: by label, or the longest first. */
  sort: "path" | "scripts";
}

/** The options' defaults, with `over` on top: what a test reads them as, and what the page shows
 * before the app says otherwise. */
export function defaults(over: Partial<Settings> = {}): Settings {
  return {
    packages: true,
    shells: true,
    depth: 4,
    showCommand: true,
    sort: "path",
    extensions: parseExtensions(DEFAULT_EXTENSIONS),
    shebang: true,
    ...over,
  };
}

/** The page's finder for `settings`: a directory's package scripts and shell scripts, in the order
 * the settings say, saying what it says when it finds nothing. */
export function finder(settings: Settings): Finder {
  return {
    depth: settings.depth,
    showDetail: settings.showCommand,
    empty: nothingToShow(settings),
    groups(dir: string, root: string): Group[] {
      const groups: Group[] = [];
      if (settings.packages) groups.push(...packageGroups(dir, root));
      if (settings.shells) groups.push(...shellGroups(settings, dir, root));
      return groups;
    },
    sort(groups: Group[]): void {
      order(groups, settings.sort);
    },
  };
}

/** What the page says when nothing was found: which kinds it looked for. */
export function nothingToShow(settings: Pick<Settings, "packages" | "shells">): string {
  if (settings.packages && settings.shells) return "No scripts found";
  if (settings.shells) return "No shell scripts found";
  if (settings.packages) return "No package.json with scripts found";
  return "Both kinds are off: turn Package scripts or Shell scripts on in Settings";
}

/** Orders the page's groups: by label, or the ones with most scripts first. */
export function order(groups: Group[], by: "path" | "scripts"): void {
  groups.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  // A stable sort: the groups with as many scripts stay in label order.
  if (by === "scripts") groups.sort((a, b) => b.items.length - a.items.length);
}

/** The finder of the page as the options hold them now. */
export async function read(): Promise<Finder> {
  const [packages, shells, depth, showCommand, sort, extensions, shebang] = await Promise.all([
    option.get("npm_scripts"),
    option.get("shell_scripts"),
    option.get("max_depth"),
    option.get("show_command"),
    option.get("sort"),
    option.get("extensions"),
    option.get("shebang"),
  ]);
  return finder({
    packages: packages !== false,
    shells: shells !== false,
    depth: depthOf(depth),
    showCommand: showCommand !== false,
    sort: sort === "scripts" ? "scripts" : "path",
    extensions: parseExtensions(typeof extensions === "string" ? extensions : DEFAULT_EXTENSIONS),
    shebang: shebang !== false,
  });
}

/** The depth an option's value says: 4 when it is not a whole number, and 1 to 10. */
function depthOf(value: unknown): number {
  const depth = typeof value === "number" && Number.isInteger(value) ? value : 4;
  return Math.min(10, Math.max(1, depth));
}
