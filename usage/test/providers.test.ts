// Each plan's sign-in, request and parser: what it finds on a Mac (made, here), what it asks, and
// what the service's own answer becomes. The bodies are the shapes the services send; the fixture
// files are the ones herdr reads, so the numbers a person would see agree with another client's.

import { expect, test } from "bun:test";

import { DAY, MONTH, SESSION, WEEK } from "../src/model.ts";
import { claude } from "../src/providers/claude.ts";
import { codex, kindOf } from "../src/providers/codex.ts";
import { copilot } from "../src/providers/copilot.ts";
import { openrouter } from "../src/providers/openrouter.ts";
import { moment, numeric, text, titleCase } from "../src/providers/types.ts";
import { machine, ok } from "./fake.ts";

// ---- Claude

const CLAUDE_CREDENTIALS = JSON.stringify({
  claudeAiOauth: { accessToken: "claude-token", subscriptionType: "max", rateLimitTier: "default_claude_max_20x" },
});

test("Claude: the keychain item Claude Code keeps, and the account it says it is", () => {
  const env = machine({
    vars: { USER: "me" },
    files: { "/Users/me/.claude.json": JSON.stringify({ oauthAccount: { emailAddress: "me@example.com" } }) },
    programs: { "security find-generic-password -s Claude Code-credentials -a me -w": CLAUDE_CREDENTIALS },
  });
  expect(claude.signIn(env, undefined)).toEqual({ token: "claude-token", account: "me@example.com", plan: "Max 20x" });
});

test("Claude: a credentials file is enough, and no sign-in at all is nothing", () => {
  const files = {
    "/Users/me/.claude/.credentials.json": CLAUDE_CREDENTIALS,
  };
  expect(claude.signIn(machine({ files }), undefined)?.token).toBe("claude-token");
  expect(claude.signIn(machine(), undefined)).toBeNull();
  // On another platform no keychain is asked, but the file still is.
  expect(claude.signIn(machine({ platform: "linux", files }), undefined)?.token).toBe("claude-token");
});

test("Claude: a Claude Code pointed elsewhere is not using the plan, so it is left alone", () => {
  const credentials = { "/Users/me/.claude/.credentials.json": CLAUDE_CREDENTIALS };
  const local = JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8317" } });
  expect(claude.signIn(machine({ files: { ...credentials, "/Users/me/.claude/settings.json": local } }), undefined)).toBeNull();
  const helper = JSON.stringify({ apiKeyHelper: "get-key" });
  expect(claude.signIn(machine({ files: { ...credentials, "/Users/me/.claude/settings.json": helper } }), undefined)).toBeNull();
  // Anthropic's own API, written out, is still the plan.
  const own = JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com/" } });
  expect(claude.signIn(machine({ files: { ...credentials, "/Users/me/.claude/settings.json": own } }), undefined)?.token).toBe("claude-token");
});

