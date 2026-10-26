// One pairing ceremony: the Bootstrap Key, its restricted line, and the pending/enrolled records the
// popup reads.
//
// A ceremony lasts two minutes: `beginPairing` mints a key and records it, `acceptEnrollment` (run by
// the forced command when the app connects) appends the Device Key and self-revokes the Bootstrap
// Key, and `endPairing` cleans up whatever is left. The enrolled record is what lets the QR screen
// show the device's fingerprint and offer the one-key revoke — Heeler's compensating control for a
// private key that rode in a QR code.
//
// PROVENANCE: Heeler `plugin/src/{pairing-session,pair-accept}.js` @ plugin 0.6.2 (Apache-2.0).

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapLine, editAuthorizedKeys, keyBlobOf, parseBootstrapLine } from "./authorized.ts";
import { generateBootstrapKey, parseDeviceKeyLine } from "./keys.ts";

/** How long a Bootstrap Key lives. */
export const PAIRING_TTL_SECONDS = 120;

/** How far past its ceremony an enrolled record lives on disk before the sweep calls it orphaned. */
const STATE_SWEEP_GRACE_SECONDS = PAIRING_TTL_SECONDS;

/** A completed Enrollment, as the popup reads it. */
export interface EnrollmentRecord {
  pairingId: string;
  expiresAt: number;
  /** The Device Key's `SHA256:` fingerprint. */
  fingerprint: string;
  /** The Device Key's canonical authorized_keys line, the revoke target. */
  line: string;
}

export function pendingPath(stateDir: string, pairingId: string): string {
  return join(stateDir, "pending", `${pairingId}.json`);
}

export function enrolledPath(stateDir: string, pairingId: string): string {
  return join(stateDir, "enrolled", `${pairingId}.json`);
}

