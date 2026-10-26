// The key material: the Bootstrap Key's derivation, the host key fingerprint, and the strict Device
// Key parser that guards what Enrollment appends to authorized_keys.
import { describe, expect, test } from "bun:test";
import {
  DeviceKeyError,
  fingerprintPublicKeyLine,
  generateBootstrapKey,
  parseDeviceKeyLine,
  publicLineFromSeed,
} from "../src/pairing/keys.ts";

// Generated with ssh-keygen; the seed was taken from the openssh-key-v1 private file, so the
// expected line does not come from the code under test.
const VECTOR_SEED = Buffer.from("1n6mUQHut1FJ4pJcfRp09db_30WxtZPx7lGUIYAl0Hk", "base64url");
const VECTOR_PUBLIC_LINE = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMYSCTemrZWEXptQyehHLI9kbqjHxNUGtQN2lF1ucCce";
const VECTOR_FINGERPRINT = "SHA256:ef+f9Jda6ZPkcW5GiL7pQZXJ57mCFnFAGkir3AcfTIM";

describe("publicLineFromSeed", () => {
  test("matches what ssh-keygen derives from the same seed", () => {
    expect(publicLineFromSeed(VECTOR_SEED)).toBe(VECTOR_PUBLIC_LINE);
  });

  test("fingerprints like ssh-keygen -lf", () => {
    expect(fingerprintPublicKeyLine(publicLineFromSeed(VECTOR_SEED)).fingerprint).toBe(VECTOR_FINGERPRINT);
  });

  test("a seed that is not 32 bytes is refused", () => {
    expect(() => publicLineFromSeed(Buffer.alloc(31))).toThrow();
    expect(() => publicLineFromSeed(Buffer.alloc(33))).toThrow();
  });
});

describe("generateBootstrapKey", () => {
  test("its seed re-derives its public line", () => {
    const { seed, publicLine } = generateBootstrapKey();
    expect(seed.length).toBe(32);
    expect(publicLineFromSeed(seed)).toBe(publicLine);
  });

  test("every key is fresh", () => {
    expect(generateBootstrapKey().publicLine).not.toBe(generateBootstrapKey().publicLine);
  });
});

describe("parseDeviceKeyLine", () => {
  test("accepts a bare Ed25519 line and answers its fingerprint", () => {
    const parsed = parseDeviceKeyLine(VECTOR_PUBLIC_LINE);
    expect(parsed.line).toBe(VECTOR_PUBLIC_LINE);
    expect(parsed.fingerprint).toBe(VECTOR_FINGERPRINT);
  });

  test("keeps a printable label", () => {
    expect(parseDeviceKeyLine(`${VECTOR_PUBLIC_LINE} Amr's iPhone`).line).toBe(`${VECTOR_PUBLIC_LINE} Amr's iPhone`);
  });

  test("re-emits canonical base64 and a single line", () => {
    const parsed = parseDeviceKeyLine(`  ${VECTOR_PUBLIC_LINE}\n`);
    expect(parsed.line).toBe(VECTOR_PUBLIC_LINE);
  });

  test("refuses anything that is not one bare Ed25519 key", () => {
    const blob = VECTOR_PUBLIC_LINE.split(" ")[1] as string;
    const bads = [
      "",
      "  ",
      `ssh-rsa ${blob}`,
      `ssh-ed25519 ${VECTOR_PUBLIC_LINE}`,
      `ssh-ed25519 ${blob} two\nlines`,
      `ssh-ed25519 ${blob} tab\there`,
      `ssh-ed25519 ${blob.slice(0, -4)}`,
      `ssh-ed25519 ${"A".repeat(4000)}`,
      `ssh-ed25519 ${blob} ${"x".repeat(1024)}`,
    ];
    for (const bad of bads) {
      expect(() => parseDeviceKeyLine(bad)).toThrow(DeviceKeyError);
    }
  });
});
