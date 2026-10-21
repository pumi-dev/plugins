// The two socket files: a live owner is left alone, a crashed one is taken over, and a reload's
// brief overlap is waited out rather than lost.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { listen, type Listener } from "../src/listen.ts";

const dirs: string[] = [];
const listeners: Listener[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "heeler-listen-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const listener of listeners.splice(0)) listener.stop(true);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("listen", () => {
  test("serves a path, and a file a crash left behind is taken over", async () => {
    const path = join(temp(), "herdr.sock");
    writeFileSync(path, "");
    const listener = await listen(path, { data() {} });
    listeners.push(listener);
    expect(existsSync(path)).toBe(true);
  });

  test("a reload's overlap is waited out: the new listener binds once the old stops", async () => {
    const path = join(temp(), "herdr.sock");
    const first = await listen(path, { data() {} });
    listeners.push(first);
    let bound = false;
    const second = listen(path, { data() {} }).then((listener) => {
      bound = true;
      listeners.push(listener);
      return listener;
    });
    await Bun.sleep(250);
    expect(bound).toBe(false);
    first.stop(true);
    await second;
    expect(bound).toBe(true);
  }, 10_000);
});
