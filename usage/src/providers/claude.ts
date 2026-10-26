// Claude plan usage, read with Claude Code's own sign-in: the login keychain on a Mac, else
// `.credentials.json` in its config directory. A Claude Code pointed at another endpoint, or
// signing in with an API-key helper, is not using the plan, so it is left alone rather than asked
// with a token the service would refuse.

import { createHash } from "node:crypto";

import { SESSION, WEEK, type Facts, type Report, type Window } from "../model.ts";
import { json, moment, numeric, text, titleCase, type Ask, type Creds, type Env, type Provider } from "./types.ts";

const KEYCHAIN = "Claude Code-credentials";
const USAGE = "https://api.anthropic.com/api/oauth/usage";
const BETA = "oauth-2025-04-20";
/** The usage endpoint serves Claude Code's OAuth clients. */
const AGENT = "claude-code/2.1.0";
const API = "https://api.anthropic.com";

export const claude: Provider = { id: "claude", name: "Claude", signIn, ask, parse };

/** The sign-in Claude Code has on this machine, if it is using the subscription at all. */
export function signIn(env: Env): Creds | null {
  const dir = env.env("CLAUDE_CONFIG_DIR")?.trim() || `${env.home}/.claude`;
  if (elsewhere(env, env.read(`${dir}/settings.json`))) return null;
  const item = keychain(env) ?? env.read(`${dir}/.credentials.json`);
  if (!item) return null;
  const asked = jsonOrNothing(item);
  const oauth = asked?.claudeAiOauth;
  const token = text(oauth?.accessToken);
  if (!token) return null;
  return {
    token,
    account: email(env, dir),
    plan: plan(text(oauth?.subscriptionType), text(oauth?.rateLimitTier)),
  };
}

export function ask(creds: Creds): Ask[] {
  return [
    {
      url: USAGE,
      headers: {
        authorization: `Bearer ${creds.token}`,
        "anthropic-beta": BETA,
        "user-agent": AGENT,
        accept: "application/json",
      },
    },
  ];
}

/**
 * `max` on tier `default_claude_max_20x` is `Max 20x`: the subscription's name, and the multiple
 * its tier ends with when it says one.
 */
export function plan(subscription: string | undefined, tier: string | undefined): string | undefined {
  if (!subscription) return undefined;
  const name = titleCase(subscription);
  if (!name) return undefined;
  const last = tier?.split("_").at(-1);
  const multiple = last && /^\d+x$/.test(last) ? last : undefined;
  return multiple ? `${name} ${multiple}` : name;
}

/**
 * The keychain item Claude Code keeps its token in. Asked by service alone, `security` may answer
 * with another account's item first (one `sudo claude` left under `root` holds only MCP sign-ins),
 * so the user's own item is asked for first.
 */
export function keychain(env: Env): string | null {
  if (env.platform !== "darwin") return null;
  const dir = env.env("CLAUDE_CONFIG_DIR")?.trim();
  // Explicit profiles are namespaced by the NFC-normalized config directory.
  const service = dir ? `${KEYCHAIN}-${profile(dir)}` : KEYCHAIN;
  const user = env.env("USER");
  for (const account of [user, undefined]) {
    const argv = ["security", "find-generic-password", "-s", service];
    if (account) argv.push("-a", account);
    argv.push("-w");
    const found = env.run(argv)?.trim();
    if (found) return found;
  }
  return null;
}

/** The first four bytes of the config directory's SHA-256, as Claude Code names an item. */
function profile(dir: string): string {
  return createHash("sha256").update(dir.normalize("NFC")).digest("hex").slice(0, 8);
}

/** The account Claude Code says it is signed in as, from its own config. */
function email(env: Env, dir: string): string | undefined {
  for (const path of [`${dir}/.claude.json`, `${env.home}/.claude.json`]) {
    const config = jsonOrNothing(env.read(path));
    const found = text(config?.oauthAccount?.emailAddress);
    if (found) return found;
  }
  return undefined;
}

/**
 * Whether Claude Code works without its OAuth sign-in: `ANTHROPIC_BASE_URL` naming another
 * endpoint (from the environment or the `env` of its settings) or an `apiKeyHelper` supplying its
 * key. An OAuth token still in the keychain is then a leftover, possibly revoked.
 */
