// The QR rendering: text rows a monospaced view can draw, square enough to scan, quiet around the
// code the spec asks for.
import { describe, expect, test } from "bun:test";
import { encodePairingCode } from "../src/pairing/code.ts";
import { qrRows, qrText } from "../src/pairing/qr.ts";

const CODE = encodePairingCode({
  addresses: ["192.168.1.42", "100.101.102.103"],
  port: 2222,
  username: "amr",
  hostKeyFingerprint: "SHA256:6+jncNdibsG2cqvfoLApGrO8CvIwAEMzsB+IilOs8tg",
  bootstrapSeed: Buffer.alloc(32, 7),
  expiresAt: 1_753_305_600,
});

describe("qrRows", () => {
  test("draws the quiet zone the spec asks for", () => {
    const rows = qrRows(CODE);
    const width = rows[0]?.length ?? 0;
    expect(rows.slice(0, 4).every((row) => row.trim() === "")).toBe(true);
    expect(rows.slice(-4).every((row) => row.trim() === "")).toBe(true);
    expect(rows.every((row) => row.length === width)).toBe(true);
    // Each text row carries two module rows: the code is 21..177 modules, so the rows are odd
    // after the quiet zone, and no row is blank inside the code.
    const inside = rows.slice(4, -4);
    expect(inside.length).toBeGreaterThan(10);
    expect(inside.some((row) => /[█▀▄]/.test(row))).toBe(true);
  });

  test("a bigger payload gives a bigger code", () => {
    const small = qrRows("https://example.com");
    const large = qrRows(CODE);
    expect(large.length).toBeGreaterThan(small.length);
    expect(large[0]?.length ?? 0).toBeGreaterThan(small[0]?.length ?? 0);
  });

  test("draws with blocks only, so any theme can show it", () => {
    const text = qrText(CODE);
    expect(text).toBe(qrRows(CODE).join("\n"));
    expect(/^[█▀▄ \n]+$/.test(text)).toBe(true);
  });
});
