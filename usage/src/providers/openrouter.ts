// OpenRouter: prepaid credits and the API key's own spending cap, read with a key from the
// plugin's settings or `OPENROUTER_API_KEY`. Either answer alone is worth showing, so a key without
// a cap still reports its balance.

import { DAY, MONTH, WEEK, type Facts, type Kind, type Report, type Window } from "../model.ts";
import { json, numeric, text, type Ask, type Creds, type Env, type Provider } from "./types.ts";

const BASE = "https://openrouter.ai/api/v1";

export const openrouter: Provider = { id: "openrouter", name: "OpenRouter", key: "openrouter_key", signIn, ask, parse };

export function signIn(env: Env, key: string | undefined): Creds | null {
  const token = key?.trim() || env.env("OPENROUTER_API_KEY")?.trim();
  return token ? { token } : null;
}

export function ask(creds: Creds): Ask[] {
  const headers = { authorization: `Bearer ${creds.token}`, accept: "application/json", "x-title": "pumi" };
  return [
    { url: `${BASE}/credits`, headers },
    { url: `${BASE}/key`, headers },
  ];
}

export function parse(answers: string[], _creds?: Creds): Report {
  const credits = envelope(answers[0]);
  const key = envelope(answers[1]);
  const windows: Window[] = [];
  const facts: Facts[] = [];
  let balance: string | undefined;

  const total = numeric(credits?.total_credits);
  const spent = numeric(credits?.total_usage);
  if (total !== undefined && spent !== undefined) {
    balance = `${usd(Math.max(0, total - spent))} of ${usd(total)}`;
  }

  if (key && typeof key === "object") {
    const cap = numeric(key.limit);
    const remaining = numeric(key.limit_remaining);
    const usage = numeric(key.usage);
    if (cap !== undefined && cap > 0) {
      const spent = periodSpend(key, cap);
      if (spent !== undefined) {
        windows.push({ kind: kindOfReset(key.limit_reset), title: "Spending cap", used: (spent / cap) * 100, length: resetLength(key.limit_reset) });
      }
    }
    const rows = capRows(cap, remaining, usage, key.limit_reset);
    const label = text(key.label);
    if (label) rows.push(["Key", label]);
    facts.push({ title: "API key", rows });
    const free = key.is_free_tier === true ? "Free tier" : undefined;
    return { provider: "openrouter", name: "OpenRouter", account: { plan: free }, windows, balance, facts };
  }

  return { provider: "openrouter", name: "OpenRouter", account: {}, windows, balance, facts };
}

/** What the key spent inside its cap's own window: the reported remainder, else that window's use. */
function periodSpend(key: any, cap: number): number | undefined {
  const remaining = numeric(key.limit_remaining);
  if (remaining !== undefined) return cap - Math.min(cap, Math.max(0, remaining));
  const reset = text(key.limit_reset);
  const window =
    reset === "daily"
      ? numeric(key.usage_daily)
      : reset === "weekly"
        ? numeric(key.usage_weekly)
        : reset === "monthly"
          ? numeric(key.usage_monthly)
          : undefined;
  return window ?? numeric(key.usage);
}

function capRows(cap: number | undefined, remaining: number | undefined, usage: number | undefined, reset: unknown): [string, string][] {
  const rows: [string, string][] = [];
  if (cap !== undefined && cap > 0) {
    rows.push(["Spending cap", usd(cap)]);
    if (remaining !== undefined) rows.push(["Cap remaining", usd(Math.min(cap, Math.max(0, remaining)))]);
  } else {
    rows.push(["Spending cap", "None"]);
  }
  if (usage !== undefined) rows.push(["Key used", usd(usage)]);
  const words = text(reset);
  if (words) rows.push(["Reset window", words]);
  return rows;
}

/** The window a cap resets over, or how long one usually runs: what a pace needs. */
function resetLength(reset: unknown): number | undefined {
  switch (text(reset)) {
    case "daily":
      return DAY;
    case "weekly":
      return WEEK;
    case "monthly":
      return MONTH;
    default:
      return undefined;
  }
}

function kindOfReset(reset: unknown): Kind {
  switch (text(reset)) {
    case "daily":
      return "daily";
    case "weekly":
      return "weekly";
    case "monthly":
      return "monthly";
    default:
      return "named";
  }
}

/** `$12.34`. */
export function usd(value: number): string {
  const sign = value < 0 ? "-" : "";
  const cents = Math.round(Math.abs(value) * 100);
  return `${sign}$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** The `data` of OpenRouter's `{ "data": … }` envelope. */
function envelope(body: string | undefined): any {
  if (!body) return undefined;
  const answer = json(body);
  return answer?.data ?? undefined;
}
