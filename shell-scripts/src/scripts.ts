// The shell scripts of a repository, as `script-panel` finds them: a script is a file with one of
// the extensions the options name, or (with `shell_scripts.shebang`) a file with no extension whose
// `#!` names a shell. It runs with the shell its `#!` names (through `env` and its switches), else
// its extension's, else `sh`, named to the shell rather than run as `./x`, so a script without its
// executable bit runs.
import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { option } from "pumi";
import { label, quote, type Finder, type Group, type Item } from "../../lib/script-panel/src/finder.ts";

/** The shells a `#!` line names, and the ones an extension falls back to. */
const SHELLS: readonly string[] = ["sh", "bash", "zsh", "ksh", "dash", "ash", "fish"];
/** The extensions, until the options name others. */
const DEFAULT_EXTENSIONS = "sh, bash, zsh, ksh, fish";
/** How much of a file is read for its `#!` line. */
const HEAD = 160;

/** What it lists, as its options say it. */
export interface Settings {
  /** How many directories below the repository root to look in. */
  depth: number;
  /** The extensions that make a file a script, without their dot, lowercased. */
  extensions: Set<string>;
  /** Whether a file with no extension whose `#!` names a shell is a script. */
  shebang: boolean;
  /** Whether an item shows how it runs beside its name. */
  showCommand: boolean;
}

/** `sh, .bash ,ZSH` as `{bash, sh, zsh}`: what is left of each comma-separated word. */
export function parseExtensions(text: string): Set<string> {
  const extensions = new Set<string>();
  for (const word of text.split(",")) {
    const name = word.trim().replace(/^\.+/, "").toLowerCase();
    if (name.length > 0 && /^[a-z0-9+-]+$/.test(name)) extensions.add(name);
  }
  return extensions;
}

/** The shell a `#!` line names, seen through `env` and its switches: `/usr/bin/env -S zsh -e` is `zsh`. */
export function shellOf(line: string): string | null {
  const text = line.trim();
  if (!text.startsWith("#!")) return null;
  const words = text.slice(2).split(/\s+/).filter((word) => word.length > 0);
  const first = base(words[0]);
  if (first === null) return null;
  const shell = first === "env" ? base(words.slice(1).find((word) => !word.startsWith("-"))) : first;
  return shell !== null && SHELLS.includes(shell) ? shell : null;
}

/** The last part of `word`, lowercased: `/usr/bin/env` is `env`. */
function base(word: string | undefined): string | null {
  const trimmed = (word ?? "").replace(/\/+$/, "");
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return name === "" ? null : name.toLowerCase();
}

/** The shell `path` (named `name`) runs with, if it is a script. */
export function interpreter(settings: Settings, name: string, path: string): string | null {
  const extension = extensionOf(name);
  const named = extension !== null && settings.extensions.has(extension);
  if (!named && (!settings.shebang || extension !== null)) return null;
  const line = firstLine(path);
  const shell = line === null ? null : shellOf(line);
  if (shell !== null) return shell;
  if (!named) return null;
  return shellName(extension);
}

/** The shell an extension runs a script with: its own when it is one, else `sh`. */
function shellName(extension: string | null): string {
  return extension !== null && SHELLS.includes(extension) ? extension : "sh";
}

/** The extension of the file `name`, lowercased; `null` for one without (and for a dotfile). */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

/** The `#!` line of a file, if its first line is one. */
function firstLine(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(HEAD);
    const read = readSync(fd, head, 0, HEAD, 0);
    const line = head.subarray(0, read).toString("utf8").split("\n")[0];
    return line.startsWith("#!") ? line : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** The finder of the scripts `settings` says are: each file in a directory, under its label. */
export function finder(settings: Settings): Finder {
  return {
    depth: settings.depth,
    showDetail: settings.showCommand,
    empty: "No shell scripts found",
    group(dir: string, root: string): Group | null {
      const items: Item[] = [];
      for (const name of files(dir)) {
        const shell = interpreter(settings, name, join(dir, name));
        if (shell === null) continue;
        const command = `${shell} ${quote(name)}`;
        items.push({ name, detail: command, command });
      }
      return items.length === 0 ? null : { label: label(dir, root), dir, items };
    },
  };
}

/** A pane's finder: its options read as they are now. */
export async function read(): Promise<Finder> {
  const extensions = await option.get("extensions");
  const depth = await option.get("max_depth");
  const shebang = await option.get("shebang");
  const showCommand = await option.get("show_command");
  return finder({
    depth: depthOf(depth),
    extensions: parseExtensions(typeof extensions === "string" ? extensions : DEFAULT_EXTENSIONS),
    shebang: shebang !== false,
    showCommand: showCommand !== false,
  });
}

/** The depth an option's value says: 4 when it is not a whole number of 0 or more, and 1 to 10. */
function depthOf(value: unknown): number {
  const depth = typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 4;
  return Math.min(10, Math.max(1, depth));
}

/** The names of the files in `dir`, hidden ones left out, by name. */
function files(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
