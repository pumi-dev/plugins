#!/usr/bin/env bun
// The editor's page, built into `web/`: `index.html`, `editor.js` (Monaco's core, every editor
// contribution, the page's own code in `page/`), `editor.css` and the codicon font, a chunk per
// language's tokenizer (loaded when a file of it opens), and the workers whole in `web/workers/`.
// Nothing is fetched from the network at run time: the page loads from `pumi-plugin://`.
//
// Run after `bun install`, and after bumping `monaco-editor` (pinned in package.json). `web/` is
// committed, as `marmaide`'s vendored Pele is: a plugin is installed from its source, unbuilt.
import { build, type BunPlugin } from "bun";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { WORKERS } from "../page/workers.ts";

const here = resolve(import.meta.dir, "..");
const out = join(here, "web");
/** `monaco-editor/esm/vs`, wherever the install put the package (here, or the workspace's root). */
const vs = resolve(dirname(Bun.resolveSync("monaco-editor/editor/editor.api.js", here)), "..");
const { version } = JSON.parse(readFileSync(join(vs, "../../package.json"), "utf8"));

// `editor.main.js` is the whole of Monaco: its contributions, then every language. The page takes
// the contributions (its side-effect imports outside `languages/`) and picks its languages itself.
const main = readFileSync(join(vs, "editor/editor.main.js"), "utf8");
const contribs = [...main.matchAll(/^import '(\.{1,2}\/[^']+)';$/gm)]
  .map((m) => m[1])
  .filter((path) => !path.includes("/languages/"))
  .map((path) => join(vs, "editor", path));
if (!contribs.length) throw new Error(`no contributions in ${join(vs, "editor/editor.main.js")}: has its shape changed?`);

const contributions: BunPlugin = {
  name: "monaco-contribs",
  setup(b) {
    b.onResolve({ filter: /^monaco:contribs$/ }, () => ({ path: "contribs", namespace: "monaco" }));
    b.onLoad({ filter: /.*/, namespace: "monaco" }, () => ({
      contents: contribs.map((path) => `import ${JSON.stringify(path)};`).join("\n"),
      loader: "js",
    }));
  },
};

/** Fails the script with the bundler's own messages. */
function check(made: Awaited<ReturnType<typeof build>>, what: string): void {
  if (made.success) return;
  console.error(`${what}:`);
  for (const log of made.logs) console.error(String(log));
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

check(
  await build({
    entrypoints: [join(here, "page/editor.ts")],
    outdir: out,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: true,
    naming: { entry: "[name].[ext]", chunk: "chunks/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
    plugins: [contributions],
  }),
  "the page",
);

// A chunk's own sheet repeats `editor.css` (every chunk imports the editor's API, and so its CSS),
// and nothing loads it: only the entry's is the page's.
for (const name of readdirSync(join(out, "chunks"))) if (name.endsWith(".css")) rmSync(join(out, "chunks", name));

// Each worker is one file with nothing to import, so the page can start it from a blob.
const workers: Record<string, string> = {
  editor: join(vs, "editor/editor.worker.js"),
  ...Object.fromEntries([...new Set(Object.values(WORKERS))].map((name) => [name, join(vs, `languages/features/${name}/${name}.worker.js`)])),
};
for (const [name, entry] of Object.entries(workers)) {
  check(
    await build({ entrypoints: [entry], outdir: join(out, "workers"), target: "browser", format: "iife", minify: true, naming: `${name}.[ext]` }),
    `the ${name} worker`,
  );
}

copyFileSync(join(here, "page/index.html"), join(out, "index.html"));
copyFileSync(join(vs, "../../LICENSE"), join(out, "MONACO-LICENSE.txt"));

/** Every file under `dir`, with its size. */
function walk(dir: string): [string, number][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? walk(path) : [[relative(out, path), statSync(path).size] as [string, number]];
  });
}
const built = walk(out);
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
for (const [path, size] of built.filter(([path]) => !path.startsWith("chunks/"))) console.log(`  ${path.padEnd(32)} ${kb(size)}`);
const chunks = built.filter(([path]) => path.startsWith("chunks/"));
console.log(`  chunks/ (${chunks.length})${" ".repeat(20)} ${kb(chunks.reduce((n, [, size]) => n + size, 0))}`);
console.log(`web/: monaco-editor@${version}, ${kb(built.reduce((n, [, size]) => n + size, 0))}`);
