// Heeler's Host on the machine's own SSH: the plugin runs no SSH server of its own.
//
// A normal herdr Host is reached through the account's OpenSSH (`Remote Login` on macOS) on port 22,
// as the user who runs herdr — so that is what this plugin is too. Heeler connects as that user,
// pins the host key under `/etc/ssh` (the fingerprint the Pairing Code carries), opens
// `direct-streamlocal` channels into the plugin's herdr sockets, runs `herdr agent attach` in a PTY,
// and writes its Notification Registration over SFTP. Nothing here needs root, a second sshd, or a
// second host key.
//
// What the plugin owns: the `herdr` shim (so the commands Heeler runs answer even on a machine with
// no herdr installed — when a real herdr is at `~/.local/bin/herdr`, that one is left alone), and the
// `authorized_keys` lines its pairing writes. The plugin never touches the user's other keys.

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { log } from "./log.ts";
import { readHostKeyFingerprint } from "./pairing/keys.ts";

/** The port a normal herdr Host is reached on: the account's own OpenSSH. */
export const DEFAULT_SSH_PORT = 22;

/** Where OpenSSH keeps its host keys, and the fingerprints a Pairing Code pins. */
export const SYSTEM_SSH_DIR = "/etc/ssh";

/** What the plugin knows of the machine's SSH server. */
export interface SshHost {
  /** The port advertised in the Pairing Code (the account's sshd, 22 by default). */
  port: number;
  /** The account Heeler connects as: the one running pumi. */
  user: string;
  /** The host key's OpenSSH fingerprint, from `/etc/ssh`. */
  fingerprint?: string;
  /** Something answers on 127.0.0.1:`port` (Remote Login is on). */
  running: boolean;
  /** Why it does not, when it does not. */
  error?: string;
}

/** The files the plugin owns: the shim, and the account's `authorized_keys` it edits. */
export interface HostPaths {
  root: string;
  binDir: string;
  shim: string;
  authorizedKeys: string;
}

export function hostPaths(state: string, home = process.env.HOME ?? homedir()): HostPaths {
  const binDir = join(state, "bin");
  return {
    root: state,
    binDir,
    shim: join(binDir, "herdr"),
    authorizedKeys: join(home, ".ssh", "authorized_keys"),
  };
}

/** A marker the shim carries, so a later start rewrites its own file and no other. */
const SHIM_MARK = "answered by the pumi heeler plugin";

function singleQuoted(path: string, what: string): string {
  if (/['"\n\r]/.test(path)) {
    throw new Error(`${what} must not contain quotes or newlines: ${path}`);
  }
  return `'${path}'`;
}

function shimBody(paths: HostPaths): string {
  const cli = join(import.meta.dir, "cli.ts");
  return (
    "#!/bin/sh\n" +
    `# herdr, ${SHIM_MARK}: no herdr installation is needed on this machine.\n` +
    `exec env BUN_BE_BUN=1 HEELER_STATE=${singleQuoted(paths.root, "the heeler state directory")} ` +
    `${singleQuoted(process.execPath, "the pumi executable")} ${singleQuoted(cli, "the heeler CLI")} "$@"\n`
  );
}

/** Write `<state>/bin/herdr`, the shim the Enrollment forced command names by absolute path. */
export function installShim(paths: HostPaths): string {
  mkdirSync(paths.binDir, { recursive: true });
  writeFileSync(paths.shim, shimBody(paths), { mode: 0o755 });
  chmodSync(paths.shim, 0o755);
  return paths.shim;
}

/**
 * Make sure `herdr` exists where Heeler's commands look for it (`~/.local/bin`, first on the PATH
 * its SSH commands export) — but never replace a real herdr: a file without the shim's marker is
 * left exactly as it is, and Heeler then talks to this plugin through the real CLI
 * (`HERDR_SOCKET_PATH` names the session's socket).
 */
export function installUserShim(paths: HostPaths, home = process.env.HOME ?? homedir()): string | undefined {
  const dir = join(home, ".local", "bin");
  const target = join(dir, "herdr");
  if (existsSync(target)) {
    try {
      if (!readFileSync(target, "utf8").includes(SHIM_MARK)) return target;
    } catch {
      return target;
    }
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, shimBody(paths), { mode: 0o755 });
    chmodSync(target, 0o755);
    return target;
  } catch (err) {
    log(`${target}: ${why(err)}`);
    return undefined;
  }
}

/** The forced command that runs the Enrollment accept step for a pairing id. */
export function enrollCommand(paths: HostPaths, pairingId: string): string {
  return [
    singleQuoted(paths.shim, "the herdr shim"),
    "__enroll",
    "--state-dir",
    singleQuoted(paths.root, "the heeler state directory"),
    "--pairing-id",
    pairingId,
  ].join(" ");
}

/** The host key fingerprint Heeler pins: the machine sshd presents, from `/etc/ssh`. */
export function hostKeyFingerprint(dir = SYSTEM_SSH_DIR): string | undefined {
  try {
    return readHostKeyFingerprint(dir)?.fingerprint;
  } catch {
    return undefined;
  }
}

/** Make sure `~/.ssh/authorized_keys` exists with the modes sshd's `StrictModes` requires. */
export function ensureAuthorizedKeys(path: string): void {
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const mode = statSync(dir).mode & 0o777;
    if (mode & 0o022) log(`${dir} is writable by others (${mode.toString(8)}); sshd may refuse ${path}`);
  } catch {
    // The mkdir above failed loudly enough.
  }
  if (!existsSync(path)) writeFileSync(path, "", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Not ours to change; the pairing edit will report it if sshd minds.
  }
}

/** Whether something answers on `port` at `host`. */
export async function probeSsh(port: number, host = "127.0.0.1", timeoutMs = 800): Promise<{ running: boolean; error?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer: { running: boolean; error?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(answer);
    };
    const timer = setTimeout(() => finish({ running: false, error: `nothing answers on ${host}:${port}` }), timeoutMs);
    Bun.connect<undefined>({
      hostname: host,
      port,
      socket: {
        open(socket) {
          try {
            socket.end();
          } catch {
            // It is gone already.
          }
          finish({ running: true });
        },
        data() {},
        error(_socket, err) {
          finish({ running: false, error: err.message });
        },
      },
    }).catch((err: unknown) => finish({ running: false, error: why(err) }));
  });
}

/** What the plugin's `herdr` shim reads, so it can answer without the API. */
export interface HostRecord {
  plugin: "heeler";
  version: string;
  state: string;
  data: string;
  apiSocket: string;
  clientSocket: string;
  gridSocket: string;
  session: string;
  sessionDir?: string;
  configDir: string;
  bin: string;
  ssh: SshHost;
}

export function writeRecord(paths: HostPaths, record: HostRecord): void {
  mkdirSync(paths.root, { recursive: true });
  const path = join(paths.root, "host.json");
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function readRecord(paths: HostPaths): HostRecord | null {
  try {
    return JSON.parse(readFileSync(join(paths.root, "host.json"), "utf8")) as HostRecord;
  } catch {
    return null;
  }
}

/** The account's name, as Heeler must put it in its Host form. */
export function user(): string {
  return userInfo().username;
}

function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