export function elsewhere(env: Env, settings: string | null): boolean {
  const config = jsonOrNothing(settings);
  const base = env.env("ANTHROPIC_BASE_URL") ?? text(config?.env?.ANTHROPIC_BASE_URL);
  if (base && !anthropic(base)) return true;
  return Boolean(text(config?.apiKeyHelper));
}

/** Whether `url` is Anthropic's own API, with or without a path after it. */
function anthropic(url: string): boolean {
  const base = url.trim().replace(/\/+$/, "");
  return base === API || base.startsWith(`${API}/`);
}

function jsonOrNothing(body: string | null | undefined): any | undefined {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export function parse(answers: string[], creds: Creds): Report {
  const usage = json(answers[0] ?? "");
  const windows = limits(usage) ?? fixedWindows(usage);
  const account = { email: creds.account, plan: creds.plan };
  const facts: Facts[] = [];
  const shares: [string, string][] = (usage?.seven_day_breakdown?.rows ?? [])
    .map((row: any) => [text(row?.display_name), numeric(row?.percent)] as const)
    .filter(([name, used]: readonly [string | undefined, number | undefined]) => name && used !== undefined && used > 0)
    .map(([name, used]: readonly [string | undefined, number | undefined]) => [name!, `${Math.round(used!)}%`] as [string, string]);
  if (shares.length) facts.push({ title: "This week by surface", rows: shares });
  const spend = usage?.spend;
  if (spend && typeof spend === "object") {
    const enabled = spend.enabled === true;
    const used = money(spend.used);
    const limit = money(spend.limit);
    facts.push({
      title: "Extra usage",
      rows: enabled
        ? [["This month", used && limit ? `${used} of ${limit}` : (used ?? "On")]]
        : [["Status", "Off"]],
    });
  }
  return { provider: "claude", name: "Claude", account, windows, facts };
}

/** `limits`, which are what a plan's windows are; the older fixed pair when it has none. */
function limits(usage: any): Window[] | undefined {
  const rows = Array.isArray(usage?.limits) ? usage.limits : [];
  const windows: Window[] = [];
  for (const row of rows) {
    const kind = text(row?.kind);
    const used = numeric(row?.percent);
    if (kind === undefined || used === undefined) continue;
    if (kind === "session") {
      windows.push({ kind: "session", title: "Session", used, resetsAt: moment(row?.resets_at), length: SESSION });
    } else if (kind === "weekly_all") {
      windows.push({ kind: "weekly", title: "Weekly", used, resetsAt: moment(row?.resets_at), length: WEEK });
    } else if (kind === "weekly_scoped") {
      const name = text(row?.scope?.model?.display_name);
      if (!name) continue;
      windows.push({ kind: "named", title: `Weekly · ${name}`, used, resetsAt: moment(row?.resets_at), length: WEEK });
    }
  }
  return windows.length ? windows : undefined;
}

/** `five_hour` and `seven_day`, for a response without `limits`. */
function fixedWindows(usage: any): Window[] {
  const windows: Window[] = [];
  const five = usage?.five_hour;
  const session = numeric(five?.utilization);
  if (session !== undefined) {
    windows.push({ kind: "session", title: "Session", used: session, resetsAt: moment(five?.resets_at), length: SESSION });
  }
  const seven = usage?.seven_day;
  const week = numeric(seven?.utilization);
  if (week !== undefined) {
    windows.push({ kind: "weekly", title: "Weekly", used: week, resetsAt: moment(seven?.resets_at), length: WEEK });
  }
  return windows;
}

/** `12.34 USD`, in the currency's own minor units. */
function money(value: any): string | undefined {
  const minor = numeric(value?.amount_minor);
  const currency = text(value?.currency);
  if (minor === undefined || !currency) return undefined;
  const exponent = Math.min(6, Math.max(0, numeric(value?.exponent) ?? 2));
  const scale = 10 ** exponent;
  const sign = minor < 0 ? "-" : "";
  const amount = Math.abs(minor);
  if (exponent === 0) return `${sign}${amount} ${currency}`;
  return `${sign}${Math.floor(amount / scale)}.${String(amount % scale).padStart(exponent, "0")} ${currency}`;
}

