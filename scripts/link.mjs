#!/usr/bin/env bun
// Links the pumi checkout's SDK into every package as `@pumid/types`, so each package's
// `tsc` reaches `pumi` without npm (`@pumid/types` is not published yet). Re-run after adding a
// package.
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const pumi = resolve(process.env.PUMI_SRC ?? join(root, "..", "pumi"));
// The SDK's types: the app's two halves as one module (`runtime/app/types`). A package's
// `main.ts` and `ui.tsx` are given the two halves by the app at run time.
const sdk = join(pumi, "runtime/app/types");
// The dependencies a package's tsconfig names, from the app's own install.
const deps = join(pumi, "runtime/app/node_modules");
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
    // A link whose target is gone still exists (`existsSync` follows it): check the link itself.
    try {
      unlinkSync(to);
    } catch {}
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
  if (existsSync(join(deps, "typescript/bin/tsc"))) link(join(deps, "typescript/bin/tsc"), join(dir, ".bin", "tsc"));
  for (const dep of ["@types", "bun-types", "typescript", "undici-types"]) {
    if (!existsSync(join(deps, dep))) continue;
    mkdirSync(dirname(join(dir, dep)), { recursive: true });
    link(join(deps, dep), join(dir, dep));
  }
}
console.log(`linked @pumid/types into ${packages.length} package(s)`);