/** Write a completed Enrollment: the fingerprint to show and the line to revoke. */
export function recordEnrollment(stateDir: string, record: EnrollmentRecord): void {
  mkdirSync(join(stateDir, "enrolled"), { recursive: true, mode: 0o700 });
  writeFileSync(enrolledPath(stateDir, record.pairingId), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/** Read a completed Enrollment, or null while there is none. */
export function readEnrollment(stateDir: string, pairingId: string): EnrollmentRecord | null {
  try {
    return JSON.parse(readFileSync(enrolledPath(stateDir, pairingId), "utf8")) as EnrollmentRecord;
  } catch {
    return null;
  }
}

/**
 * Start a ceremony: mint a Bootstrap Key, write its restricted line, and record it as pending.
 *
 * `command` builds the forced command for the pairing id (the plugin's CLI, `__enroll`).
 */
export async function beginPairing(options: {
  authorizedKeysPath: string;
  stateDir: string;
  command: (pairingId: string) => string;
  now?: number;
  ttlSeconds?: number;
}): Promise<{ pairingId: string; seed: Buffer; expiresAt: number; publicLine: string }> {
  const { authorizedKeysPath, stateDir, command } = options;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? PAIRING_TTL_SECONDS;
  const pairingId = randomBytes(6).toString("hex");
  const expiresAt = now + ttl;
  const { seed, publicLine } = generateBootstrapKey();
  const line = bootstrapLine({ publicLine, pairingId, expiresAt, command: command(pairingId) });
  mkdirSync(join(stateDir, "pending"), { recursive: true, mode: 0o700 });
  writeFileSync(pendingPath(stateDir, pairingId), `${JSON.stringify({ pairingId, expiresAt, publicLine })}\n`, { mode: 0o600 });
  try {
    await editAuthorizedKeys(authorizedKeysPath, (lines) => [...lines, line]);
  } catch (err) {
    rmSync(pendingPath(stateDir, pairingId), { force: true });
    throw err;
  }
  return { pairingId, seed, expiresAt, publicLine };
}

/**
 * Close a ceremony at its TTL. The enrolled-record check runs under the authorized_keys lock, the
 * same lock `acceptEnrollment` commits under, so either the Enrollment is honored or the cleanup
 * wins — never both, and never a silent enroll.
 */
export async function expirePairing(options: {
  authorizedKeysPath: string;
  stateDir: string;
  pairingId: string;
}): Promise<EnrollmentRecord | null> {
  const { authorizedKeysPath, stateDir, pairingId } = options;
  let record: EnrollmentRecord | null = null;
  await editAuthorizedKeys(authorizedKeysPath, (lines) => {
    record = readEnrollment(stateDir, pairingId);
    if (record !== null) return null;
    rmSync(pendingPath(stateDir, pairingId), { force: true });
    const kept = lines.filter((line) => parseBootstrapLine(line)?.pairingId !== pairingId);
    return kept.length === lines.length ? null : kept;
  });
  return record;
}

/** End a ceremony: its line, pending state and enrollment record all go. Idempotent. */
export async function endPairing(options: { authorizedKeysPath: string; stateDir: string; pairingId: string }): Promise<void> {
  const { authorizedKeysPath, stateDir, pairingId } = options;
  await editAuthorizedKeys(authorizedKeysPath, (lines) => {
    const kept = lines.filter((line) => parseBootstrapLine(line)?.pairingId !== pairingId);
    return kept.length === lines.length ? null : kept;
  });
  rmSync(pendingPath(stateDir, pairingId), { force: true });
  rmSync(enrolledPath(stateDir, pairingId), { force: true });
}

/** The outcome of an Enrollment submission, as the one-line protocol says it. */
export type AcceptResult =
  | { ok: true; fingerprint: string }
  | { ok: false; code: "unknown_pairing" | "expired" | "invalid_key" | "no_input"; detail: string };

/**
 * The Enrollment accept step: what the forced command runs when the app connects with the Bootstrap
 * Key. `submission` is the Device Key public line the app wrote to stdin.
 */
export async function acceptEnrollment(options: {
  authorizedKeysPath: string;
  stateDir: string;
  pairingId: string;
  submission: string | null;
  now?: number;
}): Promise<AcceptResult> {
  const { authorizedKeysPath, stateDir, pairingId, submission } = options;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  let pending: { expiresAt: number } | null = null;
  try {
    pending = JSON.parse(readFileSync(pendingPath(stateDir, pairingId), "utf8")) as { expiresAt: number };
  } catch {
    await endPairing({ authorizedKeysPath, stateDir, pairingId });
    return { ok: false, code: "unknown_pairing", detail: `no pending pairing ${pairingId}` };
  }
  if (now > pending.expiresAt) {
    await endPairing({ authorizedKeysPath, stateDir, pairingId });
    return { ok: false, code: "expired", detail: `pairing ${pairingId} expired; regenerate the Pairing Code` };
  }
  if (submission === null || submission.trim().length === 0) {
    return { ok: false, code: "no_input", detail: "expected a Device Key public line on stdin" };
  }
  let deviceKey: { line: string; fingerprint: string };
  try {
    deviceKey = parseDeviceKeyLine(submission);
  } catch (err) {
    if (err instanceof Error && err.name === "DeviceKeyError") {
      return { ok: false, code: "invalid_key", detail: `rejected Device Key line: ${err.message}` };
    }
    throw err;
  }
  let alreadyUsed = false;
  let expired = false;
  await editAuthorizedKeys(authorizedKeysPath, (lines) => {
    if (!existsSync(pendingPath(stateDir, pairingId))) {
      alreadyUsed = true;
      return null;
    }
    const kept = lines.filter((line) => parseBootstrapLine(line)?.pairingId !== pairingId);
    rmSync(pendingPath(stateDir, pairingId), { force: true });
    // Re-check the TTL inside the lock: the stdin read may have taken seconds.
    if (now > (pending as { expiresAt: number }).expiresAt) {
      expired = true;
      return kept;
    }
    const blob = keyBlobOf(deviceKey.line);
    if (!kept.some((line) => keyBlobOf(line) === blob)) {
      kept.push(deviceKey.line);
    }
    recordEnrollment(stateDir, {
      pairingId,
      expiresAt: (pending as { expiresAt: number }).expiresAt,
      fingerprint: deviceKey.fingerprint,
      line: deviceKey.line,
    });
    return kept;
  });
  if (alreadyUsed) {
    return { ok: false, code: "unknown_pairing", detail: `pairing ${pairingId} was already used` };
  }
  if (expired) {
    return { ok: false, code: "expired", detail: `pairing ${pairingId} expired; regenerate the Pairing Code` };
  }
  return { ok: true, fingerprint: deviceKey.fingerprint };
}

/** The one line the app reads from the forced command. */
export function acceptLine(result: AcceptResult): string {
  return result.ok ? `HERDR-ENROLL:OK:${result.fingerprint}` : `HERDR-ENROLL:ERR:${result.code}`;
}

// ---- stale state, so a SIGKILLed ceremony leaves nothing behind

/** Remove pending records past their expiry, and enrolled records a grace period past theirs. */
export function sweepExpiredStateFiles(stateDir: string, now = Math.floor(Date.now() / 1000)): number {
  return (
    sweepDir(join(stateDir, "pending"), now, (record) => (record as { expiresAt?: number }).expiresAt) +
    sweepDir(
      join(stateDir, "enrolled"),
      now,
      (record) => ((record as { expiresAt?: number }).expiresAt ?? 0) + STATE_SWEEP_GRACE_SECONDS,
    )
  );
}

function sweepDir(dir: string, now: number, keepUntil: (record: unknown) => number | undefined): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return 0;
    throw err;
  }
  let removed = 0;
  for (const name of names) {
    const path = join(dir, name);
    if (keepUntilOf(path, keepUntil) <= now) {
      rmSync(path, { force: true });
      removed += 1;
    }
  }
  return removed;
}

function keepUntilOf(path: string, keepUntil: (record: unknown) => number | undefined): number {
  try {
    const value = keepUntil(JSON.parse(readFileSync(path, "utf8")));
    if (Number.isFinite(value)) return value as number;
  } catch {
    // Unreadable or malformed: age it out by mtime instead.
  }
  try {
    return Math.floor(statSync(path).mtimeMs / 1000) + PAIRING_TTL_SECONDS + STATE_SWEEP_GRACE_SECONDS;
  } catch {
    return Infinity;
  }
}
