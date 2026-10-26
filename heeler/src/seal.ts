// AES-256-GCM envelopes, as Heeler's app opens them: `{"v":1,"kid":…,"n":…,"ct":…}`.
//
// Both of Heeler's encrypted payloads — Agent Notifications and Live Activity details — use this
// framing and the same per-Device Notification Key; only the additional authenticated data differs
// (`HERDR-NOTIFY:1`, `HERDR-ACTIVITY:1`), so one ciphertext can never be opened as the other.
//
// PROVENANCE: Heeler `plugin/src/seal-envelope.js` @ plugin 0.6.2 (Apache-2.0).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const ENVELOPE_VERSION = 1;
export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
/** AES-GCM's tag, which the envelope carries at the end of `ct`. */
export const TAG_BYTES = 16;

/** The cleartext key id: the first 8 bytes of SHA-256 over the key, unpadded base64url. */
export function keyId(key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new TypeError(`a Notification Key is ${KEY_BYTES} bytes`);
  return createHash("sha256").update(key).digest().subarray(0, 8).toString("base64url");
}

/** A UTF-8 plaintext, sealed under `key` for one domain, as Heeler's envelope string. */
export function seal(plaintext: string, key: Buffer, aad: Buffer, nonce?: Buffer): string {
  const iv = nonce ?? randomBytes(NONCE_BYTES);
  if (iv.length !== NONCE_BYTES) throw new TypeError(`a nonce is ${NONCE_BYTES} bytes`);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ v: ENVELOPE_VERSION, kid: keyId(key), n: iv.toString("base64url"), ct: ciphertext.toString("base64url") });
}

/** The plaintext back, for a test: authentication must hold for this domain's `aad`. */
export function open(envelope: string, key: Buffer, aad: Buffer): string {
  let wire: { v: number; n: string; ct: string };
  try {
    wire = JSON.parse(envelope) as { v: number; n: string; ct: string };
  } catch {
    throw new Error("envelope is not JSON");
  }
  if (wire.v !== ENVELOPE_VERSION) throw new Error(`envelope version ${wire.v}`);
  const nonce = Buffer.from(wire.n, "base64url");
  const ciphertext = Buffer.from(wire.ct, "base64url");
  if (nonce.length !== NONCE_BYTES) throw new Error(`nonce is ${nonce.length} bytes, not ${NONCE_BYTES}`);
  if (ciphertext.length < TAG_BYTES) throw new Error("ciphertext is shorter than its authentication tag");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_BYTES));
  return Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}
