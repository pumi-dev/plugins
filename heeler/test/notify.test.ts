// Heeler's Agent Notifications as this package sends them: the envelope must be the bytes Heeler's
// app decrypts, so the vectors are Heeler's own (`plugin/test-vectors/notification-payload-v1.json`,
// Apache-2.0), shared with its Node hook and its Swift app.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envelope, hookSession, readConfig, readDevices, type Notification } from "../src/notify.ts";

interface Vector {
  name: string;
  key: string;
  envelope: string;
  payload: Notification;
  decodeOnly?: boolean;
}

const payloads = (await Bun.file(`${import.meta.dir}/vectors/notification-payload-v1.json`).json()) as { valid: Vector[] };

const dirs: string[] = [];
function pluginDir(notify?: unknown, registration?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "pumi-heeler-"));
  dirs.push(dir);
  if (notify !== undefined) writeFileSync(join(dir, "notify.json"), JSON.stringify(notify));
  if (registration !== undefined) writeFileSync(join(dir, "notifications.json"), JSON.stringify(registration));
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("every canonical vector is the envelope this package seals", () => {
  let canonical = 0;
  for (const vector of payloads.valid) {
    if (vector.decodeOnly) continue;
    const key = Buffer.from(vector.key, "base64url");
    const nonce = Buffer.from((JSON.parse(vector.envelope) as { n: string }).n, "base64url");
    expect(envelope(vector.payload, key, nonce)).toBe(vector.envelope);
    canonical += 1;
  }
  // The vectors are not all decode-only; a change that skipped them all would otherwise pass.
  expect(canonical).toBe(4);
});

test("a device hears the status it enabled, in its session, while its key is a Notification Key", () => {
  const key = Buffer.alloc(32, 1).toString("base64url");
  const registration = {
    v: 1,
    devices: [
      { token: "a", env: "production", key, notify: { blocked: true, done: false }, session: "pumi" },
      { token: "b", env: "sandbox", key, notify: { blocked: true, done: true } },
      { token: "c", env: "production", key, notify: { blocked: true, done: true }, session: "work" },
      { token: "d", env: "production", key, notify: { done: true }, session: "pumi" },
      { token: "e", env: "staging", key, notify: { blocked: true }, session: "pumi" },
      { token: "f", env: "production", key: "short", notify: { blocked: true }, session: "pumi" },
      { token: "", env: "production", key, notify: { blocked: true }, session: "pumi" },
    ],
  };
  const dir = pluginDir(undefined, registration);
  expect(readDevices(dir, "pumi", "blocked").map((device) => device.token)).toEqual(["a", "b"]);
  expect(readDevices(dir, "pumi", "done").map((device) => device.token)).toEqual(["b", "d"]);
  // An entry with no session hears the default session too.
  expect(readDevices(dir, "", "blocked").map((device) => device.token)).toEqual(["b"]);
});

test("no registration, or one of another version, is nothing at all", () => {
  expect(readDevices(pluginDir(), "pumi", "done")).toEqual([]);
  expect(readDevices(pluginDir(undefined, { v: 2, devices: [{ token: "a", env: "production", key: Buffer.alloc(32).toString("base64url"), notify: { done: true } }] }), "pumi", "done")).toEqual([]);
  expect(readDevices(pluginDir(undefined, { v: 1, devices: "nope" }), "pumi", "done")).toEqual([]);
});

test("notify.json's defaults are Heeler's, and its own values win", () => {
  const defaults = readConfig(pluginDir());
  expect(defaults).toEqual({ relay: "https://heeler-apns.bybee.dev", debounce: 5000, retry: 1000, activityDebounce: 1500 });
  const chosen = readConfig(pluginDir({ relay_url: "https://relay.example/", debounce_ms: 0, retry_delay_ms: 250 }));
  expect(chosen).toEqual({ relay: "https://relay.example", debounce: 0, retry: 250, activityDebounce: 1500 });
});

test("herdr's default session is the empty name", () => {
  expect(hookSession("default")).toBe("");
  expect(hookSession("-")).toBe("");
  expect(hookSession("pumi")).toBe("pumi");
});
