// One read of every plan, without a service or a machine: a plan is read when it is shown and
// signed in, a failed read keeps the numbers it had, and the reason is said rather than thrown.

import { expect, test } from "bun:test";

import { gather } from "../src/gather.ts";
import type { Report } from "../src/model.ts";
import { copilot } from "../src/providers/copilot.ts";
import type { Provider, ProviderId } from "../src/providers/index.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { machine, network, ok } from "./fake.ts";

const NOW = 1_700_000_000_000;

const report = (provider: string): Report => ({
  provider,
  name: provider,
  account: {},
  windows: [{ kind: "session", title: "Session", used: 20, resetsAt: NOW + 3600_000, length: 18000_000 }],
});

function plan(id: ProviderId, over: Partial<Provider> = {}): Provider {
  return {
    id,
    name: id,
    signIn: () => ({ token: "t" }),
    ask: () => [{ url: `https://${id}.test/usage`, headers: {} }],
    parse: () => report(id),
    ...over,
  };
}

test("every plan that is shown and signed in is read, and each reading says when", async () => {
  const http = network({ "https://claude.test/usage": ok({}), "https://codex.test/usage": ok({}) });
  const snapshot = await gather({
    env: machine(),
    settings: DEFAULT_SETTINGS,
    http,
    providers: [plan("claude"), plan("codex")],
    now: NOW,
  });
  expect(snapshot.at).toBe(NOW);
  expect(snapshot.readings.map((r) => [r.provider, r.at, r.checkedAt, r.error])).toEqual([
    ["claude", NOW, NOW, undefined],
    ["codex", NOW, NOW, undefined],
  ]);
  expect(http.asked.map((a) => a.url)).toEqual(["https://claude.test/usage", "https://codex.test/usage"]);
});

test("a plan with no sign-in is left out, and a hidden one is not asked", async () => {
  const http = network({ "https://claude.test/usage": ok({}), "https://codex.test/usage": ok({}) });
  const snapshot = await gather({
    env: machine(),
    settings: { ...DEFAULT_SETTINGS, codex: false },
    http,
    providers: [plan("claude", { signIn: () => null }), plan("codex")],
    now: NOW,
  });
  expect(snapshot.readings).toEqual([]);
  expect(http.asked).toEqual([]);
});

test("a read that fails keeps the numbers it had, and says why", async () => {
  const first = await gather({
    env: machine(),
    settings: DEFAULT_SETTINGS,
    http: network({ "https://claude.test/usage": ok({}) }),
    providers: [plan("claude")],
    now: NOW,
  });
  const later = NOW + 300_000;
  const snapshot = await gather({
    env: machine(),
    settings: DEFAULT_SETTINGS,
    http: network({ "https://claude.test/usage": { status: 401, body: "" } }),
    previous: first.readings,
    providers: [plan("claude")],
    now: later,
  });
  expect(snapshot.readings[0]).toMatchObject({
    provider: "claude",
    report: first.readings[0]!.report,
    at: NOW,
    checkedAt: later,
    error: "claude refused the sign-in: sign in again, or set a key in Settings",
  });
});

test("a plan that never answered says so, with no numbers", async () => {
  const snapshot = await gather({
    env: machine(),
    settings: DEFAULT_SETTINGS,
    http: network({ "https://codex.test/usage": { status: 503, body: "" } }),
    providers: [plan("codex")],
    now: NOW,
  });
  expect(snapshot.readings[0]).toMatchObject({ provider: "codex", report: undefined, at: undefined, error: "codex answered 503" });
});

test("a service that is rate limiting says so, and a parser's own message stands", async () => {
  const limited = await gather({
    env: machine(),
    settings: DEFAULT_SETTINGS,
    http: network({ "https://claude.test/usage": { status: 429, body: "" } }),
    providers: [plan("claude")],
    now: NOW,
  });
  expect(limited.readings[0]?.error).toContain("rate limiting");
  const broken = await gather({
    env: machine(),
    settings: DEFAULT_SETTINGS,
    http: network({ "https://claude.test/usage": ok({ nope: true }) }),
    providers: [
      plan("claude", {
        parse: () => {
          throw new Error("the service answered something that is not JSON");
        },
      }),
    ],
    now: NOW,
  });
  expect(broken.readings[0]?.error).toBe("the service answered something that is not JSON");
});

test("a secret option reaches the plan that takes it", async () => {
  let given: string | undefined;
  await gather({
    env: machine(),
    settings: DEFAULT_SETTINGS,
    keys: { copilot_token: "gh-token" },
    http: network({ "https://copilot.test/usage": ok({}) }),
    providers: [
      {
        ...copilot,
        ask: () => [{ url: "https://copilot.test/usage", headers: {} }],
        parse: () => report("copilot"),
        signIn: (_env, key) => {
          given = key;
          return key ? { token: key } : null;
        },
      },
    ],
    now: NOW,
  });
  expect(given).toBe("gh-token");
});

test("a sign-in that throws is one plan's failure, not the whole read's", async () => {
  const snapshot = await gather({
    env: machine(),
    settings: DEFAULT_SETTINGS,
    http: network({ "https://codex.test/usage": ok({}) }),
    providers: [
      plan("claude", {
        signIn: () => {
          throw new Error("the keychain refused");
        },
      }),
      plan("codex"),
    ],
    now: NOW,
  });
  expect(snapshot.readings.map((r) => [r.provider, r.error, Boolean(r.report)])).toEqual([
    ["claude", "the keychain refused", false],
    ["codex", undefined, true],
  ]);
});
