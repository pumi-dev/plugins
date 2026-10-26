// The machine a provider reads, made without one: files, environment variables and programs, each
// answer written by the test. `gather`'s network is a function too, so a whole read is exercised
// without a service, a keychain or a token.

import type { Answer, Http } from "../src/gather.ts";
import type { Env } from "../src/providers/index.ts";

export interface Machine {
  files?: Record<string, string>;
  vars?: Record<string, string>;
  /** A program's answer, by its command line (`security find-generic-password -s X -w`). */
  programs?: Record<string, string>;
  platform?: string;
  home?: string;
}

export function machine(made: Machine = {}): Env {
  const files = made.files ?? {};
  return {
    platform: made.platform ?? "darwin",
    home: made.home ?? "/Users/me",
    env: (name) => made.vars?.[name],
    read: (path) => (path in files ? files[path] : null),
    run: (argv) => made.programs?.[argv.join(" ")] ?? null,
  };
}

/** A network whose answers are listed by URL, in order; anything else is a 404. */
export function network(answers: Record<string, Answer | Answer[]>): Http & { asked: { url: string; headers: Record<string, string> }[] } {
  const taken = new Map<string, number>();
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const http = (async (url: string, headers: Record<string, string>) => {
    asked.push({ url, headers });
    const listed = answers[url];
    if (!listed) return { status: 404, body: "" };
    if (Array.isArray(listed)) {
      const at = taken.get(url) ?? 0;
      taken.set(url, at + 1);
      return listed[Math.min(at, listed.length - 1)];
    }
    return listed;
  }) as Http & { asked: typeof asked };
  http.asked = asked;
  return http;
}

/** A body, as a service would send it. */
export function ok(body: unknown): Answer {
  return { status: 200, body: typeof body === "string" ? body : JSON.stringify(body) };
}
