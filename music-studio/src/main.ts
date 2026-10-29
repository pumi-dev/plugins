// Music Studio's worker: it plays a song (ffplay, so it can start anywhere and stop at a
// point), measures it (`analyze.ts`), and keeps the notes someone leaves on its parts beside it as
// `<file>.notes.json`. Everything the player shows is here too, as functions, so an agent that
// cannot hear the song can read it: `report`, `spectrogram`, `notes`.
import { call, fn, on } from "pumi"
import type { Subprocess } from "bun"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { bin } from "./bin.ts"
import { BANDS, COLUMNS, FPS, analyze, mtimeOf, report as reportOf, tracksOf } from "./analyze.ts"

// ── Notes ─────────────────────────────────────────────────────────────
export interface Note {
  id: string
  from: number
  to: number
  text: string
  at: string
  done?: boolean
}
const notesFile = (path: string) => `${path}.notes.json`

export function notes(path: string): Note[] {
  const f = notesFile(path)
  if (!existsSync(f)) return []
  try {
    return (JSON.parse(readFileSync(f, "utf8")) as Note[]).sort((a, b) => a.from - b.from)
  } catch {
    return []
  }
}
function saveNotes(path: string, all: Note[]) {
  writeFileSync(notesFile(path), JSON.stringify(all.sort((a, b) => a.from - b.from), null, 2) + "\n")
}
export function addNote(path: string, from: number, to: number, text: string): Note {
  const note: Note = { id: Math.random().toString(36).slice(2, 8), from: Math.min(from, to), to: Math.max(from, to), text: text.trim(), at: new Date().toISOString() }
  saveNotes(path, [...notes(path), note])
  return note
}
export function removeNote(path: string, id: string) {
  saveNotes(path, notes(path).filter((n) => n.id !== id))
}
export function markNote(path: string, id: string, done: boolean) {
  saveNotes(path, notes(path).map((n) => (n.id === id ? { ...n, done } : n)))
}

// ── Playing ───────────────────────────────────────────────────────────
interface Playing {
  path: string
  proc?: Subprocess
  /** Where it started, in the song, and when (ms since the epoch, moved on by each pause). */
  from: number
  startedAt: number
  /** Where it stops (the end, or a range's end). */
  to?: number
  paused: boolean
  pausedAt: number
  loop: boolean
  /** Bumped each start, so a stopped process's exit is not taken for the new one's. */
  run: number
}
const playing = new Map<string, Playing>()

/** A tab's mixer: the tracks muted and soloed. */
interface Mixer {
  muted: string[]
  solo: string[]
}
const mixers = new Map<string, Mixer>()
const mixerOf = (tab: string): Mixer => mixers.get(tab) ?? { muted: [], solo: [] }

/** The stems that sound with this mixer: all of them (none set) is the mix itself. */
function audible(path: string, m: Mixer): string[] | null {
  if (!m.muted.length && !m.solo.length) return null
  const tracks = tracksOf(path)
  return tracks.filter((t) => (m.solo.length ? m.solo.includes(t.id) : !m.muted.includes(t.id))).map((t) => t.file)
}

/** A path as a filtergraph quotes it. */
const quote = (p: string) => `'${p.replace(/'/g, "'\\''")}'`

export interface PlayState {
  path: string | null
  playing: boolean
  paused: boolean
  position: number
  from: number
  to: number | null
  loop: boolean
  /** When `position` was read, ms since the epoch: the window moves it on from there. */
  now: number
  muted: string[]
  solo: string[]
}

function positionOf(p: Playing, now = Date.now()) {
  const pos = p.from + ((p.paused ? p.pausedAt : now) - p.startedAt) / 1000
  return p.to !== undefined ? Math.min(pos, p.to) : pos
}

export function state(tab: string): PlayState {
  const p = playing.get(tab)
  const now = Date.now()
  const { muted, solo } = mixerOf(tab)
  if (!p) return { path: null, playing: false, paused: false, position: 0, from: 0, to: null, loop: false, now, muted, solo }
  return { path: p.path, playing: !!p.proc && !p.paused, paused: p.paused, position: p.proc || p.paused ? positionOf(p, now) : p.from, from: p.from, to: p.to ?? null, loop: p.loop, now, muted, solo }
}

