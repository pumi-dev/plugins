// The plugin's engine half. It owns two things: simctl (which simulators exist, booting one) and
// the streamer (serve-sim, one helper per booted device, spawned and reaped here). The window half
// is `src/ui.tsx`, which draws the helper's preview page in a webview and calls these exports.
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fn, option, paths, request, self, workspace, type Tab } from "pumi"

/** The tab option naming the device: what `tab.open`'s args set (`pumi_dev.simulator.udid`). */
const UDID = self.plugin.prefixed("udid")
/** The block this plugin defines: `pumi_dev.simulator.device`. */
const BLOCK = self.plugin.prefixed("device")
/** Where a helper's address is: serve-sim writes it under the temp dir, keyed by device. */
const SERVE_SIM_STATE = join(tmpdir(), "serve-sim")

export interface Device {
  udid: string
  name: string
  /** `iOS 27.0`, from the runtime's bundle id. */
  runtime: string
  /** `Booted`, `Shutdown`, … as simctl says it. */
  state: string
  /** False when its runtime is not installed, and it cannot boot. */
  available: boolean
  /** Why it cannot boot, when `available` is false. */
  reason?: string
}

export interface Stream {
  udid: string
  /** The device's name, as simctl says it: what the tab's title becomes. */
  name: string
  /** serve-sim's preview page: the stream, and its toolbar and input, in one page. */
  url: string
  /** The MJPEG stream alone, one multipart response that never ends. */
  streamUrl: string
  /** Its input channel: taps, keys, drags, as binary websocket frames. */
  wsUrl: string
  port: number
}

// Running anything.

interface Ran {
  code: number
  out: string
  err: string
}

/** Runs `argv` to completion, killing it at `timeout`. */
async function run(argv: string[], opts: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}): Promise<Ran> {
  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: { ...(process.env as Record<string, string>), ...opts.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const exited = (async (): Promise<Ran> => {
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    return { code, out, err }
  })()
  const late = new Promise<Ran>((_, reject) => {
    if (!opts.timeout) return
    timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
      reject(new Error(`${argv[0].split("/").pop()} timed out after ${Math.round(opts.timeout! / 1000)}s`))
    }, opts.timeout)
  })
  try {
    return await Promise.race([exited, late])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const firstLine = (text: string) => text.split("\n").map((l) => l.trim()).find(Boolean) ?? ""
const lastLines = (lines: string[], n = 4) => lines.slice(-n).join(" · ") || "no output"

/** `xcrun simctl …`: what the simulator is, rather than what it shows. */
function simctl(args: string[], timeout = 60_000) {
  return run(["/usr/bin/xcrun", "simctl", ...args], { timeout })
}

// Devices.

interface DeviceJSON {
  udid: string
  name: string
  state: string
  isAvailable?: boolean
  availabilityError?: string
}

/** Every iOS simulator this Mac has, booted ones first. */
export async function devices(): Promise<Device[]> {
  const ran = await simctl(["list", "devices", "--json"], 20_000)
  if (ran.code !== 0) throw new Error(firstLine(ran.err) || firstLine(ran.out) || "xcrun simctl failed")
  let json: { devices?: Record<string, DeviceJSON[]> }
  try {
    json = JSON.parse(ran.out) as typeof json
  } catch {
    throw new Error(`simctl's list was not JSON: ${firstLine(ran.out)}`)
  }
  const list: Device[] = []
  for (const [bundle, entries] of Object.entries(json.devices ?? {})) {
    const runtime = runtimeLabel(bundle)
    // iOS only: an iPad runs it too, a watch or a TV does not (serve-sim streams iOS, watchOS, iPad).
    if (!runtime || !/^(iOS|iPadOS)\b/.test(runtime)) continue
    for (const d of entries ?? []) {
      list.push({
        udid: d.udid,
        name: d.name,
        runtime,
        state: d.state,
        available: d.isAvailable !== false,
        ...(d.availabilityError ? { reason: d.availabilityError } : {}),
      })
    }
  }
  const rank = (d: Device) => (d.state === "Booted" ? 0 : d.available ? 1 : 2)
  return list.sort((a, b) => rank(a) - rank(b) || b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) || a.name.localeCompare(b.name))
}

