// The shell half of the page: the shell scripts of a repository. A script is a file with one of the
// extensions the options name, or (with `shebang`) a file with no extension whose `#!` names a
// shell. It runs with the shell its `#!` names (through `env` and its switches), else its
// extension's, else `sh`, named to the shell rather than run as `./x`, so a script without its
// executable bit runs.
import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";

import { label, quote, type Group, type Item } from "../../lib/script-panel/src/finder.ts";

/** The shells a `#!` line names, and the ones an extension falls back to. */
const SHELLS: readonly string[] = ["sh", "bash", "zsh", "ksh", "dash", "ash", "fish"];
/** The extensions, until the options name others. */
export const DEFAULT_EXTENSIONS = "sh, bash, zsh, ksh, fish";
/** How much of a file is read for its `#!` line. */
const HEAD = 160;
/** The glyph a directory's group is headed by. */
const SHELL_ICON = "terminal";

/** What the shell half lists, as its options say it. */
export interface ShellSettings {
  /** The extensions that make a file a script, without their dot, lowercased. */
  extensions: Set<string>;
  /** Whether a file with no extension whose `#!` names a shell is a script. */
  shebang: boolean;
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
export function interpreter(settings: ShellSettings, name: string, path: string): string | null {
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

/** The groups `dir` makes from its shell scripts: none, or one, as a list. */
export function shellGroups(settings: ShellSettings, dir: string, root: string): Group[] {
  const items: Item[] = [];
  for (const name of files(dir)) {
    const shell = interpreter(settings, name, join(dir, name));
    if (shell === null) continue;
    const command = `${shell} ${quote(name)}`;
    items.push({ name, detail: command, command });
  }
  if (items.length === 0) return [];
  return [{ label: label(dir, root), dir, icon: SHELL_ICON, items }];
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