function kill(p: Playing) {
  const proc = p.proc
  p.proc = undefined
  if (!proc) return
  if (p.paused) proc.kill("SIGCONT")
  proc.kill()
}

export async function play(tab: string, opts: { path?: string; from?: number; to?: number; loop?: boolean } = {}): Promise<PlayState> {
  const before = playing.get(tab)
  const path = opts.path ?? before?.path ?? (await pathOf(tab))
  if (!path) throw new Error(`tab ${tab} has no song`)
  if (before) kill(before)
  const from = Math.max(0, opts.from ?? 0)
  const to = opts.to
  const args = ["-nodisp", "-autoexit", "-loglevel", "quiet"]
  const stems = audible(path, mixerOf(tab))
  if (stems) {
    // Only the tracks that sound, summed as the mix sums them, from `from`.
    const graph = stems.length
      ? stems.map((f, i) => `amovie=${quote(f)}:seek_point=${from.toFixed(3)}[s${i}]`).join(";") + `;${stems.map((_, i) => `[s${i}]`).join("")}amix=inputs=${stems.length}:normalize=0[out0]`
      : `anullsrc=r=48000:cl=stereo[out0]`
    args.push("-f", "lavfi")
    if (to !== undefined) args.push("-t", Math.max(0.05, to - from).toFixed(3))
    args.push("-i", graph)
  } else {
    args.push("-ss", from.toFixed(3))
    if (to !== undefined) args.push("-t", Math.max(0.05, to - from).toFixed(3))
    args.push(path)
  }
  const run = (before?.run ?? 0) + 1
  const proc = Bun.spawn([bin("ffplay"), ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  const p: Playing = { path, proc, from, to, startedAt: Date.now(), paused: false, pausedAt: 0, loop: opts.loop ?? false, run }
  playing.set(tab, p)
  void proc.exited.then(() => {
    const now = playing.get(tab)
    if (now?.run !== run || now.proc !== proc) return
    now.proc = undefined
    if (now.loop) void play(tab, { path, from, to, loop: true })
    else now.from = to ?? 0
  })
  return state(tab)
}

export function pause(tab: string): PlayState {
  const p = playing.get(tab)
  if (p?.proc && !p.paused) {
    p.proc.kill("SIGSTOP")
    p.paused = true
    p.pausedAt = Date.now()
  }
  return state(tab)
}

export async function toggle(tab: string): Promise<PlayState> {
  const p = playing.get(tab)
  if (p?.proc && p.paused) {
    p.proc.kill("SIGCONT")
    p.startedAt += Date.now() - p.pausedAt
    p.paused = false
    return state(tab)
  }
  if (p?.proc) return pause(tab)
  return play(tab, { from: p?.from && p.from < (await analyze(p.path)).duration - 0.05 ? p.from : 0 })
}

/** Mute or solo a track (`on` flips it when left out); what is playing goes on with the new mix. */
export async function mix(tab: string, track: string, what: "mute" | "solo", on?: boolean): Promise<PlayState> {
  const m = mixerOf(tab)
  const key = what === "mute" ? "muted" : "solo"
  const has = m[key].includes(track)
  const want = on ?? !has
  const next = { ...m, [key]: want ? [...new Set([...m[key], track])] : m[key].filter((x) => x !== track) }
  mixers.set(tab, next)
  const p = playing.get(tab)
  if (p?.proc && !p.paused) {
    const s = state(tab)
    return play(tab, { path: p.path, from: s.position, to: p.to, loop: p.loop })
  }
  return state(tab)
}

export function stop(tab: string): PlayState {
  const p = playing.get(tab)
  if (p) {
    kill(p)
    p.from = 0
    p.to = undefined
    p.loop = false
  }
  return state(tab)
}

on("tab.closed", { desc: "Music Studio stops what a closed tab was playing" }, (e: any) => {
  if (typeof e.tab !== "string") return
  const p = playing.get(e.tab)
  if (p) kill(p)
  playing.delete(e.tab)
  mixers.delete(e.tab)
})

// ── What the window draws ─────────────────────────────────────────────
/** A tab's song: what it was opened with. */
async function pathOf(tab: string): Promise<string | null> {
  const p = playing.get(tab)?.path
  if (p) return p
  const args = (await call("tab.call", tab, "args").catch(() => null)) as { path?: unknown } | null
  return typeof args?.path === "string" ? args.path : null
}

/** What changes when the song is made again: the player reloads when it does. */
export function version(path: string): number {
  return mtimeOf(path) + (existsSync(notesFile(path)) ? Bun.file(notesFile(path)).lastModified : 0) / 1e6
}

export async function view(tab: string) {
  const path = await pathOf(tab)
  if (!path) return null
  if (!existsSync(path)) return { path, missing: true as const }
  const a = await analyze(path)
  void call("tab.update", tab, { title: `♪ ${a.title}` }).catch(() => {})
  return {
    path,
    missing: false as const,
    mtime: a.mtime,
    title: a.title,
    artist: a.artist,
    duration: a.duration,
    bpm: a.bpm,
    key: a.key,
    lufs: a.integrated,
    beatsPerBar: a.markers.beatsPerBar ?? 4,
    offset: a.markers.offset ?? 0,
    sections: a.markers.sections ?? [],
    cues: a.markers.cues ?? [],
    bars: a.bars.map((b) => ({ n: b.n, from: b.from, chord: b.chord })),
    spectrum: a.spectrum,
    waveform: a.waveform,
    meters: a.meters,
    shortTerm: a.loudness,
    tracks: a.tracks.map(({ file: _f, ...t }) => t),
    truePeak: a.truePeak,
    range: a.range,
    bands: BANDS,
    fps: FPS,
    columns: COLUMNS,
    problems: a.problems,
    notes: notes(path),
  }
}
export type View = Extract<NonNullable<Awaited<ReturnType<typeof view>>>, { missing: false }>

// ── Functions ─────────────────────────────────────────────────────────
const tabOf = (x: unknown) => String(x)
const PATH = { type: "string", description: "The audio file (anything ffmpeg reads)." }
const RANGE = {
  from: { type: "number", description: "Seconds from the start." },
  to: { type: "number", description: "Seconds from the start." },
}

fn.set(
  "open",
  {
    desc: "Open a song in a player tab: its spectrum, waveform, parts and notes. Answers the tab's id.",
    effect: "write",
    paramsSchema: { type: "object", properties: { path: PATH, split: { type: "string", enum: ["right", "down", "left", "up"] }, play: { type: "boolean" } }, required: ["path"] },
  },
  async (args: { path: string; split?: string; play?: boolean }) => {
    const tab = (await call("tab.open", "pumi_dev.music_studio.player", { path: args.path }, { kind: "tiled", split: args.split ?? "right" })) as { id?: string } | string
    const id = typeof tab === "string" ? tab : String(tab.id)
    if (args.play) await play(id, { path: args.path })
    return id
  },
)

fn.set(
  "report",
  {
    desc: "What a song is, measured, as text: tempo, key, loudness and true peak, then each bar's loudness, low/mid/high balance, chord heard (and meant, from `<file>.markers.json`), dissonance, hits and how far off the grid, stereo; what sounds wrong; and the notes left on it.",
    effect: "read",
    paramsSchema: { type: "object", properties: { path: PATH, ...RANGE }, required: ["path"] },
  },
  async (args: { path: string; from?: number; to?: number }) => reportOf(await analyze(args.path), notes(args.path), args),
)

fn.set(
  "analyze",
  {
    desc: "The song measured, as data: everything `report` says, with each bar's numbers, the short-term loudness every 0.1s and the onsets.",
    effect: "read",
    paramsSchema: { type: "object", properties: { path: PATH }, required: ["path"] },
  },
  async (args: { path: string }) => {
    const { spectrum: _s, waveform: _w, meters: _m, ...rest } = await analyze(args.path)
    return { ...rest, notes: notes(args.path) }
  },
)

fn.set(
  "spectrogram",
  {
    desc: "Draw a part of a song as a spectrogram PNG (sox), with the time along the bottom; answers its path.",
    effect: "write",
    paramsSchema: { type: "object", properties: { path: PATH, ...RANGE, out: { type: "string" }, width: { type: "number" }, height: { type: "number" } }, required: ["path"] },
  },
  (args: { path: string; from?: number; to?: number; out?: string; width?: number; height?: number }) => {
    const from = args.from ?? 0
    const out = args.out ?? `/tmp/music-${Date.now()}.png`
    const trim = args.to !== undefined ? ["trim", String(from), `=${args.to}`] : from ? ["trim", String(from)] : []
    const r = spawnSync(bin("sox"), [args.path, "-n", "remix", "-", ...trim, "spectrogram", "-x", String(args.width ?? 1200), "-y", String(args.height ?? 400), "-z", "90", "-t", `${from.toFixed(2)}s-`, "-o", out], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(r.error?.message ?? (r.stderr || "sox failed"))
    return out
  },
)

fn.set("notes", { desc: "The notes left on a song's parts: `{id, from, to, text, at, done}`.", effect: "read", paramsSchema: { type: "object", properties: { path: PATH }, required: ["path"] } }, (args: { path: string }) => notes(args.path))
fn.set(
  "note.add",
  { desc: "Leave a note on a part of a song.", effect: "write", paramsSchema: { type: "object", properties: { path: PATH, ...RANGE, text: { type: "string" } }, required: ["path", "from", "to", "text"] } },
  (args: { path: string; from: number; to: number; text: string }) => addNote(args.path, args.from, args.to, args.text),
)
fn.set(
  "note.done",
  { desc: "Mark a note dealt with (or not).", effect: "write", paramsSchema: { type: "object", properties: { path: PATH, id: { type: "string" }, done: { type: "boolean" } }, required: ["path", "id"] } },
  (args: { path: string; id: string; done?: boolean }) => markNote(args.path, args.id, args.done ?? true),
)
fn.set(
  "note.remove",
  { desc: "Take a note off a song.", effect: "write", paramsSchema: { type: "object", properties: { path: PATH, id: { type: "string" } }, required: ["path", "id"] } },
  (args: { path: string; id: string }) => removeNote(args.path, args.id),
)

// The player tab's own methods: its id first.
const TAB: [string, string] = ["string", "tab"]
const PLAY_ARGS = { type: "object", properties: { ...RANGE, loop: { type: "boolean", description: "Play the range again and again." } } }
fn.set("player.play", { desc: "Play the tab's song, from a point (0 by default), to a point, or a range on a loop.", effect: "write", parameters: [TAB, ["table", "args"]], paramsSchema: PLAY_ARGS }, (tab: unknown, args?: { from?: number; to?: number; loop?: boolean }) =>
  play(tabOf(tab), args ?? {}),
)
fn.set("player.pause", { desc: "Pause the tab's song.", effect: "write", parameters: [TAB] }, (tab: unknown) => pause(tabOf(tab)))
fn.set("player.toggle", { desc: "Play or pause the tab's song.", effect: "write", parameters: [TAB] }, (tab: unknown) => toggle(tabOf(tab)))
fn.set(
  "player.mix",
  { desc: "Mute or solo one of the tab's tracks (by id); `on` sets it, else it flips. Playing goes on with the new mix.", effect: "write", parameters: [TAB, ["table", "args"]], paramsSchema: { type: "object", properties: { track: { type: "string" }, what: { type: "string", enum: ["mute", "solo"] }, on: { type: "boolean" } }, required: ["track", "what"] } },
  (tab: unknown, args: { track: string; what: "mute" | "solo"; on?: boolean }) => mix(tabOf(tab), args.track, args.what, args.on),
)
fn.set("player.stop", { desc: "Stop the tab's song, back to the start.", effect: "write", parameters: [TAB] }, (tab: unknown) => stop(tabOf(tab)))
fn.set("player.state", { desc: "Whether the tab's song is playing, and where.", effect: "read", parameters: [TAB] }, (tab: unknown) => state(tabOf(tab)))
fn.set("player.describe", { desc: "The tab's song, measured, with its notes (`report`).", effect: "read", parameters: [TAB] }, async (tab: unknown) => {
  const path = await pathOf(tabOf(tab))
  if (!path) return "no song"
  const s = state(tabOf(tab))
  return `${s.playing ? `playing at ${s.position.toFixed(2)}s` : "stopped"}\n${reportOf(await analyze(path), notes(path))}`
})