/** `com.apple.CoreSimulator.SimRuntime.iOS-27-0` → `iOS 27.0`; not a system runtime → nothing. */
function runtimeLabel(bundle: string): string | undefined {
  const tail = bundle.split(".").pop() ?? ""
  const m = /^(\w+)-(\d+)-(\d+)$/.exec(tail)
  return m ? `${m[1]} ${m[2]}.${m[3]}` : undefined
}

/** The device `wanted` names (a udid or a name), else the booted one, else one that can boot. */
export async function pick(wanted?: string): Promise<Device> {
  const all = await devices()
  if (wanted) {
    const want = wanted.trim().toLowerCase()
    const found = all.find((d) => d.udid.toLowerCase() === want) ?? all.find((d) => d.name.toLowerCase() === want)
    if (found) return found
    throw new Error(`No simulator called ${wanted}.`)
  }
  const booted = all.find((d) => d.state === "Booted")
  if (booted) return booted
  const usable = all.find((d) => d.available)
  if (usable) return usable
  if (all.length) throw new Error(`${all[0].name} cannot boot: ${all[0].reason ?? "its runtime is not installed"}.`)
  throw new Error("No iOS simulator is installed. Xcode ▸ Settings ▸ Components ▸ iOS …")
}

/** Boots `wanted` (a udid or name, else whatever `pick` finds) and waits for SpringBoard. */
export async function boot(wanted?: string): Promise<Device> {
  const device = await pick(wanted)
  if (device.state === "Booted") return device
  if (!device.available) throw new Error(`${device.name} cannot boot: ${device.reason ?? "its runtime is not installed"}.`)
  const started = await simctl(["boot", device.udid], 180_000)
  const said = `${started.err}${started.out}`
  if (started.code !== 0 && !/current state: Booted|Unable to boot device in current state: Booted/i.test(said)) {
    throw new Error(firstLine(said) || `could not boot ${device.name}`)
  }
  await simctl(["bootstatus", device.udid, "-b"], 300_000).catch(() => undefined)
  return { ...device, state: "Booted" }
}

// The streamer: one serve-sim per booted device, alive while a tab shows it.

/** Which devices have a tab showing them, and how many. */
const holding = new Map<string, number>()
/** The serve-sim we started, by device. */
const children = new Map<string, Bun.Subprocess>()
/** The helper's pid per device, kept on disk so a reload kills what it started. */
const ours = new Map<string, number>()
/** A start in flight, so two tabs opening at once share one helper. */
const starting = new Map<string, Promise<Stream>>()
/** What each device's streamer said, for when it does not come up. */
const logs = new Map<string, string[]>()
/** A pending stop, for the tab that closes and opens again a moment later. */
const stopping = new Map<string, ReturnType<typeof setTimeout>>()
let recovered: Promise<void> | undefined

const stateFile = (udid: string) => join(SERVE_SIM_STATE, `server-${udid}.json`)
const recordFile = () => join(paths.state, "helpers.json")

