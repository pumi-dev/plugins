// What a files test's project is made of: a scratch directory to put it in, the files it holds, and
// the rows a panel answered, by key.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Row } from "../src/row.ts";

/** An empty directory for one test's project, named after what it is for. */
export function scratch(name: string): string {
  return mkdtempSync(join(tmpdir(), `pumi-files-${name}-`));
}

/** Writes a file of `root`, making its directories. */
export function write(root: string, path: string, text = ""): void {
  const at = join(root, path);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, text);
}

/** The rows' keys, in the order the tree draws them. */
export function keys(rows: Row[]): string[] {
  return rows.map((row) => row.key);
}

/** The row a key names: the tree's answer about that entry. */
export function rowOf(rows: Row[], key: string): Row {
  const found = rows.find((row) => row.key === key);
  if (!found) throw new Error(`no row ${key}: the tree has ${rows.map((row) => row.key).join(", ")}`);
  return found;
}
