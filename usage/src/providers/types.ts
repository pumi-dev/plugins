// What a provider is: how it finds the sign-in this Mac already has, what that sign-in is allowed
// to ask, and how the answer becomes a report. The three are separate on purpose: the parsers are
// pure and tested against a service's own answers, and nothing but `signIn` touches the machine and
// nothing but `ask` touches the network.

import type { Report } from "../model.ts";

/** The machine's own ways of telling a provider where its sign-in is. */
export interface Env {
  /** `darwin`, `linux`, … */
  platform: string;
  /** The user's home directory, with no trailing slash. */
  home: string;
  /** An environment variable of the app. */
  env(name: string): string | undefined;
  /** A file's text, or null when it is not there or cannot be read. */
  read(path: string): string | null;
  /** A program's standard output, or null when it fails, is missing or takes too long. */
  run(argv: string[]): string | null;
}

/** A sign-in, as a request needs it. */
export interface Creds {
  token: string;
  /** The account the service itself called it (`me@example.com`, `octocat`). */
  account?: string;
  /** The plan the sign-in says it is on (`Max 20x`). */
  plan?: string;
}

/** One request a provider makes: everything but the network, which is the worker's. */
export interface Ask {
  url: string;
  headers: Record<string, string>;
}

export type ProviderId = "claude" | "codex" | "copilot" | "openrouter";

export interface Provider {
  id: ProviderId;
  /** Its name in the bar and the panel. */
  name: string;
  /** The secret option it takes when the machine has no sign-in of its own. */
  key?: string;
  /** Finds the sign-in this Mac has, `key` being its secret option's value when the user set one. */
  signIn(env: Env, key: string | undefined): Creds | null;
  /** What to ask, in order; the answers go to `parse` in the same order. */
  ask(creds: Creds): Ask[];
  /** The answers as a report. Throws a message worth showing when they do not make one. */
  parse(answers: string[], creds: Creds): Report;
}

/** A service's answer that cannot be used, said in words the panel can show. */
export class AnswerError extends Error {}

/** `body` as JSON, or the error a person can act on. */
export function json(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    throw new AnswerError("the service answered something that is not JSON");
  }
}

/** A number the service may send as a number or as a string; undefined for anything else. */
export function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** A string the service sent, when it is worth showing. */
export function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** `individual_pro` → `Individual pro`, `max` → `Max`. */
export function titleCase(value: string): string {
  const words = value.trim().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  return words.map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase())).join(" ");
}

/**
 * A moment a service sent, in ms since the epoch: Unix seconds or milliseconds, or a timestamp
 * string. Anything else is undefined, so a window without a reset is still a window.
 */
export function moment(value: unknown): number | undefined {
  const number = numeric(value);
  if (number !== undefined) {
    // Seconds until 1970 + 500 years; anything larger is already milliseconds.
    return number > 0 && number < 1e11 ? number * 1000 : number > 0 ? number : undefined;
  }
  const words = text(value);
  if (!words) return undefined;
  const parsed = Date.parse(words);
  return Number.isFinite(parsed) ? parsed : undefined;
}
