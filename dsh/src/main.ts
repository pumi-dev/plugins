/**
 * pumi-dsh: a DeepSeek Harness agent in a pane of its own.
 *
 *   the `+` menu's "DeepSeek Harness", or "DSH: new agent"   a pane with its own `dsh`
 *   pumi call amresyd.dsh.new                                the same, from a script
 *
 * One pane is one session: this half spawns `dsh --profile <profile>` (the harness's SDK stdio
 * server), initializes it, sends what the pane types into it, and posts the transcript the pane
 * draws. The runtime, its plugins and its tools belong to the harness; this file only speaks its
 * protocol (`src/rpc.ts`, `src/harness.ts`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fn, on, option, paths, self, ui, workspace, type TabId } from "pumi"

import { Agent, type Snapshot } from "./harness.ts"

/** Every pane's agent, by tab. */
const agents = new Map<string, Agent>()
/** A pane whose agent has not started yet keeps its id here, so a reopened pane resumes it. */
const saved = loadSessions()

/** This plugin's block: the registry knows it by its prefixed id (`amresyd.dsh.chat`). */
function chatBlock(): string {
  return self.plugin.prefixed("chat")
}

/** The channel topic one pane's worker posts its snapshot on. */
function topic(tab: string): string {
  return `chat/${tab}`
}

/** The harness home: the option, the environment, `~/.dsh`. */
function home(optionValue: string): string {
  return optionValue !== "" ? optionValue : process.env.DSH_HOME ?? join(homedir(), ".dsh")
}

/**
 * The `dsh` this pane runs: the option when it names one, else the first `dsh` on the machine,
 * else the Desktop install's own launcher.
 */
function binary(optionValue: string): string {
  if (optionValue !== "") {
    if (!existsSync(optionValue)) throw new Error(`pumi-dsh: no harness at ${optionValue}`)
    return optionValue
  }
  const found = Bun.which("dsh")
  if (found !== null) return found
  const desktop = "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
  if (existsSync(desktop)) return desktop
  const local = join(homedir(), ".local/bin/dsh")
  if (existsSync(local)) return local
  throw new Error("pumi-dsh: no `dsh` found. Set the plugin's Harness option, or install it with `npx @deepseek-ai/dsh`.")
}

/** One option's text, with its default. */
async function text(key: string, fallback: string): Promise<string> {
  const value = await option.get(key).catch(() => undefined)
  return typeof value === "string" && value !== "" ? value : fallback
}

/** One option's number, or none. */
async function count(key: string, fallback: number): Promise<number | undefined> {
  const value = await option.get(key).catch(() => undefined)
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(number) && number > 0 ? number : fallback > 0 ? fallback : undefined
}

/** A manifest table option that holds something, as opposed to nothing at all. */
function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0
}

/**
 * The `--patch` layer a gateway route needs. The `providers` option is `dsh-llm-pi-ai`'s own
 * `providers` dictionary, written as one patch row that the launcher applies after the profile.
 * JSON is YAML, so the file is the table exactly as configured.
 */
