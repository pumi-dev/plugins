// Codex plan usage, read with the Codex CLI's ChatGPT sign-in, falling back to OpenCode's OpenAI
// OAuth sign-in (OpenCode renews and saves that token itself, so each read takes the file as it
// is). An API key has no plan usage to ask about.

import { DAY, MONTH, SESSION, WEEK, type Facts, type Kind, type Report, type Window } from "../model.ts";
import { json, moment, numeric, text, titleCase, type Ask, type Creds, type Env, type Provider } from "./types.ts";

const USAGE = "https://chatgpt.com/backend-api/wham/usage";
const AGENT = "codex-cli";

export const codex: Provider = { id: "codex", name: "Codex", signIn, ask, parse };

/** The ChatGPT sign-in the Codex CLI has, else OpenCode's. */
export function signIn(env: Env): Creds | null {
  const codexHome = env.env("CODEX_HOME")?.trim() || `${env.home}/.codex`;
  const auth = jsonOf(env.read(`${codexHome}/auth.json`));
  const own = text(auth?.tokens?.access_token);
  if (own) return { token: own, account: text(auth?.tokens?.account_id) };

  const data = env.env("XDG_DATA_HOME")?.trim() || `${env.home}/.local/share`;
  const opencode = jsonOf(env.read(`${data}/opencode/auth.json`));
  if (text(opencode?.openai?.type) !== "oauth") return null;
  const token = text(opencode?.openai?.access);
  return token ? { token, account: text(opencode?.openai?.accountId) } : null;
}

export function ask(creds: Creds): Ask[] {
  const headers: Record<string, string> = {
    authorization: `Bearer ${creds.token}`,
    "user-agent": AGENT,
    "openai-beta": "codex-1",
    originator: "Codex Desktop",
    accept: "application/json",
  };
  // The account id is a ChatGPT account, not a secret to log: it picks which one to report.
  if (creds.account) headers["chatgpt-account-id"] = creds.account;
  return [{ url: USAGE, headers }];
}

export function parse(answers: string[], creds: Creds): Report {
  const usage = json(answers[0] ?? "");
  const windows = limits(usage?.rate_limit);
  const facts: Facts[] = [];
  const review = limits(usage?.code_review_rate_limit)[0];
  if (review) facts.push({ title: "Code review", rows: [[review.title, `${Math.round(review.used)}% used`]] });
  const credits = usage?.credits;
  if (credits && typeof credits === "object") {
    const unlimited = credits.unlimited === true;
    const balance = text(credits.balance);
    facts.push({ title: "Credits", rows: [["Balance", unlimited ? "Unlimited" : (balance ?? "0")]] });
  }
  const resets = numeric(usage?.rate_limit_reset_credits?.available_count);
  if (resets !== undefined) facts.push({ title: "Limit reset credits", rows: [["Available", String(resets)]] });
  const account = {
    email: text(usage?.email) ?? creds.account,
    plan: titleCase(text(usage?.plan_type) ?? creds.plan ?? "") || undefined,
  };
  return { provider: "codex", name: "Codex", account, windows, facts };
}

/** A pair of windows: which slot they arrive in only matters when their length is unfamiliar. */
function limits(side: any): Window[] {
  const windows: Window[] = [];
  for (const [slot, row] of [
    ["session", side?.primary_window],
    ["weekly", side?.secondary_window],
  ] as const) {
    if (!row || typeof row !== "object") continue;
    const used = numeric(row.used_percent);
    if (used === undefined) continue;
    const seconds = numeric(row.limit_window_seconds);
    const kind = kindOf(seconds, slot === "session" ? "session" : "weekly");
    windows.push({
      kind,
      title: TITLES[kind],
      used,
      resetsAt: moment(row.reset_at),
      length: seconds !== undefined && seconds > 0 ? seconds * 1000 : LENGTHS[kind],
    });
  }
  return windows;
}

const TITLES: Record<Kind, string> = { session: "Session", daily: "Daily", weekly: "Weekly", monthly: "Monthly", named: "Limit" };
const LENGTHS: Record<Kind, number> = { session: SESSION, daily: DAY, weekly: WEEK, monthly: MONTH, named: WEEK };

/** A window is known by its length; which slot it came in decides only when the length is missing. */
export function kindOf(seconds: number | undefined, fallback: Kind): Kind {
  if (seconds === undefined || seconds <= 0) return fallback;
  const ms = seconds * 1000;
  const near = (length: number) => Math.abs(ms - length) <= 2 * 60_000;
  if (near(SESSION)) return "session";
  if (near(DAY)) return "daily";
  if (near(WEEK)) return "weekly";
  if (near(MONTH)) return "monthly";
  return fallback;
}

function jsonOf(body: string | null | undefined): any | undefined {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
