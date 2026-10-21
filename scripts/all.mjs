#!/usr/bin/env bun
// `bun test` and `tsc --noEmit` in every package that has a package.json.
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dirs = [...new Set((await Bun.$`git ls-files -- '*/package.json' 'lib/*/package.json'`.cwd(root).text())
  .split("\n").filter(Boolean).map((f) => f.replace(/\/package\.json$/, "")))];
let failed = 0;
for (const dir of dirs) {
  const at = join(root, dir);
  const test = Bun.spawnSync(["bun", "test"], { cwd: at, stdout: "pipe", stderr: "pipe" });
  const type = Bun.spawnSync([join(at, "node_modules/.bin/tsc"), "--noEmit"], { cwd: at, stdout: "pipe", stderr: "pipe" });
  const ok = test.exitCode === 0 && type.exitCode === 0;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${dir}${ok ? "" : `\n${test.stderr.toString()}${type.stdout.toString()}`}`);
}
console.log(`\n${dirs.length - failed}/${dirs.length} packages pass`);
process.exit(failed ? 1 : 0);
