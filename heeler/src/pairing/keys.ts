// The key material a pairing ceremony touches: the Bootstrap Key it mints, the host key whose
// fingerprint the QR pins, and the Device Key the app submits during Enrollment.
//
// PROVENANCE: Heeler `plugin/src/{bootstrap-key,host-key,device-key}.js` @ plugin 0.6.2
// (Apache-2.0). The shapes are OpenSSH's: a public key line is `<type> <base64 blob> [comment]`, and
// its fingerprint is `SHA256:` plus the unpadded base64 of the blob's SHA-256.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const KEY_TYPE = "ssh-ed25519";

const ED25519_KEY_BYTES = 32;
const ED25519_SEED_BYTES = 32;
/** PKCS#8 DER prefix for an Ed25519 private key; the raw seed follows it. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_LINE_LENGTH = 1024;
const COMMENT_PATTERN = /^[\x20-\x7e]+$/;

/** An SSH string: a big-endian length, then the bytes. */
function sshString(buffer: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(buffer.length);
  return Buffer.concat([length, buffer]);
}

function publicLineFromRaw(raw: Buffer): string {
  const blob = Buffer.concat([sshString(Buffer.from(KEY_TYPE, "utf8")), sshString(raw)]);
  return `${KEY_TYPE} ${blob.toString("base64")}`;
}

/** The OpenSSH public key line for a raw 32-byte Ed25519 seed, as `ssh-keygen -y` prints it. */
export function publicLineFromSeed(seed: Uint8Array): string {
  if (seed.length !== ED25519_SEED_BYTES) {
    throw new Error(`an Ed25519 seed must be ${ED25519_SEED_BYTES} bytes`);
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" }) as { x: string };
  return publicLineFromRaw(Buffer.from(jwk.x, "base64url"));
}

/** A fresh Bootstrap Key: its raw seed (which rides in the QR) and its public line. */
export function generateBootstrapKey(): { seed: Buffer; publicLine: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string };
  const seed = Buffer.from(jwk.d, "base64url");
  const publicJwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { seed, publicLine: publicLineFromRaw(Buffer.from(publicJwk.x, "base64url")) };
}

/** A public key line's OpenSSH SHA256 fingerprint. */
export function fingerprintPublicKeyLine(line: string): { keyType: string; fingerprint: string } {
  const [keyType, blob] = line.trim().split(/\s+/);
  if (!keyType?.startsWith("ssh-") && !keyType?.startsWith("ecdsa-")) {
    throw new Error(`not an SSH public key line: ${JSON.stringify(line)}`);
  }
  if (!blob || !BASE64_PATTERN.test(blob)) {
    throw new Error("SSH public key line has no base64 key blob");
  }
  const digest = createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64");
  return { keyType, fingerprint: `SHA256:${digest.replace(/=+$/, "")}` };
}

/** Host key files the plugin's sshd may use, the way OpenSSH prefers them. */
export const HOST_KEY_FILES = ["ssh_host_ed25519_key.pub", "ssh_host_ecdsa_key.pub", "ssh_host_rsa_key.pub"];

/** The fingerprint of the first host key public half in `dir`, or nothing. */
export function readHostKeyFingerprint(dir: string): { keyType: string; fingerprint: string; path: string } | null {
  for (const file of HOST_KEY_FILES) {
    const path = join(dir, file);
    let line: string;
    try {
      line = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    return { ...fingerprintPublicKeyLine(line), path };
  }
  return null;
}

export class DeviceKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceKeyError";
  }
}

function bad(message: string): never {
  throw new DeviceKeyError(message);
}

function readSshString(buffer: Buffer, offset: number): { value: Buffer; end: number } {
  if (offset + 4 > buffer.length) {
    bad("truncated key blob");
  }
  const length = buffer.readUInt32BE(offset);
  const end = offset + 4 + length;
  if (end > buffer.length) {
    bad("truncated key blob");
  }
  return { value: buffer.subarray(offset + 4, end), end };
}

/**
 * Parse and strictly validate a Device Key submission: exactly one bare
 * `ssh-ed25519 <blob> [comment]` line, a well-formed Ed25519 public key, and a printable-ASCII
 * comment. Everything else is refused without consuming the Bootstrap Key.
 */
export function parseDeviceKeyLine(input: string): { line: string; fingerprint: string } {
  if (typeof input !== "string") {
    bad("submission must be text");
  }
  if (input.length > MAX_LINE_LENGTH) {
    bad(`submission exceeds ${MAX_LINE_LENGTH} characters`);
  }
  const line = input.trim();
  if (line.length === 0) {
    bad("submission is empty");
  }
  if (/[\n\r]/.test(line)) {
    bad("submission must be a single line");
  }
  const [keyType, blobText, ...commentWords] = line.split(" ");
  if (keyType !== KEY_TYPE) {
    bad(`key type must be ${KEY_TYPE}`);
  }
  if (blobText === undefined || !BASE64_PATTERN.test(blobText)) {
    bad("key blob is not base64");
  }
  const blob = Buffer.from(blobText, "base64");
  const type = readSshString(blob, 0);
  if (type.value.toString("utf8") !== KEY_TYPE) {
    bad("key blob type disagrees with the line type");
  }
  const key = readSshString(blob, type.end);
  if (key.value.length !== ED25519_KEY_BYTES) {
    bad(`Ed25519 public key must be ${ED25519_KEY_BYTES} bytes`);
  }
  if (key.end !== blob.length) {
    bad("key blob has trailing bytes");
  }
  const comment = commentWords.join(" ");
  if (comment.length > 0 && !COMMENT_PATTERN.test(comment)) {
    bad("comment must be printable ASCII");
  }
  // Re-emit the blob from the decoded bytes so the file only ever gets canonical base64.
  const canonicalBlob = blob.toString("base64");
  const canonical = comment.length > 0 ? `${KEY_TYPE} ${canonicalBlob} ${comment}` : `${KEY_TYPE} ${canonicalBlob}`;
  return { line: canonical, fingerprint: fingerprintPublicKeyLine(canonical).fingerprint };
}
