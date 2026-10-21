#!/usr/bin/env bun
// Links the pumi checkout's SDK into every package as `@pumid/types`, so each package's
// `bun test` and `tsc` reach `pumi` and `pumi/testing` without npm (`@pumid/types` is not
// published yet). Re-run after adding a package.
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const pumi = resolve(process.env.PUMI_SRC ?? join(root, "..", "pumi"));
const sdk = join(pumi, "runtime/bun/sdk");
const types = join(pumi, "runtime/bun/node_modules");
if (!existsSync(sdk)) {
  console.error(`no SDK at ${sdk}: is pumi checked out beside this one? (or set PUMI_SRC)`);
  process.exit(1);
}
const packages = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^(?!\.|node_modules|scripts|target)/.test(e.name))
  .flatMap((e) => (e.name === "lib" ? readdirSync(join(root, e.name)).map((n) => `lib/${n}`) : [e.name]))
  .filter((p) => existsSync(join(root, p, "package.json")));

for (const p of packages) {
  const dir = join(root, p, "node_modules");
  mkdirSync(join(dir, "@pumid"), { recursive: true });
  const link = (from, to) => {
    if (existsSync(to)) unlinkSync(to);
    symlinkSync(from, to);
  };
  link(sdk, join(dir, "@pumid", "types"));
  // A dependency on another package in this repository (`file:`-like), e.g. "script-panel".
  const manifest = JSON.parse(readFileSync(join(root, p, "package.json"), "utf8"));
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    const local = packages.find((q) => {
      const file = join(root, q, "package.json");
      return existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === dep;
    });
    if (local) link(join(root, local), join(dir, dep));
  }
  mkdirSync(join(dir, ".bin"), { recursive: true });
  if (existsSync(join(types, "typescript/bin/tsc"))) link(join(types, "typescript/bin/tsc"), join(dir, ".bin", "tsc"));
  for (const dep of ["@types", "bun-types", "typescript", "undici-types"]) {
    if (!existsSync(join(types, dep))) continue;
    mkdirSync(dirname(join(dir, dep)), { recursive: true });
    link(join(types, dep), join(dir, dep));
  }
}
console.log(`linked @pumid/types into ${packages.length} package(s)`);
