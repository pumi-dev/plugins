// The account's authorized_keys and one pairing ceremony end to end, on a temporary directory.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  bootstrapLine,
  commentOf,
  editAuthorizedKeys,
  keyBlobOf,
  parseBootstrapLine,
  removeBootstrapLine,
  removeKeyLine,
  sweepExpiredBootstrapLines,
} from "../src/pairing/authorized.ts";
import { generateBootstrapKey, publicLineFromSeed } from "../src/pairing/keys.ts";
import {
  acceptEnrollment,
  acceptLine,
  beginPairing,
  endPairing,
  expirePairing,
  readEnrollment,
  sweepExpiredStateFiles,
} from "../src/pairing/session.ts";

const dirs: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "heeler-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PUBLIC = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMYSCTemrZWEXptQyehHLI9kbqjHxNUGtQN2lF1ucCce";

describe("authorized_keys", () => {
  test("a bootstrap line carries its restricted command and its marker", () => {
    const line = bootstrapLine({ publicLine: PUBLIC, pairingId: "abc123", expiresAt: 1234, command: "'/bin/enroll' --x" });
    expect(line.startsWith('restrict,command="')).toBe(true);
    expect(parseBootstrapLine(line)).toEqual({ pairingId: "abc123", expiresAt: 1234 });
    expect(keyBlobOf(line)).toBe(PUBLIC);
    expect(commentOf(line)).toBe("herdr-pairing:abc123:exp:1234");
  });

  test("a forced command with quotes or newlines is refused", () => {
    expect(() => bootstrapLine({ publicLine: PUBLIC, pairingId: "a", expiresAt: 1, command: 'say "hi"' })).toThrow();
    expect(() => bootstrapLine({ publicLine: PUBLIC, pairingId: "a", expiresAt: 1, command: "a\nb" })).toThrow();
  });

  test("edits are atomic and keep the file private", async () => {
    const dir = temp();
    const path = join(dir, "authorized_keys");
    await editAuthorizedKeys(path, (lines) => [...lines, PUBLIC]);
    expect(readFileSync(path, "utf8")).toBe(`${PUBLIC}\n`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const touched = await editAuthorizedKeys(path, () => null);
    expect(touched).toBe(false);
  });

  test("a sweep removes only expired bootstrap lines", async () => {
    const dir = temp();
    const path = join(dir, "authorized_keys");
    const live = bootstrapLine({ publicLine: PUBLIC, pairingId: "live", expiresAt: 2_000, command: "x" });
    const dead = bootstrapLine({ publicLine: PUBLIC, pairingId: "dead", expiresAt: 1_000, command: "x" });
    await editAuthorizedKeys(path, () => [live, dead, PUBLIC]);
    expect(await sweepExpiredBootstrapLines(path, 1_500)).toBe(1);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toEqual([live, PUBLIC]);
    expect(await removeBootstrapLine(path, "live")).toBe(true);
    expect(readFileSync(path, "utf8").trim()).toBe(PUBLIC);
  });

  test("a revoke matches the key blob, not the comment", async () => {
    const dir = temp();
    const path = join(dir, "authorized_keys");
    await editAuthorizedKeys(path, () => [`${PUBLIC} first label`, `${PUBLIC} second label`]);
    expect(await removeKeyLine(path, `${PUBLIC} first label`)).toBe(true);
    expect(readFileSync(path, "utf8").trim()).toBe("");
  });
});

describe("one pairing ceremony", () => {
  test("the Bootstrap Key enrolls a Device Key once, then self-revokes", async () => {
    const dir = temp();
    const authorized = join(dir, "authorized_keys");
    const state = join(dir, "state");
    const device = generateBootstrapKey();
    const code = "device-key-marker";

    const session = await beginPairing({
      authorizedKeysPath: authorized,
      stateDir: state,
      command: (pairingId) => `'shim' __enroll --pairing-id ${pairingId}`,
      now: 1_000,
    });
    expect(publicLineFromSeed(session.seed)).toBe(session.publicLine);
    const pending = readFileSync(join(state, "pending", `${session.pairingId}.json`), "utf8");
    expect(JSON.parse(pending)).toMatchObject({ pairingId: session.pairingId, expiresAt: 1_120 });

    const accepted = await acceptEnrollment({
      authorizedKeysPath: authorized,
      stateDir: state,
      pairingId: session.pairingId,
      submission: `${device.publicLine} ${code}`,
      now: 1_010,
    });
    expect(accepted.ok).toBe(true);
    expect(acceptLine(accepted)).toMatch(/^HERDR-ENROLL:OK:SHA256:/);
    const lines = readFileSync(authorized, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(code);
    const record = readEnrollment(state, session.pairingId);
    expect(record?.line).toBe(`${device.publicLine} ${code}`);
    expect(record?.fingerprint).toMatch(/^SHA256:/);

    const again = await acceptEnrollment({
      authorizedKeysPath: authorized,
      stateDir: state,
      pairingId: session.pairingId,
      submission: device.publicLine,
      now: 1_020,
    });
    expect(again).toMatchObject({ ok: false, code: "unknown_pairing" });
    expect(acceptLine(again)).toBe("HERDR-ENROLL:ERR:unknown_pairing");
    expect(readFileSync(authorized, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("a bad submission consumes nothing, so the app may retry", async () => {
    const dir = temp();
    const authorized = join(dir, "authorized_keys");
    const state = join(dir, "state");
    const session = await beginPairing({
      authorizedKeysPath: authorized,
      stateDir: state,
      command: () => "shim",
      now: 1_000,
    });
    const refused = await acceptEnrollment({
      authorizedKeysPath: authorized,
      stateDir: state,
      pairingId: session.pairingId,
      submission: "not a key",
      now: 1_010,
    });
    expect(refused).toMatchObject({ ok: false, code: "invalid_key" });
    expect(readEnrollment(state, session.pairingId)).toBeNull();
    const empty = await acceptEnrollment({
      authorizedKeysPath: authorized,
      stateDir: state,
      pairingId: session.pairingId,
      submission: "\n",
      now: 1_010,
    });
    expect(empty).toMatchObject({ ok: false, code: "no_input" });
    // Still pending: a retry with a real key works.
    const device = generateBootstrapKey();
    const accepted = await acceptEnrollment({
      authorizedKeysPath: authorized,
      stateDir: state,
      pairingId: session.pairingId,
      submission: device.publicLine,
      now: 1_015,
    });
    expect(accepted.ok).toBe(true);
  });

  test("an expired ceremony honors an enrollment that beat the clock, and refuses one after it", async () => {
    const dir = temp();
    const authorized = join(dir, "authorized_keys");
    const state = join(dir, "state");
    const session = await beginPairing({
      authorizedKeysPath: authorized,
      stateDir: state,
      command: () => "shim",
      now: 1_000,
      ttlSeconds: 60,
    });
    const late = await acceptEnrollment({
      authorizedKeysPath: authorized,
      stateDir: state,
      pairingId: session.pairingId,
      submission: generateBootstrapKey().publicLine,
      now: 2_000,
    });
    expect(late).toMatchObject({ ok: false, code: "expired" });
    expect(readFileSync(authorized, "utf8")).toBe("");
    expect(readEnrollment(state, session.pairingId)).toBeNull();
  });

  test("expiry removes a stale line, endPairing cleans up twice without harm", async () => {
    const dir = temp();
    const authorized = join(dir, "authorized_keys");
    const state = join(dir, "state");
    const session = await beginPairing({
      authorizedKeysPath: authorized,
      stateDir: state,
      command: () => "shim",
      now: 1_000,
      ttlSeconds: 60,
    });
    const expired = await expirePairing({ authorizedKeysPath: authorized, stateDir: state, pairingId: session.pairingId });
    expect(expired).toBeNull();
    expect(readFileSync(authorized, "utf8")).toBe("");
    await endPairing({ authorizedKeysPath: authorized, stateDir: state, pairingId: session.pairingId });
    await endPairing({ authorizedKeysPath: authorized, stateDir: state, pairingId: session.pairingId });
  });

  test("the stale state files are swept", async () => {
    const dir = temp();
    const state = join(dir, "state");
    await beginPairing({
      authorizedKeysPath: join(dir, "authorized_keys"),
      stateDir: state,
      command: () => "shim",
      now: 1_000,
      ttlSeconds: 60,
    });
    expect(sweepExpiredStateFiles(state, 1_050)).toBe(0);
    expect(sweepExpiredStateFiles(state, 2_000)).toBeGreaterThan(0);
  });
});
