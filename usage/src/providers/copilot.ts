// GitHub Copilot: premium requests and chat, from GitHub's own `copilot_internal/user`. The token
// is the one the user gave the plugin, else `COPILOT_API_TOKEN`, else what `gh auth token` answers,
// else `gh`'s own keychain item (the app's `PATH` need not have `gh`), else the sign-in a Copilot
// editor plugin keeps in `github-copilot/apps.json` (or the older `hosts.json`). A GitHub token of
// the account with Copilot works for all of them.

import { MONTH, type Facts, type Report, type Window } from "../model.ts";
import { json, numeric, text, titleCase, type Ask, type Creds, type Env, type Provider } from "./types.ts";

const USER = "https://api.github.com/copilot_internal/user";
/** The OAuth app copilot.vim and the Copilot language server sign in with. */
const PLUGIN_APP = "github.com:Iv1.b507a08c87ecfe98";
/** `gh` keeps its token in the login keychain under this service, as `go-keyring` writes it. */
const GH_KEYCHAIN = "gh:github.com";
const GO_KEYRING = "go-keyring-base64:";

export const copilot: Provider = { id: "copilot", name: "Copilot", key: "copilot_token", signIn, ask, parse };

/** The GitHub token this machine has for Copilot: the user's own first. */
export function signIn(env: Env, key: string | undefined): Creds | null {
  const given = key?.trim();
  if (given) return { token: given };
  const variable = env.env("COPILOT_API_TOKEN")?.trim();
  if (variable) return { token: variable };
  const gh = env.run(["gh", "auth", "token"])?.trim() || keychain(env);
  if (gh) return { token: gh };
  const config = env.env("XDG_CONFIG_HOME")?.trim() || `${env.home}/.config`;
  const apps = jsonOf(env.read(`${config}/github-copilot/apps.json`));
  if (apps && typeof apps === "object") {
    const own = text(apps[PLUGIN_APP]?.oauth_token);
    if (own) return { token: own };
    for (const app of Object.values<any>(apps)) {
      const token = text(app?.oauth_token);
      if (token) return { token };
    }
  }
  const hosts = jsonOf(env.read(`${config}/github-copilot/hosts.json`));
  const hosted = text(hosts?.["github.com"]?.oauth_token);
  return hosted ? { token: hosted } : null;
}

/**
 * `gh`'s token as its own keychain item holds it, which is what an app launched without a shell's
 * `PATH` needs: `go-keyring` stores it base64-encoded, under a prefix that says so.
 */
export function keychain(env: Env): string | undefined {
  if (env.platform !== "darwin") return undefined;
  const found = env.run(["security", "find-generic-password", "-s", GH_KEYCHAIN, "-w"])?.trim();
  if (!found) return undefined;
  if (!found.startsWith(GO_KEYRING)) return found;
  try {
    return Buffer.from(found.slice(GO_KEYRING.length), "base64").toString("utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function ask(creds: Creds): Ask[] {
  return [
    {
      url: USER,
      headers: {
        authorization: `token ${creds.token}`,
        accept: "application/json",
        "editor-version": "vscode/1.96.2",
        "editor-plugin-version": "copilot-chat/0.26.7",
        "user-agent": "GitHubCopilotChat/0.26.7",
        "x-github-api-version": "2025-04-01",
      },
    },
  ];
}

export function parse(answers: string[], creds: Creds): Report {
  const usage = json(answers[0] ?? "");
  const resetsAt = resetTime(text(usage?.quota_reset_date));
  const snapshots = usage?.quota_snapshots ?? {};
  const monthly = usage?.monthly_quotas ?? {};
  const limited = usage?.limited_user_quotas ?? {};
  const rows: [string, string][] = [];
  const windows: Window[] = [];
  const premium = snapshot(snapshots.premium_interactions);
  const chat = snapshot(snapshots.chat);
  for (const [title, snap, older] of [
    ["Premium", premium, fallback(monthly.completions, limited.completions)],
    ["Chat", chat, fallback(monthly.chat, limited.chat)],
  ] as const) {
    if (snap?.unlimited) {
      rows.push([title, "Unlimited"]);
      continue;
    }
    const used = snap?.used ?? older;
    if (used === undefined) continue;
    windows.push({ kind: "named", title, used, resetsAt, length: MONTH });
    if (snap?.remaining !== undefined && snap.entitlement !== undefined) {
      rows.push([title, `${Math.round(snap.remaining)} of ${Math.round(snap.entitlement)} left`]);
    }
  }
  const plan = text(usage?.copilot_plan);
  const account = { email: text(usage?.login) ?? creds.account, plan: plan ? titleCase(plan) : creds.plan };
  const facts: Facts[] = [];
  if (rows.length) facts.push({ title: "Quotas", rows });
  const credits = numeric(snapshots.premium_interactions?.credits_used);
  if (credits !== undefined && (usage?.token_based_billing === true || premium?.unlimited || credits > 0)) {
    facts.push({ title: "Credits", rows: [["Used", String(Math.round(credits))]] });
  }
  return { provider: "copilot", name: "Copilot", account, windows, facts };
}

interface Snapshot {
  used?: number;
  remaining?: number;
  entitlement?: number;
  unlimited: boolean;
}

/** One quota as the response states it; `used` is undefined for unlimited and empty placeholders. */
function snapshot(raw: any): Snapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const unlimited = raw.unlimited === true;
  const entitlement = numeric(raw.entitlement);
  const remaining = numeric(raw.remaining);
  const leftPercent = numeric(raw.percent_remaining);
  const empty = entitlement === 0 && remaining === 0;
  const left = leftPercent ?? (entitlement !== undefined && entitlement > 0 && remaining !== undefined ? (remaining / entitlement) * 100 : undefined);
  return {
    unlimited,
    entitlement,
    remaining,
    used: unlimited || empty || left === undefined ? undefined : Math.max(0, 100 - left),
  };
}

/** A share from the older `monthly_quotas` / `limited_user_quotas` counts. */
function fallback(total: unknown, remaining: unknown): number | undefined {
  const all = numeric(total);
  const left = numeric(remaining);
  if (all === undefined || all <= 0 || left === undefined) return undefined;
  return 100 - Math.min(100, Math.max(0, (left / all) * 100));
}

/** `2025-02-01` or a full timestamp, taken as UTC. */
function resetTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function jsonOf(body: string | null | undefined): any | undefined {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
