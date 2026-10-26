// What a plan's usage is, in the terms the panel shows: which limit windows it has, how
// much of each is used, when each resets, and how its spend compares with the window's own length.
// Nothing here talks to a service or to pumi: the providers fill this in, and `ui.tsx` draws it.

/** Which limit a window measures. `named` is one the service names itself (`Weekly · Opus`). */
export type Kind = "session" | "daily" | "weekly" | "monthly" | "named";

export interface Window {
  kind: Kind;
  /** What to call it: `Session`, `Weekly`, `Premium`, `Weekly · Opus`. */
  title: string;
  /** Percent used, 0..100. */
  used: number;
  /** When it resets, ms since the epoch, when the service says. */
  resetsAt?: number;
  /** How long the window runs, in ms, when it is known: a pace needs both this and `resetsAt`. */
  length?: number;
}

export interface Account {
  email?: string;
  plan?: string;
}

/** A section of a provider's detail: balances, credits, the surfaces a week was spent on. */
export interface Facts {
  title: string;
  rows: [string, string][];
}

/** What one plan answered: its account, its windows, and whatever else is worth saying. */
export interface Report {
  provider: string;
  name: string;
  account: Account;
  windows: Window[];
  /** Money or credits, when the service meters that as well as (or instead of) windows. */
  balance?: string;
  facts?: Facts[];
}

/** One plan as the window has it: its numbers and, when the last read failed, why. */
export interface Reading {
  provider: string;
  name: string;
  /** The last good numbers. Missing while a plan has never answered. */
  report?: Report;
  /** Why the latest read failed; `report`, if there is one, stands. */
  error?: string;
  /** When `report` was read, ms since the epoch. */
  at?: number;
  /** When the read under way finished, whether it worked or not. */
  checkedAt?: number;
}

/** Every plan read, as one message from the worker to its views. */
export interface Snapshot {
  /** When the snapshot was finished. */
  at: number;
  readings: Reading[];
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;
export const SESSION = 5 * HOUR;

/** A window's use, as a percentage from 0 to 100 with nothing outside it. */
export function percent(used: number): number {
  if (!Number.isFinite(used)) return 0;
  return Math.min(100, Math.max(0, used));
}

/** What is left of a window, from 0 to 100. */
export function left(used: number): number {
  return 100 - percent(used);
}

/** The window closest to its limit; on a tie, the first the service listed. */
export function tightest(windows: Window[] | undefined): Window | undefined {
  let best: Window | undefined;
  for (const window of windows ?? []) {
    if (!best || percent(window.used) > percent(best.used)) best = window;
  }
  return best;
}

/** How much of a window's length has gone by, in percent; none without both a length and a reset. */
export function expected(w: Window, now: number): number | undefined {
  if (!w.length || w.length <= 0 || w.resetsAt === undefined) return undefined;
  const remaining = Math.min(Math.max(w.resetsAt - now, 0), w.length);
  return ((w.length - remaining) / w.length) * 100;
}

/** Whether a window is spending faster than its own length: more used than has gone by, by 5 points. */
export function ahead(w: Window, now: number): boolean {
  const pace = expected(w, now);
  return pace !== undefined && percent(w.used) > pace + 5;
}

/** `2h 53m`, `6d 4h`, `<1m`: an amount of time as short words. */
export function countdown(ms: number): string {
  if (!(ms > 0)) return "now";
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const leftOver = hours % 24;
  return leftOver ? `${days}d ${leftOver}h` : `${days}d`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Days between two moments, by their calendar dates in local time. */
function daysBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const at = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bt = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((at - bt) / DAY);
}

/** `14:30`, `tomorrow 09:00`, `Mon 09:00`, `Nov 3`: when a moment is, by local time. */
export function clock(at: number, now: number): string {
  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const days = daysBetween(at, now);
  if (days <= 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${WEEKDAYS[date.getDay()]} ${time}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** How the user asked a window's reset to be said. */
export type Resets = "countdown" | "clock" | "off";

/** When a window resets, in the words the setting asked for; none when it does not say. */
export function resetText(w: Window, now: number, style: Resets): string | undefined {
  if (style === "off" || w.resetsAt === undefined) return undefined;
  return style === "clock" ? clock(w.resetsAt, now) : countdown(w.resetsAt - now);
}

/** How urgent a window is at the shares the user chose. */
export type Band = "normal" | "warning" | "critical";

export function band(used: number, warnAt: number, critAt: number): Band {
  const value = percent(used);
  if (value >= critAt) return "critical";
  if (value >= warnAt) return "warning";
  return "normal";
}

/** `just now`, `3m ago`, `2h ago`: how long ago something was read. */
export function ago(at: number | undefined, now: number): string {
  if (at === undefined) return "never";
  const ms = now - at;
  if (!(ms > 0)) return "just now";
  if (ms < MINUTE) return "just now";
  return `${countdown(ms)} ago`;
}

/** A window's title and its share, as the tooltip and the panel open with: `Weekly · Opus: 42%`. */
export function describeWindow(w: Window, now: number, style: Resets): string {
  const reset = resetText(w, now, style);
  return `${w.title}: ${Math.round(percent(w.used))}% used${reset ? `, resets in ${reset}` : ""}`;
}

/** One line per window, as `describeWindow` says each. */
export function describeWindows(report: Report | undefined, now: number, style: Resets): string[] {
  if (!report) return [];
  return report.windows.map((w) => describeWindow(w, now, style));
}
