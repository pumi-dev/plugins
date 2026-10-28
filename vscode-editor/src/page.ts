// The editor's page, built into `web/` the first time the plugin runs, and again when `page/` or
// `monaco-editor` changes: `index.html`, `editor.js` (Monaco's core, every editor contribution, the
// page's own code in `page/`), `editor.css` and the codicon font, a chunk per language's tokenizer
// (loaded when a file of it opens), and the workers whole in `web/workers/`. `monaco-editor` is the
// plugin's npm dependency, so nothing built is kept in git and nothing is fetched at run time: the
// page loads from `pumi-plugin://`.
import { build, type BunPlugin } from "bun";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { WORKERS } from "../page/workers.ts";

const here = resolve(import.meta.dir, "..");
/** Where the page is served from (the WebView's `web/index.html`). */
export const WEB = join(here, "web");
/** What the page in `web/` was built from: Monaco's version and the page's sources. */
const STAMP = ".built";

/** `monaco-editor/esm/vs`, wherever the install put the package. */
function monaco(): { vs: string; version: string } {
  const vs = resolve(dirname(Bun.resolveSync("monaco-editor/editor/editor.api.js", here)), "..");
  const { version } = JSON.parse(readFileSync(join(vs, "../../package.json"), "utf8")) as { version: string };
  return { vs, version };
}

/** What a build of the page now would be from. */
function stampOf(version: string): string {
  const page = join(here, "page");
  const sources = readdirSync(page)
    .filter((name) => /\.(ts|html)$/.test(name))
    .sort()
    .map((name) => `${name}:${Bun.hash(readFileSync(join(page, name))).toString(36)}`);
  return [`monaco-editor@${version}`, ...sources].join("\n");
}

/** Fails with the bundler's own messages. */
function check(made: Awaited<ReturnType<typeof build>>, what: string): void {
  if (made.success) return;
  throw new Error(`${what}: ${made.logs.map(String).join("\n")}`);
}

/** Builds the page into `out`. */
export async function buildPage(out: string): Promise<void> {
  const { vs } = monaco();
  // `editor.main.js` is the whole of Monaco: its contributions, then every language. The page takes
  // the contributions (its side-effect imports outside `languages/`) and picks its languages itself.
  const main = readFileSync(join(vs, "editor/editor.main.js"), "utf8");
  const contribs = [...main.matchAll(/^import '(\.{1,2}\/[^']+)';$/gm)]
    .map((m) => m[1]!)
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
  const chunks = join(out, "chunks");
  if (existsSync(chunks)) for (const name of readdirSync(chunks)) if (name.endsWith(".css")) rmSync(join(chunks, name));

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
}

/** `web/`, built unless it already is from these sources. A build goes to a folder beside it and
 *  takes its place whole, so a page never loads half of one. */
export async function ensurePage(): Promise<void> {
  const stamp = stampOf(monaco().version);
  const at = join(WEB, STAMP);
  if (existsSync(at) && readFileSync(at, "utf8") === stamp) return;
  const next = `${WEB}.next`;
  await buildPage(next);
  writeFileSync(join(next, STAMP), stamp);
  rmSync(WEB, { recursive: true, force: true });
  renameSync(next, WEB);
}
