// Finding a session file and following it as it grows, on files in a temporary directory.
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claudeProjectName, locate, piProjectName } from "../src/locate.ts";
import { Tail } from "../src/tail.ts";

const home = mkdtempSync(join(tmpdir(), "chat-ui-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("locate", () => {
  test("each agent's layout, from the session id and the directory", () => {
    expect(claudeProjectName("/Users/me/src/my.app")).toBe("-Users-me-src-my-app");
    expect(piProjectName("/Users/me/src")).toBe("--Users-me-src--");
    const claude = join(home, ".claude/projects/-elsewhere/abc.jsonl");
    const codex = join(home, ".codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-def.jsonl");
    const pi = join(home, ".pi/agent/sessions/--work--/2026-01-02T10-00-00-000Z_ghi.jsonl");
    for (const file of [claude, codex, pi]) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "");
    }
    const where = { cwd: "/work", home, env: {} };
    // A resumed Claude session stays in the folder it began in.
    expect(locate("claude", "claude", { ...where, session: "abc" })).toBe(claude);
    expect(locate("codex", "codex", { ...where, session: "def" })).toBe(codex);
    expect(locate("pi", "pi", { ...where, session: "ghi" })).toBe(pi);
    expect(locate("pi", "pi", { ...where, session: "none" })).toBeUndefined();
    expect(locate("claude", "claude", { ...where, transcript: codex })).toBe(codex);
  });
});

describe("Tail", () => {
  test("the end of the file at first, whole lines after, a line still being written held back", () => {
    const file = join(home, "tail.jsonl");
    writeFileSync(file, `${"x".repeat(50)}\n{"n":1}\n{"n":2}\n`);
    const seen: { lines: string[]; first: boolean; skipped: boolean }[] = [];
    const tail = new Tail(file, { max: 20, interval: 60_000, onLines: (lines, first, skipped) => seen.push({ lines, first, skipped }), onReset: () => seen.push({ lines: ["reset"], first: false, skipped: false }) });
    tail.start();
    appendFileSync(file, '{"n":3}\n{"n":');
    tail.poll();
    appendFileSync(file, "4}\n");
    tail.poll();
    writeFileSync(file, "");
    tail.poll();
    tail.stop();
    expect(seen).toEqual([
      { lines: ['{"n":1}', '{"n":2}'], first: true, skipped: true },
      { lines: ['{"n":3}'], first: false, skipped: false },
      { lines: ['{"n":4}'], first: false, skipped: false },
      { lines: ["reset"], first: false, skipped: false },
    ]);
  });
});
