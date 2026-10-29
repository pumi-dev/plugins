// The editor's page, built into `web/` the first time a project opens, and again when `page/` or
// the editor's packages change: `index.html`, `editor.js` (React, Clipkit's editor and the page in
// `page/`), `editor.css` (the editor's sheet) and the two workers the editor starts. Everything is
// local, so the page loads what it needs from the plugin's own server and nothing from the network.
import { build } from "bun"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const here = resolve(import.meta.dir, "..")
/** Where the page is served from (the WebView's `web/index.html`, `serve.ts`'s root). */export const WEB = join(here, "web")
/** What the page in `web/` was built from: the editor's version and the page's sources. */
const STAMP = ".built"

/** Where a package's files are: the editor's `controls/` and a worker sit beside its entry. */
function entryDir(name: string, from = here): string {
  return dirname(Bun.resolveSync(name, from))
}

/** A package's version, from the `package.json` above its entry. */
function versionOf(name: string, from = here): string {
  for (let dir = entryDir(name, from); ; dir = dirname(dir)) {
    const path = join(dir, "package.json")
    if (existsSync(path)) return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version
    if (dirname(dir) === dir) throw new Error(`no package.json for ${name}`)
  }
}

/** What a build of the page now would be from. */
function stampOf(): string {
  const page = join(here, "page")
  const sources = readdirSync(page)
    .filter((name) => /\.(ts|tsx|html)$/.test(name))
    .sort()
    .map((name) => `${name}:${Bun.hash(readFileSync(join(page, name))).toString(36)}`)
  const editor = entryDir("@clipkit/editor")
  const built = ["@clipkit/editor", "react"].map((name) => `${name}@${versionOf(name)}`)
  built.push(`@clipkit/playback@${versionOf("@clipkit/playback", editor)}`)
  built.push(`@clipkit/protocol@${versionOf("@clipkit/protocol")}`)
  return [...built, ...sources].join("\n")
}

/** Fails with the bundler's own messages. */
function check(made: Awaited<ReturnType<typeof build>>, what: string): void {
  if (made.success) return
  throw new Error(`${what}: ${made.logs.map(String).join("\n")}`)
}

/** Builds the page into `out`. */
export async function buildPage(out: string): Promise<void> {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  const made = await build({
    entrypoints: [join(here, "page/editor.tsx")],
    tsconfig: join(here, "page/tsconfig.json"),
    outdir: out,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: true,
    sourcemap: "linked",
    define: { "process.env.NODE_ENV": '"production"' },
    naming: { entry: "[name].[ext]", chunk: "chunks/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
  })
  check(made, "the page")

  // The workers the editor starts with `new Worker(new URL("./x.js", import.meta.url))`: the
  // bundler keeps the URL, relative to `editor.js`, but doesn't build what it points at. Each is
  // built whole beside it, under the name the URL asks for.
  const editor = entryDir("@clipkit/editor")
  const playback = entryDir("@clipkit/playback", editor)
  for (const [entry, name] of [
    [join(playback, "worker.js"), "worker"],
    [join(editor, "controls", "transcribe.worker.js"), "transcribe.worker"],
  ] as const) {
    check(
      await build({ entrypoints: [entry], outdir: out, target: "browser", format: "esm", minify: true, naming: `${name}.[ext]`, define: { "process.env.NODE_ENV": '"production"' } }),
      `the ${name}`,
    )
  }
  copyFileSync(join(here, "page/index.html"), join(out, "index.html"))
}

/** `web/`, built unless it already is from these sources. A build goes to a folder beside it and
 *  takes its place whole, so a page never loads half of one. */
export async function ensurePage(): Promise<void> {
  const stamp = stampOf()
  const at = join(WEB, STAMP)
  if (existsSync(at) && readFileSync(at, "utf8") === stamp) return
  const next = `${WEB}.next`
  await buildPage(next)
  writeFileSync(join(next, STAMP), stamp)
  rmSync(WEB, { recursive: true, force: true })
  renameSync(next, WEB)
}
