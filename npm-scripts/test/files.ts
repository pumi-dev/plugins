// What the tests' repositories are made of: a directory to put them in, and the files they hold.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An empty directory for one test's repository, removed by the test at the end. */
export function temp(name: string): string {
  return mkdtempSync(join(tmpdir(), `npm-scripts-${name}-`));
}

/** Writes a file of `root`, making its directories. */
export function write(root: string, path: string, text = ""): void {
  const at = join(root, path);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text);
}

/** A `package.json` holding `scripts`, and whatever else `fields` says. */
export function manifest(scripts: Record<string, unknown>, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...fields, scripts });
}
