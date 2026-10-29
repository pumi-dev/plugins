// The editor's server, on 127.0.0.1: the page (`web/`), each project file and the media beside it.
// A project is the JSON file a tab edits, and gets a port of its own whose root is the project's
// folder: Clipkit resolves a relative `source` against the site's root, so `take.mp4` in the JSON
// is `/take.mp4`, the file beside it. `/` is the page, `/_page/` its code. The page saves with a PUT,
// and hears the file change on disk (an agent wrote it) as a server-sent event.
// Pure: no `pumi` here, so `bun src/serve.ts PROJECT` runs it alone and a browser can open it.
import { watch, type FSWatcher } from "node:fs"
import { readFile, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, normalize, resolve, sep } from "node:path"

const WEB = resolve(import.meta.dir, "..", "web")

interface Project {
  path: string
  dir: string
  /** What the server last wrote or read: an edit on disk that differs is someone else's. */
  last: string
  listeners: Set<ReadableStreamDefaultController<Uint8Array>>
  watcher?: FSWatcher
  server: ReturnType<typeof Bun.serve>
}

const projects = new Map<string, Project>()

/** The page for `path` (made absolute): its URL, its server started on first use. */
export function page(path: string): string {
  const abs = resolve(path)
  let p = projects.get(abs)
  if (!p) {
    const project: Project = { path: abs, dir: dirname(abs), last: "", listeners: new Set(), server: undefined! }
    project.server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: (req) => route(project, req) })
    projects.set(abs, (p = project))
  }
  return `http://127.0.0.1:${p.server.port}/`
}

/** Stops serving `path`, or every project. */
export function close(path?: string): void {
  for (const [key, p] of projects) {
    if (path && key !== resolve(path)) continue
    p.watcher?.close()
    for (const c of p.listeners) c.close()
    p.server.stop(true)
    projects.delete(key)
  }
}

const enc = new TextEncoder()

async function route(p: Project, req: Request): Promise<Response> {
  const url = URL.parse(req.url)
  if (!url) return new Response("bad request", { status: 400 })
  const rest = decodeURIComponent(url.pathname.slice(1))

  if (rest === "") return file(join(WEB, "index.html"), req)
  if (rest.startsWith("_page/")) return file(inside(WEB, rest.slice(6)), req)
  if (rest === "_project") {
    if (req.method === "PUT") {
      const body = await req.text()
      if (!isJson(body)) return new Response("not JSON", { status: 400 })
      p.last = body
      // Whole or not at all: the file is never half written when an agent reads it.
      const tmp = `${p.path}.${process.pid}.tmp`
      await writeFile(tmp, body)
      await rename(tmp, p.path)
      return new Response(null, { status: 204 })
    }
    p.last = await readFile(p.path, "utf8")
    return new Response(p.last, { headers: { "content-type": "application/json", "cache-control": "no-store" } })
  }
  if (rest === "_events") return events(p)
  return file(inside(p.dir, rest), req)
}

/** `rel` under `root`, or a path that 404s: nothing outside the folder is served. */
function inside(root: string, rel: string): string {
  const full = normalize(join(root, rel))
  return full === root || full.startsWith(root + sep) ? full : join(root, "\0")
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  wasm: "application/wasm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  woff2: "font/woff2",
}

/** A file, with byte ranges: a video seeks by asking for the part it needs. */
async function file(path: string, req: Request): Promise<Response> {
  const size = await stat(path).then((s) => (s.isFile() ? s.size : -1), () => -1)
  if (size < 0) return new Response("not found", { status: 404 })
  const type = TYPES[basename(path).split(".").pop()!.toLowerCase()] ?? "application/octet-stream"
  const headers: Record<string, string> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" }
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/)
  if (!range) return new Response(Bun.file(path), { headers: { ...headers, "content-length": String(size) } })
  let from = range[1] ? Number(range[1]) : size - Number(range[2])
  let to = range[1] && range[2] ? Number(range[2]) : size - 1
  from = Math.max(0, from)
  to = Math.min(size - 1, to)
  if (from > to) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } })
  return new Response(Bun.file(path).slice(from, to + 1), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${from}-${to}/${size}`, "content-length": String(to - from + 1) },
  })
}

/** `changed` each time the file on disk becomes something the page didn't write. */
function events(p: Project): Response {
  let mine: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      mine = c
      p.listeners.add(c)
      c.enqueue(enc.encode(": hello\n\n"))
      p.watcher ??= watchFile(p)
    },
    cancel() {
      p.listeners.delete(mine)
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } })
}

function watchFile(p: Project): FSWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  // The folder, not the file: an editor that saves by rename replaces the file being watched.
  return watch(p.dir, (_kind, name) => {
    if (name !== basename(p.path)) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const now = await readFile(p.path, "utf8").catch(() => null)
      if (now === null || now === p.last) return
      // Half written, or broken: wait for the next save.
      if (!isJson(now)) return
      p.last = now
      for (const c of p.listeners) c.enqueue(enc.encode("data: changed\n\n"))
    }, 80)
  })
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

if (import.meta.main) {
  const path = process.argv[2]
  if (!path) throw new Error("usage: bun src/serve.ts PROJECT.json")
  console.log(page(path))
}
