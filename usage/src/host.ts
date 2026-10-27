// The worker's own reaches: this Mac's files and programs, and the network. Everything a provider
// needs from the machine comes through `MACHINE`, so what a read of a plan costs is visible in one
// file: a couple of files, `security` or `gh` when a token lives in a keychain, and one request.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import type { Answer, Http } from "./gather.ts";
import type { Env } from "./providers/index.ts";

/** A service that has not answered by now is not worth waiting for: the plugin reads again later. */
const TIMEOUT = 20_000;
/** `security` and `gh` answer at once; one that does not is a prompt nobody is looking at. */
const PROGRAM_TIMEOUT = 5_000;

const HOME = homedir().replace(/\/+$/, "");

/**
 * The paths a program is looked for in. An app started from the Finder has a `PATH` of the system's
 * own, which is where a Homebrew or a hand-installed `gh` is not: `run` adds the usual places.
 */
function searchPath(): string {
  const places = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", `${HOME}/.local/bin`, `${HOME}/bin`];
  return places.filter(Boolean).join(":");
}

export const MACHINE: Env = {
  platform: process.platform,
  home: HOME,
  env: (name) => process.env[name],
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  run: (argv) => {
    try {
      const program = Bun.spawnSync(argv, {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
        env: { ...process.env, PATH: searchPath() },
        timeout: PROGRAM_TIMEOUT,
      });
      return program.success ? program.stdout.toString() : null;
    } catch {
      return null;
    }
  },
};

export const http: Http = async (url, headers, signal): Promise<Answer> => {
  const answer = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(TIMEOUT) });
  return { status: answer.status, body: await answer.text() };
};