interface HelperState {
  pid: number
  port: number
  device: string
  url: string
  streamUrl: string
  wsUrl: string
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** What serve-sim says of a device's streamer, when that streamer is still alive. */
async function helperState(udid: string): Promise<HelperState | undefined> {
  try {
    const state = JSON.parse(await readFile(stateFile(udid), "utf8")) as HelperState
    if (!state?.url || !Number.isInteger(state.pid) || !alive(state.pid)) return undefined
    return state
  } catch {
    return undefined
  }
}

const asStream = (state: HelperState, name: string): Stream => ({ udid: state.device, name, url: state.url, streamUrl: state.streamUrl, wsUrl: state.wsUrl, port: state.port })

/** serve-sim's CLI, installed once into the plugin's cache at the pinned version. */
async function entrypoint(nodePath: string): Promise<string> {
  const dir = join(paths.cache, "streamer")
  const bin = join(dir, "node_modules", "serve-sim", "dist", "serve-sim.js")
  if (existsSync(bin)) return bin
  const version = String((await option.get("version")) || "0.1.48")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "pumi-simulator-streamer", private: true, version: "0.0.0", dependencies: { "serve-sim": version } }, null, 2))
  // npm beside the Node that runs it, else Bun: the app's own executable is pumi, not Bun, so
  // `process.execPath install` would ask pumi to install. npm's own `#!/usr/bin/env node` needs a
  // PATH the app does not have, so it is run through that Node, by its CLI's path.
  const npmCli = join(dirname(nodePath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  const bun = Bun.which("bun") ?? ""
  const argv = existsSync(npmCli)
    ? [nodePath, npmCli, "install", "--no-audit", "--no-fund", "--loglevel=error"]
    : bun
      ? [bun, "install", "--no-progress"]
      : []
  if (!argv.length) throw new Error("no npm or bun to install serve-sim with")
  void request.open({ kind: "notification", title: `Simulator: installing serve-sim ${version}…` })
  const installed = await run(argv, { cwd: dir, timeout: 300_000, env: { PATH: `${dirname(nodePath)}:${process.env.PATH ?? ""}` } })
  if (!existsSync(bin)) throw new Error(`could not install serve-sim ${version}: ${lastLines([installed.err, installed.out].join("\n").split("\n"))}`)
  return bin
}

/** A Node to run serve-sim with: the option, then PATH, then the usual places (nvm, Homebrew). */
async function node(): Promise<string> {
  const chosen = String((await option.get("node")) || "").trim()
  if (chosen) {
    if (!existsSync(chosen)) throw new Error(`the "node" option points at ${chosen}, which is not there`)
    return chosen
  }
  const candidates = [Bun.which("node") ?? "", "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate
  try {
    const root = join(homedir(), ".nvm/versions/node")
    const versions = (await readdir(root)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const version of versions) {
      const path = join(root, version, "bin/node")
      if (existsSync(path)) return path
    }
  } catch {}
  throw new Error("no node found: serve-sim needs Node 20+ (set this plugin's “node” option)")
}

/** A port, from `start` up: what serve-sim takes as its first choice. */
function freePort(start: number): number {
  for (let port = start; port < start + 50; port++) {
    try {
      const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response(null, { status: 204 }) })
      probe.stop(true)
      return port
    } catch {}
  }
  return start
}

async function pump(readable: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
  const decoder = new TextDecoder()
  try {
    for await (const chunk of readable) {
      for (const line of decoder.decode(chunk).split("\n")) if (line.trim()) into.push(line.trim())
      if (into.length > 400) into.splice(0, into.length - 400)
    }
  } catch {}
}

/** Starts serve-sim for `udid` and waits for the address it writes when its helper is up. */
async function launch(udid: string, name: string): Promise<Stream> {
  const executable = await node()
  const bin = await entrypoint(executable)
  const base = Number((await option.get("port")) || 3210)
  const port = freePort(Number.isFinite(base) ? base : 3210)
  const log: string[] = []
  logs.set(udid, log)
  const proc = Bun.spawn([executable, bin, "--port", String(port), udid, "--exit-on-simulator-shutdown"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...(process.env as Record<string, string>), PATH: `${dirname(executable)}:${process.env.PATH ?? ""}` },
  })
  children.set(udid, proc)
  void pump(proc.stdout, log)
  void pump(proc.stderr, log)
  void proc.exited.then(() => {
    if (children.get(udid) === proc) children.delete(udid)
  })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const state = await helperState(udid)
    if (state) {
      await remember(udid, state.pid)
      return asStream(state, name)
    }
    if (proc.exitCode !== null && proc.exitCode !== 0) throw new Error(`serve-sim exited (${proc.exitCode}): ${lastLines(log, 6)}`)
    await Bun.sleep(150)
  }
  await stop(udid)
  throw new Error(`serve-sim did not come up: ${lastLines(log, 6)}`)
}