test("Claude: its endpoint, with the OAuth beta and Claude Code's own agent", () => {
  const [ask] = claude.ask({ token: "t" });
  expect(ask?.url).toBe("https://api.anthropic.com/api/oauth/usage");
  expect(ask?.headers.authorization).toBe("Bearer t");
  expect(ask?.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
  expect(ask?.headers["user-agent"]).toStartWith("claude-code/");
});

test("Claude: the plan's windows, its weekly surfaces and its extra spend", () => {
  const resets = "2026-02-19T20:00:00.000Z";
  const body = {
    limits: [
      { kind: "session", percent: 42, resets_at: resets },
      { kind: "weekly_all", percent: 12.5, resets_at: "2026-02-26T20:00:00.000Z" },
      { kind: "weekly_scoped", percent: 70.4, resets_at: "2026-02-26T20:00:00.000Z", scope: { model: { display_name: "Opus" } } },
    ],
    seven_day_breakdown: { rows: [{ display_name: "Claude Code", percent: 9.4 }, { display_name: "Claude.ai", percent: 0 }] },
    spend: {
      enabled: true,
      used: { amount_minor: 1234, currency: "USD", exponent: 2 },
      limit: { amount_minor: 2500, currency: "USD", exponent: 2 },
    },
  };
  const report = claude.parse([JSON.stringify(body)], { token: "t", account: "me@example.com", plan: "Max 20x" });
  expect(report.account).toEqual({ email: "me@example.com", plan: "Max 20x" });
  expect(report.windows.map((w) => [w.title, Math.round(w.used), w.length])).toEqual([
    ["Session", 42, SESSION],
    ["Weekly", 13, WEEK],
    ["Weekly · Opus", 70, WEEK],
  ]);
  expect(report.windows[0]?.resetsAt).toBe(Date.parse(resets));
  expect(report.facts).toEqual([
    { title: "This week by surface", rows: [["Claude Code", "9%"]] },
    { title: "Extra usage", rows: [["This month", "12.34 USD of 25.00 USD"]] },
  ]);
});

test("Claude: without `limits`, the older pair still makes windows", () => {
  const body = {
    five_hour: { utilization: 3, resets_at: "2026-02-19T20:00:00.000Z" },
    seven_day: { utilization: 61, resets_at: "2026-02-26T20:00:00.000Z" },
    spend: { enabled: false },
  };
  const report = claude.parse([JSON.stringify(body)], { token: "t" });
  expect(report.windows.map((w) => [w.kind, Math.round(w.used)])).toEqual([
    ["session", 3],
    ["weekly", 61],
  ]);
  expect(report.facts).toEqual([{ title: "Extra usage", rows: [["Status", "Off"]] }]);
});

// ---- Codex

const CODEX_AUTH = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "codex-token", account_id: "account-1" } });

test("Codex: the CLI's sign-in, else OpenCode's OpenAI one, and an account id on the request", () => {
  expect(codex.signIn(machine({ files: { "/Users/me/.codex/auth.json": CODEX_AUTH } }), undefined)).toEqual({
    token: "codex-token",
    account: "account-1",
  });
  const opencode = JSON.stringify({ openai: { type: "oauth", access: "opencode-token", accountId: "account-2" } });
  expect(codex.signIn(machine({ files: { "/Users/me/.local/share/opencode/auth.json": opencode } }), undefined)).toEqual({
    token: "opencode-token",
    account: "account-2",
  });
  // An API key is not a plan.
  const api = JSON.stringify({ openai: { type: "api", key: "sk-…" } });
  expect(codex.signIn(machine({ files: { "/Users/me/.local/share/opencode/auth.json": api } }), undefined)).toBeNull();
  const [ask] = codex.ask({ token: "t", account: "account-1" });
  expect(ask?.url).toBe("https://chatgpt.com/backend-api/wham/usage");
  expect(ask?.headers["chatgpt-account-id"]).toBe("account-1");
  expect(ask?.headers["openai-beta"]).toBe("codex-1");
});

test("Codex: a window is known by its length, not by the slot it arrives in", () => {
  expect(kindOf(18000, "weekly")).toBe("session");
  expect(kindOf(604800, "session")).toBe("weekly");
  expect(kindOf(2592000, "session")).toBe("monthly");
  expect(kindOf(86400, "weekly")).toBe("daily");
  expect(kindOf(undefined, "session")).toBe("session");
  expect(kindOf(3600, "weekly")).toBe("weekly");
});

test("Codex: a monthly plan, its review window and its credits", () => {
  const body = {
    email: "me@example.com",
    plan_type: "free",
    rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 2592000, reset_at: 1795518121 } },
    code_review_rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 604800 } },
    rate_limit_reset_credits: { available_count: 2 },
    credits: { unlimited: false, balance: "12" },
  };
  const report = codex.parse([JSON.stringify(body)], { token: "t" });
  expect(report.account).toEqual({ email: "me@example.com", plan: "Free" });
  expect(report.windows).toHaveLength(1);
  expect(report.windows[0]).toMatchObject({ kind: "monthly", title: "Monthly", used: 0, resetsAt: 1795518121_000, length: MONTH });
  expect(report.facts).toEqual([
    { title: "Code review", rows: [["Weekly", "10% used"]] },
    { title: "Credits", rows: [["Balance", "12"]] },
    { title: "Limit reset credits", rows: [["Available", "2"]] },
  ]);
});

