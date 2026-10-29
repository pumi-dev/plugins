// The player, laid out like GarageBand: a toolbar with the transport and the LCD (bar and beat,
// tempo, time signature, key), the arrangement track (the song's parts), and a row a track, each
// with its icon, mute and solo, and its regions drawn as GarageBand draws them: notes for a
// software instrument, hits for a drummer, a waveform for audio. Under it, the meters and the
// notes. Drag along the ruler to pick a part (the cycle), then type a note on it; click the ruler
// to play from there.
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useTheme, type RendererProps } from "pumi"
import * as I from "./glyphs.ts"
import { addNote, markNote, mix as setMix, play, removeNote, state, stop, toggle, version, view, type Note, type PlayState, type View } from "./main.ts"

/** A call into the worker: always a promise in the window, whatever the function itself returns. */
const rpc = <T,>(x: T | Promise<T>): Promise<Awaited<T>> => Promise.resolve(x) as Promise<Awaited<T>>

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`
const pct = (x: number) => `${Math.max(0, Math.min(100, x * 100))}%`
const MONO = "SF Mono, JetBrains Mono, Menlo, monospace"

/** `a` toward `b` by `k`, for two `#rrggbb` colours (else `a`); `alpha` adds a transparency. */
function mix(a: string, b: string, k: number, alpha?: number): string {
  const p = (c: string) => (/^#[0-9a-f]{6}/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null)
  const x = p(a)
  const y = p(b)
  if (!x || !y) return a
  const hex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")
  return `#${x.map((v, i) => hex(v + (y[i]! - v) * k)).join("")}${alpha === undefined ? "" : hex(alpha * 255)}`
}

/** GarageBand's colours: a drummer's yellow, a software instrument's green, audio's blue. */
const KIND = { drummer: "#e6b93c", instrument: "#5fbf5a", audio: "#3d8ee6" }
/** The arrangement track's parts, each its own colour. */
const PARTS = ["#7d8ca3", "#5fae6e", "#9a6fd6", "#d0705f", "#4fa3c4", "#c79a42", "#b06aa8"]
const METER = [{ color: "#30c26b", position: 0 }, { color: "#30c26b", position: 0.72 }, { color: "#f0c43a", position: 0.88 }, { color: "#ef4b4b", position: 1 }]

/**
 * GarageBand's own dark look, whatever the theme: charcoal panes, a lighter toolbar, the LCD
 * near black, regions in their kinds' colours.
 */
const GB = {
  text: "#e8e8ea",
  muted: "#a9a9ae",
  faint: "#77777c",
  success: "#5fbf5a",
  hover: "#3a3a3d",
  window: "#2c2c2e",
  editor: "#262628",
  surface: "#303033",
}
const TOOLBAR = { type: "linear-gradient" as const, angle: 180, stops: [{ color: "#3d3d40" }, { color: "#323235" }] }

const HEADER = 236
const RULER = 26
const ARRANGE = 24
const TRACK = 56

type Song = View
type TrackView = Song["tracks"][number]

/** What a track's regions hold, as one SVG across the whole song (the regions frame it). */
function regionArt(t: TrackView, d: number): string {
  const W = 1200
  const H = 100
  const x = (s: number) => ((s / d) * W).toFixed(1)
  let body = ""
  const notes = t.notes ?? []
  if (t.kind === "audio" || !notes.length) {
    const n = t.waveform.length
    body = t.waveform
      .map((v, c) => {
        const h = Math.max(1, (v / 255) * 84)
        return `<rect x="${((c / n) * W).toFixed(1)}" y="${(50 - h / 2).toFixed(1)}" width="${((W / n) * 0.7).toFixed(1)}" height="${h.toFixed(1)}"/>`
      })
      .join("")
  } else if (t.kind === "drummer") {
    // Three lanes, as the Drummer editor has them: cymbals and shakers, snares and claps, kicks.
    const lane = (n: number) => (n === 35 || n === 36 ? 2 : n === 38 || n === 39 || n === 40 || n === 37 ? 1 : 0)
    body = notes
      .map(([s, , n, v]) => {
        const l = lane(n)
        const h = 8 + (v / 127) * 20
        return `<rect x="${x(s)}" y="${(10 + l * 30 + (28 - h) / 2).toFixed(1)}" width="2.2" height="${h.toFixed(1)}" rx="1"/>`
      })
      .join("")
  } else {
    // A piano roll: each note a bar at its pitch, the track's own range filling the region.
    const lo = Math.min(...notes.map((n) => n[2]))
    const hi = Math.max(...notes.map((n) => n[2]))
    const span = Math.max(12, hi - lo + 1)
    const row = 84 / span
    body = notes
      .map(([s, len, n]) => `<rect x="${x(s)}" y="${(8 + (hi - n) * row).toFixed(1)}" width="${Math.max(2, (len / d) * W - 1).toFixed(1)}" height="${Math.max(2.5, row * 0.8).toFixed(1)}" rx="1"/>`)
      .join("")
  }
  return I.uri(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><g fill="currentColor">${body}</g></svg>`)
}

export function Player({ tab }: RendererProps) {
  const t = { ...useTheme(), ...GB }
  const [song, setSong] = useState<Song | null>(null)
  const [missing, setMissing] = useState<string>()
  const [error, setError] = useState<string>()
  const [ps, setPs] = useState<PlayState | null>(null)
  const [now, setNow] = useState(Date.now())
  /** The part picked on the ruler (the cycle), in hit columns, while dragging and after. */
  const [pick, setPick] = useState<{ a: number; b: number } | null>(null)
  const [draft, setDraft] = useState("")
  const seen = useRef(0)
  const caps = useRef<number[]>([])
  const holds = useRef<[number, number]>([-60, -60])

  // The song, and again whenever it (its markers, tracks or notes) is written again.
  const path = song?.path
  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const v = await rpc(view(tab.id))
        if (!live || !v) return
        if (v.missing) return setMissing(v.path)
        setMissing(undefined)
        setError(undefined)
        setSong(v)
        seen.current = await rpc(version(v.path))
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e))
      }
    }
    if (!path) void load()
    const poll = setInterval(async () => {
      if (!path) return
      const v = await rpc(version(path)).catch(() => seen.current)
      if (v !== seen.current) void load()
    }, 1000)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [tab.id, path])

  // Where it is: asked of the worker four times a second, moved on in between at 30 frames a second.
  useEffect(() => {
    let live = true
    const ask = () => rpc(state(tab.id)).then((s) => live && setPs(s)).catch(() => {})
    void ask()
    const poll = setInterval(ask, 250)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [tab.id])
  useEffect(() => {
    if (!ps?.playing) return
    const tick = setInterval(() => setNow(Date.now()), 33)
    return () => clearInterval(tick)
  }, [ps?.playing])

  const art = useMemo(() => new Map((song?.tracks ?? []).map((tr) => [tr.id, regionArt(tr, song!.duration)])), [song?.tracks, song?.duration])
  const mixArt = useMemo(() => (song ? regionArt({ id: "mix", name: song.title, kind: "audio", waveform: song.waveform, lufs: song.lufs, bars: [] } as TrackView, song.duration) : ""), [song?.waveform])

  if (error) return <Middle text={`The song could not be read: ${error}`} />
  if (missing) return <Middle text={`No file at ${missing}`} />
  if (!song) return <Middle text="Analysing…" />

  // ── Where it is ──
  const d = song.duration
  const playing = !!ps?.playing
  const pos = ps ? Math.max(0, Math.min(d, playing ? ps.position + (now - ps.now) / 1000 : ps.position)) : 0
  const frames = Math.floor(song.spectrum.length / song.bands)
  const frame = Math.max(0, Math.min(Math.floor(pos * song.fps), frames - 1))
  const levels = playing ? song.spectrum.slice(frame * song.bands, frame * song.bands + song.bands).map((v) => v / 255) : new Array(song.bands).fill(0)
  caps.current = levels.map((v, i) => Math.max(v, (caps.current[i] ?? 0) - 0.01))
  const m = song.meters.slice(frame * 4, frame * 4 + 4)
  const peakL = playing ? m[0]! / 10 : -60
  const peakR = playing ? m[1]! / 10 : -60
  holds.current = [Math.max(peakL, holds.current[0] - 0.4), Math.max(peakR, holds.current[1] - 0.4)]
  const momentary = playing ? m[2]! / 10 : null
  const spb = 60 / song.bpm
  const beatIn = Math.max(0, (pos - song.offset) / spb)
  const per = song.beatsPerBar
  const barNo = Math.floor(beatIn / per) + 1
  const beatNo = (Math.floor(beatIn) % per) + 1
  const pulse = playing ? Math.max(0, 1 - (beatIn - Math.floor(beatIn)) * 3) : 0
  const sel = pick ? { from: (Math.min(pick.a, pick.b) / HIT) * d, to: ((Math.max(pick.a, pick.b) + 1) / HIT) * d } : null
  const parts = song.sections.map((s, i) => ({ ...s, to: song.sections[i + 1]?.at ?? d, color: PARTS[i % PARTS.length]! })).filter((s) => s.to - s.at > 0.6)
  const muted = new Set(ps?.muted ?? [])
  const solo = new Set(ps?.solo ?? [])
  const silent = (id: string) => (solo.size ? !solo.has(id) : muted.has(id))
  const tracks: TrackView[] = song.tracks.length ? song.tracks : [{ id: "mix", name: song.title, kind: "audio", icon: "audio", waveform: song.waveform, lufs: song.lufs, bars: [], regions: [[0, d]] } as TrackView]

  // ── Palette ──
  const chrome = "#353538"
  const lane = "#252527"
  const header = "#2f2f32"
  const line = "#1a1a1b"
  const lcd = "#18181a"
  const cycle = "#f2c83a"

  const save = async () => {
    const text = draft.trim()
    if (!sel || !text) return
    const note = await rpc(addNote(song.path, sel.from, sel.to, text))
    setDraft("")
    setPick(null)
    setSong({ ...song, notes: [...song.notes, note].sort((a, b) => a.from - b.from) })
  }
  const seek = (from: number) => void rpc(play(tab.id, { from })).then(setPs)
  const loopOn = !!ps?.loop

  // ── Pieces ──
  const tool = (icon: string, onClick: () => void, opts: { title: string; on?: string; fill?: boolean; wide?: boolean }) => (
    <div
      onClick={onClick}
      aria-label={opts.title}
      role="button"
      style={{
        display: "flex",
        width: opts.wide ? 46 : 36,
        height: 28,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: opts.on ? opts.on : { type: "linear-gradient", angle: 180, stops: [{ color: "#58585c" }, { color: "#4a4a4e" }] },
        boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#00000066" },
        hover: { background: opts.on ? opts.on : "#5f5f63" },
      }}
    >
      <svg src={opts.fill ? I.filled(icon) : icon} style={{ width: 14, height: 14, color: opts.on ? "#1b1b1b" : t.text }} />
    </div>
  )
  const small = (icon: string, onClick: () => void, opts: { title: string; on?: string }) => (
    <div
      onClick={onClick}
      aria-label={opts.title}
      role="button"
      style={{
        display: "flex",
        width: 22,
        height: 18,
        borderRadius: 4,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        backgroundColor: opts.on ?? mix(t.text, header, 0.9),
        hover: { backgroundColor: opts.on ?? mix(t.text, header, 0.8) },
      }}
    >
      <svg src={icon} style={{ width: 11, height: 11, color: opts.on ? "#1b1b1b" : t.muted }} />
    </div>
  )
  const lcdCell = (value: string, label: string, w: number, big = false) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: w, flexShrink: 0, gap: 1 }}>
      <text style={{ fontSize: big ? 22 : 17, color: "#f2f2f4", fontWeight: 300, whiteSpace: "nowrap" }}>{value}</text>
      <text style={{ fontSize: 8, color: "#8e8e93", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</text>
    </div>
  )
  const lcdLine = () => <div style={{ width: 1, alignSelf: "stretch", marginTop: 7, marginBottom: 7, backgroundColor: mix(t.text, lcd, 0.88) }} />
  const grid = song.bars.map((b) => <div key={b.n} style={{ position: "absolute", top: 0, bottom: 0, left: pct(b.from / d), width: 1, backgroundColor: "#303033" }} />)
  const playhead = (head: boolean) => (
    <>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(pos / d), width: 1, backgroundColor: "#ffffff", opacity: playing || pos > 0 ? 0.95 : 0 }} />
      {head ? <div style={{ position: "absolute", top: 2, left: pct(pos / d), marginLeft: -6, width: 13, height: 10, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, backgroundColor: "#ffffff", opacity: playing || pos > 0 ? 1 : 0 }} /> : null}
    </>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: lane }}>
      {/* ── Toolbar: transport, LCD, title ── */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 54, flexShrink: 0, paddingLeft: 12, paddingRight: 12, background: TOOLBAR, borderBottomWidth: 1, borderColor: line }}>
        {tool(I.skipBack, () => seek(0), { title: "Go to the beginning", fill: true })}
        {tool(playing ? I.pause : I.play, () => void rpc(toggle(tab.id)).then(setPs), { title: playing ? "Pause" : "Play", fill: true, wide: true })}
        {tool(I.square, () => void rpc(stop(tab.id)).then(setPs), { title: "Stop", fill: true })}
        {tool(I.repeat2, () => (sel ? void rpc(play(tab.id, { from: sel.from, to: sel.to, loop: !loopOn })).then(setPs) : undefined), { title: "Cycle", on: loopOn ? cycle : undefined })}
        <div style={{ flexGrow: 1, minWidth: 8 }} />
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            height: 44,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 7,
            borderWidth: 1,
            borderColor: "#0d0d0e",
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
            backgroundColor: lcd,
            boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 4, spreadRadius: 0, color: "#00000099", inset: true },
          }}
        >
          {lcdCell(`${barNo}   ${beatNo}`, "BAR      BEAT", 96, true)}
          {lcdLine()}
          {lcdCell(String(Math.round(song.bpm)), "TEMPO", 56)}
          {lcdLine()}
          {lcdCell(`${per}/4`, song.key.replace(/ major$/, " maj").replace(/ minor$/, " min").replace(/^(\S+) maj$/, "$1maj").replace(/^(\S+) min$/, "$1min"), 64)}
          {lcdLine()}
          {lcdCell(clock(pos), "TIME", 64)}
          <div style={{ width: 7, height: 7, borderRadius: 999, marginLeft: 4, marginRight: 4, flexShrink: 0, backgroundColor: mix("#ffffff", lcd, 1 - pulse) }} />
        </div>
        <div style={{ flexGrow: 1, minWidth: 8 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0, flexShrink: 1, overflow: "hidden" }}>
          <text style={{ fontSize: 13, fontWeight: 700, color: t.text, whiteSpace: "nowrap" }}>{song.title}</text>
          <text style={{ fontSize: 10, color: t.faint, whiteSpace: "nowrap" }}>{`${song.artist ? `${song.artist} · ` : ""}${tracks.length} tracks · ${song.lufs.toFixed(1)} LUFS`}</text>
        </div>
      </div>

      {/* ── Ruler and arrangement track, fixed over the tracks ── */}
      <div style={{ display: "flex", flexDirection: "row", flexShrink: 0, borderBottomWidth: 1, borderColor: line }}>
        <div style={{ display: "flex", flexDirection: "column", width: HEADER, flexShrink: 0, backgroundColor: header, borderRightWidth: 1, borderColor: line }}>
          <div style={{ height: RULER, borderBottomWidth: 1, borderColor: line }} />
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, height: ARRANGE, paddingLeft: 10 }}>
            <svg src={I.listMusic} style={{ width: 12, height: 12, color: t.muted }} />
            <text style={{ fontSize: 11, color: t.muted, fontWeight: 600 }}>Arrangement</text>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ height: RULER, backgroundColor: chrome, borderBottomWidth: 1, borderColor: line }}>
            {song.bars.map((b) => (
              <div key={b.n} style={{ position: "absolute", left: pct(b.from / d), top: 0, bottom: 0, width: 1, backgroundColor: mix(t.text, chrome, 0.65) }}>
                <text style={{ position: "absolute", left: 4, top: 10, width: 28, whiteSpace: "nowrap", fontSize: 10, color: "#c4c4c8" }}>{String(b.n)}</text>
              </div>
            ))}
            {song.bars.flatMap((b) => [1, 2, 3].map((k) => <div key={`${b.n}.${k}`} style={{ position: "absolute", left: pct((b.from + k * spb) / d), bottom: 0, height: 5, width: 1, backgroundColor: mix(t.text, chrome, 0.78) }} />))}
            {sel ? <div style={{ position: "absolute", top: 1, height: 9, left: pct(sel.from / d), width: pct((sel.to - sel.from) / d), borderRadius: 2, backgroundColor: mix(cycle, chrome, loopOn ? 0 : 0.4) }} /> : null}
          </div>
          <div style={{ height: ARRANGE, backgroundColor: lane }}>
            {parts.map((s) => (
              <div key={s.name + s.at} style={{ position: "absolute", top: 3, bottom: 3, left: pct(s.at / d), width: pct((s.to - s.at) / d), marginLeft: 1, paddingLeft: 7, borderRadius: 4, justifyContent: "center", overflow: "hidden", backgroundColor: mix(s.color, lane, 0.25) }}>
                <text style={{ fontSize: 10, fontWeight: 700, color: "#ffffff", whiteSpace: "nowrap" }}>{s.name[0]!.toUpperCase() + s.name.slice(1)}</text>
              </div>
            ))}
          </div>
          {playhead(true)}
          <Hits pick={pick} setPick={setPick} seek={(c) => seek((c / HIT) * d)} />
        </div>
      </div>

      {/* ── The tracks ── */}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: TRACK * 2, overflowY: "scroll" }}>
        <div style={{ display: "flex", flexDirection: "row", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", width: HEADER, flexShrink: 0, backgroundColor: header, borderRightWidth: 1, borderColor: line }}>
            {tracks.map((tr) => {
              const color = tr.color ?? KIND[tr.kind]
              const off = silent(tr.id)
              return (
                <div key={tr.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 9, height: TRACK, paddingLeft: 8, paddingRight: 8, borderBottomWidth: 1, borderColor: line, opacity: off ? 0.55 : 1 }}>
                  <div style={{ display: "flex", width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0, background: { type: "linear-gradient", angle: 180, stops: [{ color: "#4b4b4f" }, { color: "#3a3a3d" }] }, borderWidth: 1, borderColor: "#202022" }}>
                    <svg src={I.instrument[tr.icon ?? ""] ?? I.audioLines} style={{ width: 21, height: 21, color: mix(color, "#ffffff", 0.2) }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: "hidden", gap: 4 }}>
                    <text style={{ fontSize: 12, color: t.text, fontWeight: 600, whiteSpace: "nowrap" }}>{tr.name}</text>
                    <div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
                      {small(muted.has(tr.id) ? I.volumeX : I.volume2, () => void rpc(setMix(tab.id, tr.id, "mute")).then(setPs), { title: "Mute", on: muted.has(tr.id) ? "#5aa9f0" : undefined })}
                      {small(I.headphones, () => void rpc(setMix(tab.id, tr.id, "solo")).then(setPs), { title: "Solo", on: solo.has(tr.id) ? cycle : undefined })}
                      {/* Its level, as a meter: the stem's loudness. */}
                      <div style={{ flexGrow: 1, height: 3, alignSelf: "center", marginLeft: 6, marginRight: 4, borderRadius: 2, backgroundColor: "#1c1c1e" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct((tr.lufs + 40) / 34), borderRadius: 2, backgroundColor: "#8a8a8f" }} />
                        <div style={{ position: "absolute", top: -4, left: pct((tr.lufs + 40) / 34), marginLeft: -5, width: 11, height: 11, borderRadius: 999, background: { type: "linear-gradient", angle: 180, stops: [{ color: "#e9e9ec" }, { color: "#b9b9bd" }] }, boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "#00000088" } }} />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
            {tracks.map((tr) => {
              const color = tr.color ?? KIND[tr.kind]
              const off = silent(tr.id)
              const base = off ? "#7c7c7c" : color
              return (
                <div key={tr.id} style={{ height: TRACK, backgroundColor: lane, borderBottomWidth: 1, borderColor: line }}>
                  {grid}
                  {(tr.regions ?? [[0, d]]).map(([a, b], i) => (
                    <div key={i} style={{ position: "absolute", top: 1, bottom: 1, left: pct(a / d), width: pct((b - a) / d), marginLeft: 1, marginRight: 1, borderRadius: 4, overflow: "hidden", backgroundColor: mix(base, "#000000", 0.12), borderWidth: 1, borderColor: mix(base, "#000000", 0.45) }}>
                      <div style={{ height: 14, paddingLeft: 5, justifyContent: "center", backgroundColor: mix(base, "#ffffff", 0.18) }}>
                        <text style={{ fontSize: 9, fontWeight: 600, color: mix(base, "#000000", 0.72), whiteSpace: "nowrap" }}>{tr.name}</text>
                      </div>
                    </div>
                  ))}
                  {/* The regions' contents, drawn once across the song; only the regions show it. */}
                  <svg src={art.get(tr.id) ?? mixArt} style={{ position: "absolute", left: 0, right: 0, top: 17, height: TRACK - 21, width: "100%", color: mix(base, "#000000", 0.55) }} />
                </div>
              )
            })}
            {/* Notes, as a track of their own. */}
            <div style={{ height: 30, backgroundColor: lane }}>
              {grid}
              {song.notes.map((n) => (
                <div key={n.id} style={{ position: "absolute", top: 4, bottom: 4, left: pct(n.from / d), width: pct(Math.max(0.004, (n.to - n.from) / d)), paddingLeft: 6, borderRadius: 4, justifyContent: "center", overflow: "hidden", backgroundColor: n.done ? mix(t.faint, lane, 0.4) : "#f2d15c" }}>
                  <text style={{ fontSize: 10, color: "#3a2f00", whiteSpace: "nowrap" }}>{n.text}</text>
                </div>
              ))}
            </div>
            {sel ? <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(sel.from / d), width: pct((sel.to - sel.from) / d), backgroundColor: mix(cycle, lane, 0, 0.12), borderLeftWidth: 1, borderRightWidth: 1, borderColor: mix(cycle, lane, 0.3) }} /> : null}
            {playhead(false)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", height: 30, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, width: HEADER, paddingLeft: 12, backgroundColor: header, borderRightWidth: 1, borderColor: line }}>
            <svg src={I.stickyNote} style={{ width: 12, height: 12, color: "#f2d15c" }} />
            <text style={{ fontSize: 11, color: t.muted, fontWeight: 600 }}>{`Notes · ${song.notes.filter((n) => !n.done).length} open`}</text>
          </div>
        </div>
      </div>

      {/* ── A note on the cycle ── */}
      {sel ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 44, flexShrink: 0, paddingLeft: 12, paddingRight: 12, backgroundColor: chrome, borderTopWidth: 1, borderColor: line }}>
          <svg src={I.messageSquarePlus} style={{ width: 15, height: 15, color: "#f2d15c", flexShrink: 0 }} />
          <text style={{ fontSize: 11, fontFamily: MONO, color: "#f2d15c", flexShrink: 0 }}>{`${clock(sel.from)} – ${clock(sel.to)}`}</text>
          <input
            value={draft}
            placeholder="Note on this part… (Enter saves, Esc cancels)"
            autoFocus
            onChange={(e: any) => setDraft(e?.value ?? "")}
            onSubmit={() => void save()}
            onKeyDown={(e: any) => {
              if (e?.key === "escape") setPick(null)
            }}
            style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 6, backgroundColor: lane, color: t.text, fontSize: 12, borderWidth: 1, borderColor: mix("#f2d15c", lane, 0.4) }}
          />
          {tool(I.repeat2, () => void rpc(play(tab.id, { from: sel.from, to: sel.to, loop: true })).then(setPs), { title: "Cycle it", on: loopOn ? cycle : undefined })}
          {tool(I.x, () => setPick(null), { title: "Cancel" })}
        </div>
      ) : null}

      {/* ── Smart controls: spectrum, meters, notes ── */}
      <div style={{ display: "flex", flexDirection: "row", height: 150, flexShrink: 0, minWidth: 0, borderTopWidth: 1, borderColor: line, backgroundColor: mix(lane, "#000000", 0.2) }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 6 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", flexGrow: 1, minHeight: 30, gap: 2 }}>
            {[0, 12, 24, 36, 48, 60].map((db) => (
              <div key={db} style={{ position: "absolute", left: 0, right: 0, top: pct(db / 72), height: 1, backgroundColor: mix(t.text, lane, 0.93) }}>
                <text style={{ position: "absolute", right: 0, top: -11, fontSize: 8, fontFamily: MONO, color: t.faint }}>{db ? `-${db}` : "0 dB"}</text>
              </div>
            ))}
            {levels.map((k, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", flexGrow: 1, flexBasis: 0, minWidth: 0, height: "100%" }}>
                <div style={{ position: "absolute", left: 0, right: 0, height: 2, borderRadius: 1, bottom: pct(caps.current[i]!), backgroundColor: mix(t.text, lane, 0.25, playing ? 0.9 : 0) }} />
                <div style={{ height: pct(k), borderTopLeftRadius: 2, borderTopRightRadius: 2, background: { type: "linear-gradient", angle: 0, stops: [{ color: "#2c6e49" }, { color: mix("#5fbf5a", "#e8f7c8", Math.max(0, k - 0.55) * 1.8) }], colorSpace: "oklab" } }} />
              </div>
            ))}
          </div>
          <div style={{ height: 14, marginTop: 3 }}>
            {[["50", 50], ["100", 100], ["250", 250], ["500", 500], ["1k", 1000], ["2.5k", 2500], ["5k", 5000], ["10k", 10000]].map(([label, hz]) => (
              <text key={label} style={{ position: "absolute", top: 1, left: pct(Math.log(Number(hz) / 40) / Math.log(16000 / 40)), fontSize: 8, fontFamily: MONO, color: t.faint }}>
                {String(label)}
              </text>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", width: 190, flexShrink: 0, gap: 12, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderLeftWidth: 1, borderColor: line, backgroundColor: header }}>
          <div style={{ display: "flex", flexDirection: "row", gap: 3 }}>
            {[peakL, peakR].map((db, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div style={{ width: 8, flexGrow: 1, borderRadius: 2, overflow: "hidden", backgroundColor: mix(t.text, header, 0.92) }}>
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: pct((db + 60) / 60), background: { type: "linear-gradient", angle: 0, stops: METER } }} />
                  <div style={{ position: "absolute", left: 0, right: 0, height: 2, bottom: pct((holds.current[i]! + 60) / 60), backgroundColor: holds.current[i]! > -1 ? "#ef4b4b" : t.text, opacity: playing ? 1 : 0 }} />
                </div>
                <text style={{ fontSize: 8, color: t.faint, fontFamily: MONO }}>{i ? "R" : "L"}</text>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, justifyContent: "space-between" }}>
            {[
              ["MOMENTARY", momentary === null || momentary <= -69 ? "—" : momentary.toFixed(1)],
              ["INTEGRATED", song.lufs.toFixed(1)],
              ["TRUE PEAK", `${song.truePeak.toFixed(1)}`],
            ].map(([label, v]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <text style={{ fontSize: 8, color: t.faint, fontWeight: 600 }}>{label}</text>
                <text style={{ fontSize: 15, fontFamily: MONO, color: t.text }}>{v}</text>
              </div>
            ))}
          </div>
        </div>
        {song.notes.length ? (
          <div style={{ display: "flex", flexDirection: "column", width: 250, flexShrink: 0, borderLeftWidth: 1, borderColor: line, backgroundColor: header }}>
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
              {song.notes.map((n: Note) => (
                <div key={n.id} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 7, paddingLeft: 10, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderBottomWidth: 1, borderColor: line, hover: { backgroundColor: t.hover } }}>
                  <div onClick={() => void rpc(markNote(song.path, n.id, !n.done)).then(() => setSong({ ...song, notes: song.notes.map((x) => (x.id === n.id ? { ...x, done: !n.done } : x)) }))} aria-label={n.done ? "Open it again" : "Mark it done"} role="button" style={{ flexShrink: 0, paddingTop: 1 }}>
                    <svg src={n.done ? I.circleCheck : I.circle} style={{ width: 13, height: 13, color: n.done ? t.success : t.faint }} />
                  </div>
                  <div onClick={() => void rpc(play(tab.id, { from: n.from, to: n.to })).then(setPs)} style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
                    <text style={{ fontSize: 9, fontFamily: MONO, color: n.done ? t.faint : "#f2d15c" }}>{`${clock(n.from)} – ${clock(n.to)}`}</text>
                    <text style={{ fontSize: 11, color: n.done ? t.faint : t.text }}>{n.text}</text>
                  </div>
                  <div onClick={() => void rpc(removeNote(song.path, n.id)).then(() => setSong({ ...song, notes: song.notes.filter((x) => x.id !== n.id) }))} aria-label="Delete it" role="button" style={{ flexShrink: 0, paddingTop: 1 }}>
                    <svg src={I.trash2} style={{ width: 12, height: 12, color: t.faint }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The ruler's hit columns: press one to play from there, drag across them to pick a part. */
const HIT = 160
type Pick = { a: number; b: number } | null
const Hits = memo(
  function Hits({ setPick, seek }: { pick: Pick; setPick: (p: Pick) => void; seek: (c: number) => void }) {
    const down = useRef<number | null>(null)
    const moved = useRef(false)
    return (
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, display: "flex", flexDirection: "row" }}>
        {Array.from({ length: HIT }, (_, c) => (
          <div
            key={c}
            onMouseDown={() => {
              down.current = c
              moved.current = false
            }}
            onMouseEnter={() => {
              const a = down.current
              if (a === null) return
              moved.current = true
              setPick({ a, b: c })
            }}
            onMouseUp={() => {
              const a = down.current
              down.current = null
              if (a === null) return
              if (!moved.current && a === c) {
                setPick(null)
                seek(c)
              } else setPick({ a, b: c })
            }}
            style={{ flexGrow: 1, flexBasis: 0, height: "100%", cursor: "pointer" }}
          />
        ))}
      </div>
    )
  },
  (a, b) => a.pick === b.pick,
)

function Middle({ text }: { text: string }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: t.editor }}>
      <text style={{ color: t.muted, fontSize: 13 }}>{text}</text>
    </div>
  )
}