/** What this worker started, on disk: the next one kills it rather than leaving it behind. */
async function writeRecord(): Promise<void> {
  try {
    await mkdir(paths.state, { recursive: true })
    await writeFile(recordFile(), JSON.stringify(Object.fromEntries(ours)))
  } catch {}
}

async function remember(udid: string, pid: number): Promise<void> {
  ours.set(udid, pid)
  await writeRecord()
}

async function forget(udid: string): Promise<void> {
  ours.delete(udid)
  await writeRecord()
}

/** Kills what a previous run of this worker started: its helpers outlived it. */
function recover(): Promise<void> {
  recovered ??= (async () => {
    try {
      const saved = JSON.parse(await readFile(recordFile(), "utf8")) as Record<string, number>
      for (const pid of Object.values(saved)) if (Number.isInteger(pid) && alive(pid)) await kill(pid)
    } catch {}
    try {
      await rm(recordFile())
    } catch {}
  })()
  return recovered
}

async function kill(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return
  }
  for (let i = 0; i < 30 && alive(pid); i++) await Bun.sleep(50)
  if (!alive(pid)) return
  try {
    process.kill(pid, "SIGKILL")
  } catch {}
}

/** Which pids listen on `port`: the preview server, should its own child outlive it. */
async function listeners(port: number): Promise<number[]> {
  const ran = await run(["/usr/sbin/lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"], { timeout: 5_000 }).catch(() => undefined)
  return (ran?.out ?? "")
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
}

/**
 * Stops a device's streamer: the preview, its helper, and anyone left on its port. One this plugin
 * did not start (the same device streamed by a `serve-sim` of the user's own) is left alone unless
 * `force` says otherwise.
 */
export async function stop(udid: string, force = false): Promise<void> {
  const pending = stopping.get(udid)
  if (pending) {
    clearTimeout(pending)
    stopping.delete(udid)
  }
  if (!force && !children.has(udid) && !ours.has(udid)) {
    holding.delete(udid)
    return
  }
  const state = await helperState(udid)
  const child = children.get(udid)
  children.delete(udid)
  if (child && child.exitCode === null) {
    try {
      child.kill("SIGTERM")
    } catch {}
  }
  if (state) {
    await kill(state.pid)
    for (const pid of await listeners(state.port)) await kill(pid)
  }
  await forget(udid)
  logs.delete(udid)
  try {
    await rm(stateFile(udid))
  } catch {}
}

/** A tab showing the streamer is done with it: stop it once the keepalive runs out. */
export async function release(udid: string): Promise<void> {
  const left = (holding.get(udid) ?? 1) - 1
  if (left > 0) {
    holding.set(udid, left)
    return
  }
  holding.delete(udid)
  const pending = stopping.get(udid)
  if (pending) clearTimeout(pending)
  const seconds = Number((await option.get("keepalive")) ?? 120)
  const wait = Math.max(0, Number.isFinite(seconds) ? seconds : 120)
  if (wait === 0) {
    stopping.delete(udid)
    void stop(udid)
    return
  }
  const timer = setTimeout(() => {
    stopping.delete(udid)
    if ((holding.get(udid) ?? 0) === 0) void stop(udid)
  }, wait * 1000)
  timer.unref?.()
  stopping.set(udid, timer)
}

/**
 * The streamer for `wanted` (a udid or name, else the booted device): started if it is not already
 * up, and reused when it is. Answers its addresses; the caller releases it when it stops drawing it.
 */