test("Codex: a session and a week, in the slots they belong to", () => {
  const body = {
    plan_type: "plus",
    rate_limit: {
      primary_window: { used_percent: 23, limit_window_seconds: 18000, reset_at: 1770000000 },
      secondary_window: { used_percent: 61, limit_window_seconds: 604800, reset_at: 1770500000 },
    },
  };
  const report = codex.parse([JSON.stringify(body)], { token: "t" });
  expect(report.account.plan).toBe("Plus");
  expect(report.windows.map((w) => [w.kind, w.title, Math.round(w.used), w.length])).toEqual([
    ["session", "Session", 23, SESSION],
    ["weekly", "Weekly", 61, WEEK],
  ]);
  expect(report.facts).toEqual([]);
});

// ---- Copilot

const COPILOT = {
  login: "octocat",
  copilot_plan: "individual_pro",
  token_based_billing: false,
  quota_reset_date: "2025-02-01",
  quota_snapshots: {
    premium_interactions: { entitlement: 500, remaining: 450, percent_remaining: 90, quota_id: "premium_interactions" },
    chat: { entitlement: 300, remaining: 150, percent_remaining: 50, quota_id: "chat" },
  },
};

test("Copilot: the token the user gave first, then the environment, then `gh`, then an editor plugin", () => {
  expect(copilot.signIn(machine({ programs: { "gh auth token": "gh-token" } }), "given")).toEqual({ token: "given" });
  expect(copilot.signIn(machine({ vars: { COPILOT_API_TOKEN: "env-token" }, programs: { "gh auth token": "gh-token" } }), undefined)).toEqual({
    token: "env-token",
  });
  expect(copilot.signIn(machine({ programs: { "gh auth token": "gh-token\n" } }), undefined)).toEqual({ token: "gh-token" });
  const apps = JSON.stringify({ "github.com:Iv1.b507a08c87ecfe98": { oauth_token: "plugin-token" } });
  expect(copilot.signIn(machine({ files: { "/Users/me/.config/github-copilot/apps.json": apps } }), undefined)).toEqual({ token: "plugin-token" });
  expect(copilot.signIn(machine(), undefined)).toBeNull();
});

test("Copilot: `gh`'s own keychain item, which an app without a shell's PATH needs", () => {
  const base64 = Buffer.from("gho_token", "utf8").toString("base64");
  const encoded = machine({ programs: { "security find-generic-password -s gh:github.com -w": `go-keyring-base64:${base64}\n` } });
  expect(copilot.signIn(encoded, undefined)).toEqual({ token: "gho_token" });
  const plain = machine({ programs: { "security find-generic-password -s gh:github.com -w": "gho_plain" } });
  expect(copilot.signIn(plain, undefined)).toEqual({ token: "gho_plain" });
  // Another platform has no login keychain to ask.
  expect(copilot.signIn(machine({ platform: "linux" }), undefined)).toBeNull();
});

test("Copilot: premium requests and chat, monthly, with what is left of each", () => {
  const report = copilot.parse([JSON.stringify(COPILOT)], { token: "t" });
  expect(report.account).toEqual({ email: "octocat", plan: "Individual pro" });
  expect(report.windows.map((w) => [w.title, Math.round(w.used), w.resetsAt])).toEqual([
    ["Premium", 10, Date.parse("2025-02-01T00:00:00Z")],
    ["Chat", 50, Date.parse("2025-02-01T00:00:00Z")],
  ]);
  expect(report.windows.every((w) => w.length === MONTH)).toBe(true);
  expect(report.facts).toEqual([
    {
      title: "Quotas",
      rows: [
        ["Premium", "450 of 500 left"],
        ["Chat", "150 of 300 left"],
      ],
    },
  ]);
});

test("Copilot: an unlimited seat and an empty placeholder say so rather than drawing a quota", () => {
  const body = {
    copilot_plan: "business",
    token_based_billing: true,
    quota_snapshots: {
      premium_interactions: { entitlement: 0, remaining: 0, percent_remaining: 100, credits_used: 31 },
      chat: { unlimited: true },
    },
  };
  const report = copilot.parse([JSON.stringify(body)], { token: "t" });
  expect(report.windows).toEqual([]);
  expect(report.facts).toEqual([
    { title: "Quotas", rows: [["Chat", "Unlimited"]] },
    { title: "Credits", rows: [["Used", "31"]] },
  ]);
});

