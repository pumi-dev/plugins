// The Pairing Code envelope, v1: what the QR in Heeler holds.
//
// Wire format: `HERDR-PAIR:<version>:<base64url(JSON, no padding)>`. The payload uses herdr's short
// wire keys and a fixed key order, so a payload has exactly one canonical code. Heeler's app decodes
// this same envelope (`Sources/Heeler/Pairing/*`), so the version and the fields are a contract:
// changing either bumps `<version>`, which both sides must ship together.
//
// PROVENANCE: Heeler `plugin/src/envelope.js` and `plugin/README.md` § "Pairing Code envelope (v1)"
// @ plugin 0.6.2 (Apache-2.0), and `plugin/test-vectors/pairing-code-v1.json`.

/** The literal prefix of every Pairing Code. */
export const PAIRING_CODE_PREFIX = "HERDR-PAIR";

/** The envelope version this file speaks. */
export const PAIRING_CODE_VERSION = 1;

/** A Bootstrap Key seed is 32 raw bytes of Ed25519. */
export const BOOTSTRAP_SEED_BYTES = 32;

/** OpenSSH's host key fingerprint: `SHA256:` and 43 characters of unpadded base64. */
export const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** What a Pairing Code carries, in the terms Heeler's app reads it. */
export interface PairingPayload {
  /** Candidate addresses, in the order the app should try them. Non-empty; no whitespace. */
  addresses: string[];
  /** The SSH port to connect to. */
  port: number;
  /** The SSH username. */
  username: string;
  /** The SSH host key fingerprint the app pins. */
  hostKeyFingerprint: string;
  /** The Bootstrap Key's raw Ed25519 seed, when the code carries one. */
  bootstrapSeed?: Uint8Array;
  /** The Bootstrap Key's expiry in unix seconds; present with `bootstrapSeed`. */
  expiresAt?: number;
}

/** The four steps a code can fail at, as Heeler names them. */
export type PairingCodeErrorCode = "bad_prefix" | "unsupported_version" | "bad_encoding" | "bad_payload";

export class PairingCodeError extends Error {
  constructor(
    readonly code: PairingCodeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PairingCodeError";
  }
}

function fail(code: PairingCodeErrorCode, message: string): never {
  throw new PairingCodeError(code, message);
}

/** The payload's own rules, shared by encode and decode. */
function validate(payload: PairingPayload): void {
  if (!Array.isArray(payload.addresses) || payload.addresses.length === 0) {
    fail("bad_payload", "addresses must be a non-empty array");
  }
  for (const address of payload.addresses) {
    if (typeof address !== "string" || address.length === 0 || /\s/.test(address)) {
      fail("bad_payload", `invalid address: ${JSON.stringify(address)}`);
    }
  }
  if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535) {
    fail("bad_payload", `port must be an integer in 1..65535, got ${payload.port}`);
  }
  if (typeof payload.username !== "string" || payload.username.length === 0 || /\s/.test(payload.username)) {
    fail("bad_payload", "username must be a non-empty string without whitespace");
  }
  if (typeof payload.hostKeyFingerprint !== "string" || !FINGERPRINT_PATTERN.test(payload.hostKeyFingerprint)) {
    fail("bad_payload", "hostKeyFingerprint must be an OpenSSH SHA256 fingerprint");
  }
  if ((payload.bootstrapSeed === undefined) !== (payload.expiresAt === undefined)) {
    fail("bad_payload", "bootstrapSeed and expiresAt must be present together");
  }
  if (payload.bootstrapSeed !== undefined && payload.bootstrapSeed.length !== BOOTSTRAP_SEED_BYTES) {
    fail("bad_payload", `bootstrapSeed must be ${BOOTSTRAP_SEED_BYTES} bytes`);
  }
  if (payload.expiresAt !== undefined && (!Number.isInteger(payload.expiresAt) || payload.expiresAt <= 0)) {
    fail("bad_payload", "expiresAt must be a positive unix-seconds integer");
  }
}

/** Encode a payload into its canonical v1 code. */
export function encodePairingCode(payload: PairingPayload): string {
  validate(payload);
  const wire: Record<string, unknown> = {
    addrs: payload.addresses,
    port: payload.port,
    user: payload.username,
    fp: payload.hostKeyFingerprint,
  };
  if (payload.bootstrapSeed !== undefined) {
    wire.seed = Buffer.from(payload.bootstrapSeed).toString("base64url");
    wire.exp = payload.expiresAt;
  }
  const body = Buffer.from(JSON.stringify(wire), "utf8").toString("base64url");
  return `${PAIRING_CODE_PREFIX}:${PAIRING_CODE_VERSION}:${body}`;
}

function base64urlStrict(text: string, what: string, code: PairingCodeErrorCode): Buffer {
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) {
    fail(code, `${what} is not unpadded base64url`);
  }
  return Buffer.from(text, "base64url");
}

/**
 * Decode and validate a code: what a scanner read.
 *
 * Decoders ignore unknown payload fields (additive v1 metadata) and do not depend on key order.
 */
export function decodePairingCode(code: string): PairingPayload {
  if (typeof code !== "string" || !code.startsWith(`${PAIRING_CODE_PREFIX}:`)) {
    fail("bad_prefix", `expected "${PAIRING_CODE_PREFIX}:<version>:<payload>"`);
  }
  const rest = code.slice(PAIRING_CODE_PREFIX.length + 1);
  const separator = rest.indexOf(":");
  if (separator === -1) {
    fail("bad_prefix", "missing version separator");
  }
  const version = rest.slice(0, separator);
  if (version !== String(PAIRING_CODE_VERSION)) {
    fail("unsupported_version", `unsupported Pairing Code version "${version}"`);
  }
  const body = base64urlStrict(rest.slice(separator + 1), "payload", "bad_encoding");
  let wire: unknown;
  try {
    wire = JSON.parse(body.toString("utf8"));
  } catch {
    fail("bad_encoding", "payload is not valid JSON");
  }
  if (typeof wire !== "object" || wire === null || Array.isArray(wire)) {
    fail("bad_payload", "payload must be a JSON object");
  }
  const fields = wire as Record<string, unknown>;
  const payload: PairingPayload = {
    addresses: fields.addrs as string[],
    port: fields.port as number,
    username: fields.user as string,
    hostKeyFingerprint: fields.fp as string,
  };
  if (fields.seed !== undefined) {
    if (typeof fields.seed !== "string") {
      fail("bad_payload", "seed must be a base64url string");
    }
    payload.bootstrapSeed = base64urlStrict(fields.seed, "seed", "bad_payload");
  }
  if (fields.exp !== undefined) {
    payload.expiresAt = fields.exp as number;
  }
  validate(payload);
  return payload;
}