async function routePatches(): Promise<{ patches?: string[] }> {
  const providers = await option.get("providers").catch(() => undefined)
  if (!isTable(providers)) return {}
  const file = join(paths.state, "llm-pi-ai.patch.yml")
  try {
    mkdirSync(paths.state, { recursive: true })
    writeFileSync(file, JSON.stringify([{ id: "llm-pi-ai", config: { providers } }], null, 2))
    return { patches: [file] }
  } catch (error) {
    console.error(`pumi-dsh: could not write ${file}: ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
}

/** The key a gateway route expects, under the name its `apiKeyEnv` declares. */
async function routeEnv(): Promise<{ env?: Record<string, string> }> {
  const name = await text("api_key_env", "")
  if (name === "") return {}
  const stored = await option.get("api_key").catch(() => undefined)
  const value = typeof stored === "string" && stored !== "" ? stored : process.env[name]
  return typeof value === "string" && value !== "" ? { env: { [name]: value } } : {}
}

/** The tab this call is about: the caller's, else the focused one. */
function currentTab(): string {
  if (self.tab !== null) return self.tab
  const focused = workspace.currentTab
  if (focused === null) throw new Error("pumi-dsh: no pane in this call")
  return focused.id
}

/** A tab's directory: the pane's own, else the plugin's option, else the home directory. */
async function cwdOf(tab: string, fallback: string): Promise<string> {
  const open = await workspace.tabs({ block: chatBlock() }).catch(() => [])
  const found = open.find((each) => each.id === tab)
  return found?.cwd ?? (fallback !== "" ? fallback : homedir())
}

/** One pane's agent, started once. */
async function agentFor(tab: string): Promise<Agent> {
  const existing = agents.get(tab)
  if (existing !== undefined) return existing
  const profile = await text("profile", "sdk")
  const provider = await text("provider", "deepseek-account")
  const model = await text("model", "deepseek-flash")
  const effort = await text("effort", "")
  const maxTokens = await count("max_tokens", 0)
  const patches = await routePatches()
  const env = await routeEnv()
  const agent = new Agent(
    {
      tab,
      binary: binary(await text("binary", "")),
      profile,
      home: home(await text("home", "")),
      cwd: await cwdOf(tab, await text("cwd", "")),
      provider,
      model,
      ...(effort !== "" ? { effort } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...patches,
      ...env,
    },
    saved[tab] ?? `pumi-${tab.replace(/[^a-zA-Z0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`,
    (snapshot) => ui.post(topic(tab), snapshot),
  )
  agents.set(tab, agent)
  saved[tab] = agent.state.sessionId
  saveSessions()
  await agent.start()
  return agent
}

// ── The pane's exports, called from ui.tsx ────────────────────────────────────────────────────

/** Starts this pane's agent, if it has not started. */
export async function attach(): Promise<void> {
  await agentFor(currentTab())
}

/** What this pane draws now, or the empty state before its agent starts. */
export async function snapshot(): Promise<Snapshot | null> {
  const agent = agents.get(currentTab())
  return agent === undefined ? null : agent.state
}

/** Sends one prompt into this pane's session. */
export async function send(text: string): Promise<void> {
  const tab = currentTab()
  let agent = await agentFor(tab)
  // A reload of this plugin takes its agents with it: a tab whose runtime is gone starts one more
  // rather than refusing what was typed into it.
  if (agent.state.status === "stopped" || agent.state.status === "failed") {
    agent.stop()
    agents.delete(tab)
    agent = await agentFor(tab)
  }
  await agent.prompt(text).catch((error: unknown) => agent.report(error))
}

/** Answers the approval this pane shows. */
export function answer(id: number, outcome: "allowed-once" | "rejected"): void {
  agents.get(currentTab())?.answer(id, outcome)
}

/** Ends this pane's agent; its transcript stays. */
export function stop(): void {
  agents.get(currentTab())?.stop()
}

/** Ends this pane's agent and starts another, with the plugin's options as they are now. */
export async function restart(): Promise<void> {
  const tab = currentTab()
  agents.get(tab)?.stop()
  agents.delete(tab)
  delete saved[tab]
  saveSessions()
  await agentFor(tab)
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────────

fn.set(
  "new",
  { desc: "A DeepSeek Harness agent in a tab of its own.", parameters: [["table", "args"]] },
  async (args?: { tab?: string; place?: unknown }) => {
    // The `+` menu's own action hands over the place it was pressed in; anywhere else, the
    // caller's pane, as one of its tabs. No `split`: a split would make a pane of its own,
    // which is what put the tab in the wrong place before.
    const place = args?.place ?? { kind: "tiled", pane: "current" }
    const open = await workspace.openTab(chatBlock(), {}, place)
    // Start it now rather than on the pane's first paint, so the pane opens on a live agent.
    await agentFor(open.id)
    return open.id
  },
)

fn.set("stop", { desc: "Ends the calling pane's agent." }, () => stop())

// ── Session ids, kept between runs ───────────────────────────────────────────────────────────

function sessionFile(): string {
  return join(paths.state, "sessions.json")
}

/** The tab → session id map, as the state directory has it. */
function loadSessions(): Record<string, string> {
  try {
    const raw = readFileSync(sessionFile(), "utf8")
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function saveSessions(): void {
  try {
    mkdirSync(paths.state, { recursive: true })
    writeFileSync(sessionFile(), JSON.stringify(saved, null, 2))
  } catch (error) {
    console.error(`pumi-dsh: could not save session ids: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// A pane that closes takes its agent with it.
on("tab.closed", (event) => {
  const data = event.data as { tab?: TabId; block?: string }
  if (data.block !== chatBlock() || typeof data.tab !== "string") return
  const agent = agents.get(data.tab)
  if (agent === undefined) return
  agent.stop()
  agents.delete(data.tab)
})