export async function stream(wanted?: string): Promise<Stream> {
  await recover()
  const device = await pick(wanted)
  if (device.state !== "Booted") throw new Error(`${device.name} is not booted: open it again and pumi boots it first.`)
  const pending = stopping.get(device.udid)
  if (pending) {
    clearTimeout(pending)
    stopping.delete(device.udid)
  }
  const running = await helperState(device.udid)
  if (running) {
    holding.set(device.udid, (holding.get(device.udid) ?? 0) + 1)
    return asStream(running, device.name)
  }
  let start = starting.get(device.udid)
  if (!start) {
    start = launch(device.udid, device.name)
    starting.set(device.udid, start)
    void start.finally(() => starting.delete(device.udid)).catch(() => {})
  }
  const started = await start
  holding.set(device.udid, (holding.get(device.udid) ?? 0) + 1)
  return started
}

/** What a device's screen shows now, as a PNG beside the streamer's cache; `open` shows it in pumi. */
export async function screenshot(wanted?: string, open = true): Promise<string> {
  const device = await pick(wanted)
  if (device.state !== "Booted") throw new Error(`${device.name} is not booted.`)
  await mkdir(paths.cache, { recursive: true })
  const path = join(paths.cache, `${device.name.replace(/[^\w.-]+/g, "_")}-${Date.now()}.png`)
  const ran = await simctl(["io", device.udid, "screenshot", "--type=png", path], 60_000)
  if (ran.code !== 0 || !existsSync(path)) throw new Error(firstLine(ran.err) || `could not take a screenshot of ${device.name}`)
  if (open) await workspace.openTab("file", { path }, { kind: "tiled", split: "right" })
  return path
}

/** Opens a tab with a device in it, booting it first. */
export async function open(wanted?: string): Promise<Tab> {
  const device = await pick(wanted)
  if (device.state !== "Booted") {
    void request.open({ kind: "notification", title: `Simulator: booting ${device.name}…` })
    await boot(device.udid)
  }
  return workspace.openTab(BLOCK, { [UDID]: device.udid }, { kind: "tiled", split: "right", size: "45%" })
}

// What the plugin registers.

fn.set("open", { desc: "Open a booted simulator in a tab beside this one." }, async () => {
  await open()
})

fn.set("stop", { desc: "Stop every simulator stream this plugin runs." }, async () => {
  const udids = new Set([...holding.keys(), ...children.keys(), ...ours.keys()])
  if (!udids.size) return void request.open({ kind: "notification", title: "Simulator: nothing is streaming" })
  for (const udid of udids) await stop(udid, true)
  void request.open({ kind: "notification", title: `Simulator: stopped ${udids.size === 1 ? "the stream" : `${udids.size} streams`}` })
})

fn.set("screenshot", { desc: "A PNG of a booted simulator's screen, shown in a tab." }, async () => {
  await screenshot()
})

// For agents and other plugins: `pumi call pumi_dev.simulator.devices`.

/** The device a call names: `"iPhone 18 Pro"` from a script, `{device}` from `pumi call`. */
function deviceOf(arg: unknown): string | undefined {
  const named = arg && typeof arg === "object" ? (arg as { device?: unknown }).device : arg
  return typeof named === "string" && named.trim() ? named : undefined
}

fn.set("devices", { desc: "The iOS simulators on this machine, with their runtime and state.", effect: "read", returns: "Array" }, () => devices())
fn.set(
  "stream",
  {
    desc: "Serve-sim's addresses for a booted device, starting the streamer if need be.",
    effect: "read",
    parameters: [["String", "device"]],
    params_schema: { type: "object", properties: { device: { type: "string", description: "A device's udid or name; the booted one by default." } } },
    returns: "Object",
  },
  (device?: unknown) => stream(deviceOf(device)),
)
fn.set(
  "screenshot",
  {
    desc: "A PNG of a device's screen, and its path.",
    effect: "write",
    parameters: [["String", "device"]],
    params_schema: { type: "object", properties: { device: { type: "string", description: "A device's udid or name; the booted one by default." } } },
    returns: "String",
  },
  (device?: unknown) => screenshot(deviceOf(device), false),
)
