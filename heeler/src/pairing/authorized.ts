// The plugin's own `authorized_keys`, edited atomically.
//
// The file is the one the plugin's sshd reads (`AuthorizedKeysFile` in its config), not the account's
// `~/.ssh/authorized_keys`: this server is the plugin's, and its keys live and die with it. Every
// mutation takes an exclusive lock, then rewrites through a temp file and a rename, so a reader never
// sees half a line and a crashed editor leaves at worst a lock that goes stale.
//
// A Bootstrap Key's line carries a marker comment, `herdr-pairing:<id>:exp:<unix-seconds>`, so the
// sweep and the ceremonies find their lines from the file alone.
//
// PROVENANCE: Heeler `plugin/src/authorized-keys.js` @ plugin 0.6.2 (Apache-2.0), with the path and
// the lock name the plugin's own server uses.

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const BOOTSTRAP_COMMENT_PATTERN = /(?:^|\s)herdr-pairing:([A-Za-z0-9-]+):exp:(\d+)$/;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
/** A lock left by a crash is garbage after this; edits are millisecond-scale. */
const LOCK_STALE_MS = 10_000;

/** The marker a Bootstrap Key line carries. */
export interface BootstrapMarker {
  pairingId: string;
  expiresAt: number;
}

/**
 * A restricted Bootstrap Key line: `restrict,command="…"` so the key can do exactly one thing, the
 * Enrollment accept entrypoint, until the ceremony ends.
 */
export function bootstrapLine(options: { publicLine: string; pairingId: string; expiresAt: number; command: string }): string {
  const { publicLine, pairingId, expiresAt, command } = options;
  if (/["\n\r]/.test(command)) {
    throw new Error("forced command must not contain double quotes or newlines");
  }
  if (!/^[A-Za-z0-9-]+$/.test(pairingId)) {
    throw new Error("pairing id must be alphanumeric/hyphen");
  }
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) {
    throw new Error("expiresAt must be a positive unix-seconds integer");
  }
  return `restrict,command="${command}" ${publicLine} herdr-pairing:${pairingId}:exp:${expiresAt}`;
}

/** The marker of a Bootstrap Key line, or null for any other line. */
export function parseBootstrapLine(line: string): BootstrapMarker | null {
  const match = BOOTSTRAP_COMMENT_PATTERN.exec(line);
  return match === null ? null : { pairingId: match[1] as string, expiresAt: Number(match[2]) };
}

async function acquire(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for the authorized_keys lock ${lockPath}`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

/**
 * Edit `path` under an exclusive lock. `edit` gets the current lines (no trailing empty line) and
 * answers the new ones, or null to leave the file untouched.
 *
 * @returns whether the file was rewritten
 */
export async function editAuthorizedKeys(path: string, edit: (lines: string[]) => string[] | null): Promise<boolean> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  await acquire(lockPath);
  try {
    let content: string | null = null;
    try {
      content = readFileSync(path, "utf8");
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") throw err;
    }
    const lines = content === null ? [] : content.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const edited = edit([...lines]);
    if (edited === null) return false;
    const mode = content === null ? 0o600 : statSync(path).mode & 0o777;
    const temp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, edited.length === 0 ? "" : `${edited.join("\n")}\n`, { mode });
      renameSync(temp, path);
    } catch (err) {
      rmSync(temp, { force: true });
      throw err;
    }
    return true;
  } finally {
    unlinkSync(lockPath);
  }
}

/** Remove the Bootstrap Key line with this pairing id, if it is there. */
export async function removeBootstrapLine(path: string, pairingId: string): Promise<boolean> {
  return editAuthorizedKeys(path, (lines) => {
    const kept = lines.filter((line) => parseBootstrapLine(line)?.pairingId !== pairingId);
    return kept.length === lines.length ? null : kept;
  });
}

/** Remove every Bootstrap Key line whose embedded expiry has passed; live ceremonies stay. */
export async function sweepExpiredBootstrapLines(path: string, now = Math.floor(Date.now() / 1000)): Promise<number> {
  let removed = 0;
  await editAuthorizedKeys(path, (lines) => {
    const kept = lines.filter((line) => {
      const marker = parseBootstrapLine(line);
      return marker === null || marker.expiresAt > now;
    });
    removed = lines.length - kept.length;
    return removed === 0 ? null : kept;
  });
  return removed;
}

/**
 * A line's key part: its type, blob and comment, with any authorized_keys options before them
 * skipped. An options list is one comma-separated word, but its `command="…"` value may hold
 * spaces, so the split has to respect the quotes.
 */
function keyPart(line: string): string[] {
  let rest = line.trim();
  const startsWithKey = (value: string) => /^(ssh-|ecdsa-|sk-)/.test(value);
  if (!startsWithKey(rest)) {
    let quoted = false;
    let escaped = false;
    let at = 0;
    for (; at < rest.length; at += 1) {
      const char = rest[at];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\" && quoted) {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (!quoted && (char === " " || char === "\t")) break;
    }
    rest = rest.slice(at).trim();
  }
  return rest === "" ? [] : rest.split(/\s+/);
}

/** A public key line's `<type> <blob>`, the identity of the key whatever its comment or options. */
export function keyBlobOf(line: string): string {
  return keyPart(line).slice(0, 2).join(" ");
}

/** A public key line's comment, which may be empty. */
export function commentOf(line: string): string {
  return keyPart(line).slice(2).join(" ");
}

/** Remove every line whose key blob matches `line`'s: the one-key revoke of an enrolled device. */
export async function removeKeyLine(path: string, line: string): Promise<boolean> {
  const target = keyBlobOf(line);
  return editAuthorizedKeys(path, (lines) => {
    const kept = lines.filter((existing) => keyBlobOf(existing) !== target);
    return kept.length === lines.length ? null : kept;
  });
}