test("Copilot: the older monthly counts are a share of their own", () => {
  const body = {
    copilot_plan: "individual",
    quota_reset_date: "2025-02-01",
    monthly_quotas: { chat: 300, completions: 2000 },
    limited_user_quotas: { chat: 300, completions: 500 },
  };
  const report = copilot.parse([JSON.stringify(body)], { token: "t" });
  expect(report.windows.map((w) => [w.title, Math.round(w.used)])).toEqual([
    ["Premium", 75],
    ["Chat", 0],
  ]);
});

// ---- OpenRouter

test("OpenRouter: a key from the settings first, then the environment", () => {
  expect(openrouter.signIn(machine({ vars: { OPENROUTER_API_KEY: "env-key" } }), "given")).toEqual({ token: "given" });
  expect(openrouter.signIn(machine({ vars: { OPENROUTER_API_KEY: "env-key" } }), undefined)).toEqual({ token: "env-key" });
  expect(openrouter.signIn(machine(), undefined)).toBeNull();
});

test("OpenRouter: prepaid credits and the key's own spending cap", () => {
  const credits = JSON.stringify({ data: { total_credits: 100, total_usage: 40 } });
  const key = JSON.stringify({
    data: { limit: 20, limit_remaining: 15, limit_reset: "monthly", usage: 5, usage_daily: 1, usage_weekly: 2, usage_monthly: 4, label: "main" },
  });
  const report = openrouter.parse([credits, key], { token: "t" });
  expect(report.balance).toBe("$60.00 of $100.00");
  expect(report.windows.map((w) => [w.title, Math.round(w.used), w.kind, w.length])).toEqual([["Spending cap", 25, "monthly", MONTH]]);
  expect(report.facts).toEqual([
    {
      title: "API key",
      rows: [
        ["Spending cap", "$20.00"],
        ["Cap remaining", "$15.00"],
        ["Key used", "$5.00"],
        ["Reset window", "monthly"],
        ["Key", "main"],
      ],
    },
  ]);
});

test("OpenRouter: a key with no cap still reports its balance, and says so", () => {
  const credits = JSON.stringify({ data: { total_credits: 10, total_usage: 3.5 } });
  const key = JSON.stringify({ data: { limit: null, usage: 3.5, is_free_tier: true } });
  const report = openrouter.parse([credits, key], { token: "t" });
  expect(report.account.plan).toBe("Free tier");
  expect(report.windows).toEqual([]);
  expect(report.balance).toBe("$6.50 of $10.00");
  expect(report.facts?.[0]?.rows).toEqual([
    ["Spending cap", "None"],
    ["Key used", "$3.50"],
  ]);
});

// ---- what services send

test("a moment is seconds, milliseconds or a timestamp, and nothing else", () => {
  expect(moment(1770000000)).toBe(1770000000_000);
  expect(moment(1770000000_000)).toBe(1770000000_000);
  expect(moment("2026-02-19T20:00:00.000Z")).toBe(Date.parse("2026-02-19T20:00:00.000Z"));
  expect(moment("soon")).toBeUndefined();
  expect(moment(undefined)).toBeUndefined();
  expect(moment(-1)).toBeUndefined();
  // A day, in seconds, is not mistaken for 1970.
  expect(moment(DAY / 1000)).toBe(DAY);
});

test("numbers and names arrive as whatever the service uses", () => {
  expect(numeric("42")).toBe(42);
  expect(numeric(" ")).toBeUndefined();
  expect(numeric(true)).toBeUndefined();
  expect(text("  hi ")).toBe("hi");
  expect(text("   ")).toBeUndefined();
  expect(titleCase("individual_pro")).toBe("Individual pro");
  expect(titleCase("max")).toBe("Max");
});

test("a body that is not JSON is said in words, not thrown as a parse error", () => {
  expect(() => claude.parse(["<html>nope</html>"], { token: "t" })).toThrow("not JSON");
  expect(ok({})).toEqual({ status: 200, body: "{}" });
});
