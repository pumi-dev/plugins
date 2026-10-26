// One read of every plan: find the sign-in each provider has, ask its service, and turn the answer
// into a reading. A provider that fails keeps the numbers it had, marked with why, rather than
// blanking them; a provider with no sign-in is left out, so the bar shows only plans that exist on
// this machine (or that the user hid).
//
// Nothing here reaches the machine or the network itself: `env` and `http` are the worker's, which
// is what makes the whole of it testable without either.

import type { Reading, Snapshot } from "./model.ts";
import { PROVIDERS, type Env, type Provider } from "./providers/index.ts";
import type { Settings } from "./settings.ts";

/** A service's answer: its status and body. What a request carries is the provider's `Ask`. */
export interface Answer {
  status: number;
  body: string;
}

export type Http = (url: string, headers: Record<string, string>, signal?: AbortSignal) => Promise<Answer>;

export interface GatherOptions {
  env: Env;
  settings: Settings;
  /** The secret options' values, by option name (`copilot_token`). */
  keys?: Record<string, string | undefined>;
  http: Http;
  /** The last readings, whose numbers stand when a read fails. */
  previous?: Reading[];
  /** The plans to read; every one by default, which is what the worker uses. */
  providers?: Provider[];
  now?: number;
  signal?: AbortSignal;
}

/** Reads every plan that is shown and signed in. */
export async function gather(options: GatherOptions): Promise<Snapshot> {
  const { env, settings, keys = {}, http, previous = [], providers = PROVIDERS, now = Date.now() } = options;
  const last = new Map(previous.map((reading) => [reading.provider, reading]));
  const readings: Reading[] = [];
  for (const provider of providers) {
    if (settings[provider.id] === false) continue;
    const before = last.get(provider.id);
    try {
      const creds = provider.signIn(env, provider.key ? keys[provider.key] : undefined);
      if (!creds) continue;
      const answers: string[] = [];
      for (const ask of provider.ask(creds)) {
        const answer = await http(ask.url, ask.headers, options.signal);
        answers.push(answered(answer, provider.name));
      }
      const report = provider.parse(answers, creds);
      readings.push({ provider: provider.id, name: provider.name, report, at: now, checkedAt: now });
    } catch (err) {
      readings.push({
        provider: provider.id,
        name: provider.name,
        report: before?.report,
        error: message(err),
        at: before?.at,
        checkedAt: now,
      });
    }
  }
  return { at: now, readings };
}

/** A body worth parsing, or the reason this service's answer is not. */
function answered(answer: Answer, name: string): string {
  if (answer.status === 401 || answer.status === 403) {
    throw new Error(`${name} refused the sign-in: sign in again, or set a key in Settings`);
  }
  if (answer.status === 429) throw new Error(`${name} is rate limiting its usage endpoint: it will be asked again later`);
  if (answer.status < 200 || answer.status >= 300) throw new Error(`${name} answered ${answer.status}`);
  return answer.body;
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
