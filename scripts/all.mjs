#!/usr/bin/env bun
// `bun test` and `tsc --noEmit` in every package that has a package.json — all of them at once, so
// the whole workspace is checked in about as long as its slowest package. A package with no tests
// (a theme, say) is not a failure: `--passWithNoTests` says so.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

/** Every package here: the folders beside this one, and `lib/`'s. */
const packages = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "scripts" && entry.name !== "target")
  .flatMap((entry) => (entry.name === "lib" ? readdirSync(join(root, "lib")).map((name) => `lib/${name}`) : [entry.name]))
  .filter((p) => existsSync(join(root, p, "package.json")));

/** Runs `cmd` in `at`; answers its combined output and whether it passed. */
async function run(at, cmd) {
  const proc = Bun.spawn(cmd, { cwd: at, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { ok: code === 0, out: `${out}${err}` };
}

const results = await Promise.all(
  packages.map(async (p) => {
    const at = join(root, p);
    const tsc = join(at, "node_modules/.bin/tsc");
    const [test, types] = await Promise.all([
      run(at, ["bun", "test", "--passWithNoTests"]),
      existsSync(tsc) ? run(at, [tsc, "--noEmit", "-p", "."]) : { ok: true, out: "" },
    ]);
    return { p, test, types };
  }),
);

let failed = 0;
for (const { p, test, types } of results.sort((a, b) => a.p.localeCompare(b.p))) {
  const ok = test.ok && types.ok;
  if (!ok) failed++;
  const ran = test.out.match(/Ran (\d+) tests?/)?.[1] ?? "0";
  console.log(`${ok ? "ok  " : "FAIL"} ${p}${ok ? ` · ${ran} tests` : ""}`);
  if (!test.ok) console.log(test.out.trim().split("\n").slice(-12).map((line) => `     ${line}`).join("\n"));
  if (!types.ok) console.log(types.out.trim().split("\n").slice(0, 12).map((line) => `     ${line}`).join("\n"));
}
console.log(`\n${packages.length - failed}/${packages.length} packages pass`);
process.exit(failed ? 1 : 0);
