// The Pairing Code envelope: Heeler's shared vectors, byte for byte. The same file is in Heeler's
// repository and its app's tests, so a change here that passes but breaks the app is not possible.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { PairingCodeError, decodePairingCode, encodePairingCode, type PairingPayload } from "../src/pairing/code.ts";

interface Vector {
  name: string;
  code: string;
  payload: {
    addresses: string[];
    port: number;
    username: string;
    hostKeyFingerprint: string;
    bootstrapSeed?: string;
    expiresAt?: number;
  };
  decodeOnly?: boolean;
  error?: string;
}

const vectors = JSON.parse(readFileSync(new URL("./vectors/pairing-code-v1.json", import.meta.url), "utf8")) as {
  valid: Vector[];
  invalid: Vector[];
};

function asPayload(vector: Vector["payload"]): PairingPayload {
  return {
    addresses: vector.addresses,
    port: vector.port,
    username: vector.username,
    hostKeyFingerprint: vector.hostKeyFingerprint,
    ...(vector.bootstrapSeed === undefined ? {} : { bootstrapSeed: Buffer.from(vector.bootstrapSeed, "base64url") }),
    ...(vector.expiresAt === undefined ? {} : { expiresAt: vector.expiresAt }),
  };
}

function asVector(payload: PairingPayload): Vector["payload"] {
  return {
    addresses: payload.addresses,
    port: payload.port,
    username: payload.username,
    hostKeyFingerprint: payload.hostKeyFingerprint,
    ...(payload.bootstrapSeed === undefined ? {} : { bootstrapSeed: Buffer.from(payload.bootstrapSeed).toString("base64url") }),
    ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt }),
  };
}

describe("pairing code, shared vectors", () => {
  test("the vectors are there", () => {
    expect(vectors.valid.length).toBeGreaterThanOrEqual(3);
    expect(vectors.invalid.length).toBeGreaterThanOrEqual(10);
  });

  for (const vector of vectors.valid) {
    test(`decodes: ${vector.name}`, () => {
      expect(asVector(decodePairingCode(vector.code))).toEqual(vector.payload);
    });
  }

  for (const vector of vectors.valid.filter((vector) => vector.decodeOnly !== true)) {
    test(`encodes canonically: ${vector.name}`, () => {
      expect(encodePairingCode(asPayload(vector.payload))).toBe(vector.code);
    });
  }

  for (const vector of vectors.invalid) {
    test(`rejects (${vector.error}): ${vector.name}`, () => {
      let caught: unknown;
      try {
        decodePairingCode(vector.code);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PairingCodeError);
      expect((caught as PairingCodeError).code as string).toBe(vector.error ?? "");
    });
  }
});

describe("pairing code, its own rules", () => {
  const base: PairingPayload = {
    addresses: ["192.168.1.42"],
    port: 22,
    username: "ada",
    hostKeyFingerprint: "SHA256:6+jncNdibsG2cqvfoLApGrO8CvIwAEMzsB+IilOs8tg",
  };

  test("round-trips", () => {
    expect(decodePairingCode(encodePairingCode(base))).toEqual(base);
  });

  test("a seed is raw bytes, not text", () => {
    const seed = Buffer.from(Array.from({ length: 32 }, (_, at) => 255 - at));
    const decoded = decodePairingCode(encodePairingCode({ ...base, bootstrapSeed: seed, expiresAt: 1753305600 }));
    expect(decoded.bootstrapSeed).toEqual(seed);
    expect(decoded.expiresAt).toBe(1753305600);
  });

  test("refuses a payload it could not honor", () => {
    const bad: PairingPayload[] = [
      { ...base, addresses: [] },
      { ...base, addresses: ["has space"] },
      { ...base, port: 0 },
      { ...base, port: 22.5 },
      { ...base, username: "" },
      { ...base, hostKeyFingerprint: "MD5:abc" },
      { ...base, bootstrapSeed: Buffer.alloc(31), expiresAt: 1753305600 },
      { ...base, bootstrapSeed: Buffer.alloc(32) },
      { ...base, expiresAt: 1753305600 },
    ];
    for (const payload of bad) {
      expect(() => encodePairingCode(payload)).toThrow(PairingCodeError);
    }
  });
});
