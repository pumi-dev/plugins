// The session the strip speaks of: what pi's hook reported, and the id and summary read from it.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FakeApp } from "pumi/testing";

import { headerId, isId, nameId, Session } from "../src/session.ts";
import { dir } from "./fake.ts";

const ID = "0198c3e2-7a51-7c62-9a53-3f1a2b4c5d6e";
let app: FakeApp;
afterEach(() => app?.stop());

/** A file `name` holding `text`, in a directory of its own. */
function file(name: string, text: string): string {
  const at = join(mkdtempSync(join(tmpdir(), "pi-session-")), name);
  writeFileSync(at, text);
  return at;
}

test("a session is known by its id, or its file's name", () => {
  expect(isId(ID)).toBe(true);
  expect(isId("not-an-id")).toBe(false);
  expect(isId(ID.replace("7a51", "7a5-"))).toBe(false);
  expect(nameId(`/s/2026-10-17T10-00-00_${ID}.jsonl`)).toBe(ID);
  expect(nameId(`/s/2026-10-17T10-00-00_nope.jsonl`)).toBeNull();
  expect(nameId("/s/session.jsonl")).toBeNull();
  expect(new Session(ID, "/repo").summary()).toBe(`pi session ${ID}\ncwd:  /repo`);
});

test("a session file's id is its name's, or its first record's", () => {
  const named = file(`2026-10-17T10-00-00_${ID}.jsonl`, `${JSON.stringify({ type: "session", id: ID })}\n`);
  expect(nameId(named)).toBe(ID);
  expect(headerId(named)).toBe(ID);
  const header = file("sessions.jsonl", `${JSON.stringify({ type: "session", id: ID })}\n{"type":"message"}\n`);
  expect(nameId(header)).toBeNull();
  expect(headerId(header)).toBe(ID);
  expect(headerId(join(import.meta.dir, "no-such-file.jsonl"))).toBeNull();
  expect(headerId(file("other.jsonl", `${JSON.stringify({ type: "message" })}\n`))).toBeNull();
  expect(headerId(file("broken.jsonl", "not json\n"))).toBeNull();
});

test("a session file is known by its path and directory", () => {
  const path = `/s/2026-10-17T10-00-00_${ID}.jsonl`;
  expect(new Session(path, null).id()).toBe(ID);
  expect(new Session(path, null).summary()).toBe(`pi session ${ID}\npath: ${path}`);
  expect(new Session(path, "/repo").summary()).toBe(`pi session ${ID}\npath: ${path}\ncwd:  /repo`);
});

test("a session is read from its pane when the buttons act", async () => {
  app = new FakeApp({ dir });
  app.answer("option.get", (name: string, opts?: { pane?: number | null }) => {
    if (opts?.pane !== 7) return null;
    return { "@agent": "pi", "@agent_session": ID, pane_current_path: "/repo" }[name] ?? null;
  });
  await app.connect();
  const session = await Session.of(7);
  expect(session.value).toBe(ID);
  expect(session.cwd).toBe("/repo");
  await expect(Session.of(8)).rejects.toThrow("pi has not said which session it is in");
});
