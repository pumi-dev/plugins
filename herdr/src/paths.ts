// Where the two sockets are. pumi's are in the server's data directory — `$PUMI_DATA_DIR`, else the
// platform's application data directory for the app's name — and, as herdr keeps a named session,
// herdr's own session directory: `~/.config/herdr` for its default session, `sessions/<name>` for
// any other. herdr's own `herdr.sock` there is left alone, so a real herdr runs beside it.
//
// PROVENANCE: herdr `src/config/io.rs` (`config_dir`) and `src/session.rs` (`data_dir_for`,
// `DEFAULT_SESSION_NAME`, `validate_name`) @ v0.9.4 (Apache-2.0).

import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** What the environment says: the shell's, or a test's. */
export type Env = Record<string, string | undefined>;

function set(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The home directory, as the server has it: `$HOME`, else `/`. */
export function home(env: Env = process.env): string {
  return set(env, "HOME") ?? "/";
}

/**
 * The app's name, as the server keeps its directories. `$PUMI_APPNAME` says it; otherwise it is
 * read off the package's own state directory, `<app name>/plugins/<owner.name>`; otherwise `pumi`.
 */
export function appName(env: Env = process.env, stateDir?: string): string {
  const named = set(env, "PUMI_APPNAME");
  if (named) return named;
  const above = stateDir ? basename(dirname(dirname(stateDir))) : "";
  return above === "" ? "pumi" : above;
}

/**
 * The server's data directory, where its sockets are: `$PUMI_DATA_DIR` when it is set, otherwise
 * the platform's application data directory for the app's name — macOS's
 * `~/Library/Application Support` when it exists, else `$XDG_DATA_HOME` or `~/.local/share`.
 */
export function dataDir(env: Env = process.env, stateDir?: string): string {
  const given = set(env, "PUMI_DATA_DIR");
  if (given) return given;
  const library = join(home(env), "Library/Application Support");
  const base = isDir(library) ? library : (set(env, "XDG_DATA_HOME") ?? join(home(env), ".local/share"));
  return join(base, appName(env, stateDir));
}

/** herdr's config directory: `$XDG_CONFIG_HOME/herdr`, else `~/.config/herdr`. */
export function herdrConfigDir(env: Env = process.env): string {
  return join(set(env, "XDG_CONFIG_HOME") ?? join(home(env), ".config"), "herdr");
}

/**
 * Where herdr keeps the named session `name`: the config directory for herdr's own default session
 * (`default`, or `-`), `sessions/<name>` for any other — and nothing for a name herdr would not
 * take: up to 64 ASCII letters, digits, `.`, `_` and `-`.
 */
export function sessionDir(name: string, env: Env = process.env): string | undefined {
  if (name === "default" || name === "-") return herdrConfigDir(env);
  if (name.length === 0 || name.length > 64 || name === "." || name === "..") return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return undefined;
  return join(herdrConfigDir(env), "sessions", name);
}
