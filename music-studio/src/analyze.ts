// What a song is, measured: so whoever cannot hear it (an agent) can still tell what it does, bar
// by bar. The file is decoded by ffmpeg; its tempo and key are essentia's, the rest (spectrum,
// bands, chords, loudness, stereo, timing against the grid) is worked out here.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { bin } from "./bin.ts"

export const SR = 44100
/** The spectrum the player draws: so many bands a frame, so many frames a second. */
export const BANDS = 56
export const FPS = 30
/** The waveform the player draws, in columns. */
export const COLUMNS = 240

/** What the song's maker says of it, beside it as `<file>.markers.json`: its grid and its parts. */
export interface Markers {
  bpm?: number
  /** Seconds from the start to the first downbeat. */
  offset?: number
  beatsPerBar?: number
  sections?: { at: number; name: string }[]
  /** Moments to line up with (a video's cuts). */
  cues?: { at: number; name: string }[]
  /** What each bar's chord was meant to be, to check against what is heard. */
  chords?: string[]
}

/** One of a project's parts, beside the mix as `<file>.tracks.json`: GarageBand's tracks. */
export interface TrackSpec {
  id: string
  name: string
  /** A drummer, a software instrument, or audio: how its regions are drawn. */
  kind: "drummer" | "instrument" | "audio"
  icon?: string
  color?: string
  /** Its stem: the part alone, as it sits in the mix. */
  file: string
  /** What it plays: [start s, length s, MIDI note, velocity]. */
  notes?: [number, number, number, number][]
  /** Where it has something, [from s, to s]. */
  regions?: [number, number][]
}

export interface Track extends TrackSpec {
  /** Integrated loudness of its stem, LUFS, and each bar's. */
  lufs: number
  bars: number[]
  /** `COLUMNS` peaks (0-255). */
  waveform: number[]
}

export interface Bar {
  n: number
  from: number
  to: number
  section?: string
  /** Short-term loudness, LUFS. */
  lufs: number
  /** Sample peak, dBFS. */
  peak: number
  /** Energy below 150 Hz, 150 Hz to 2 kHz, above 2 kHz, in dB. */
  low: number
  mid: number
  high: number
  /** The triad that fits the bar's pitch classes best, and how well (0-1). */
  chord: string
  chordFit: number
  /** What it was meant to be (markers), when said. */
  meant?: string
  /** Sensory dissonance, 0 (smooth) to ~0.5 (rough). */
  dissonance: number
  onsets: number
  /** How far the onsets sit from the nearest sixteenth, mean, in ms. */
  offGrid: number
  /** Left/right correlation, 1 mono to -1 out of phase, and side to mid energy, dB. */
  correlation: number
  width: number
}

export interface Analysis {
  path: string
  mtime: number
  duration: number
  title: string
  artist: string
  bpm: number
  /** Essentia's own tempo, whatever the markers say. */
  detectedBpm: number
  bpmConfidence: number
  key: string
  keyStrength: number
  integrated: number
  range: number
  truePeak: number
  clipped: number
  markers: Markers
  bars: Bar[]
  /** Short-term loudness every 0.1s, LUFS. */
  loudness: number[]
  onsets: number[]
  /** For the player: `BANDS` levels (0-255) a frame, `FPS` frames a second, flat. */
  spectrum: number[]
  /** For the player: `COLUMNS` peaks (0-255). */
  waveform: number[]
  /**
   * For the player's meters, `FPS` frames a second, four numbers a frame: the left and right
   * peaks over the last 50 ms (dBFS x10), the momentary loudness (LUFS x10, 400 ms), and the
   * left/right correlation over the last 100 ms (x100).
   */
  meters: number[]
  problems: string[]
  tracks: Track[]
}

// ── Decoding ──────────────────────────────────────────────────────────
function decode(path: string): { l: Float32Array; r: Float32Array } {
  const out = spawnSync(bin("ffmpeg"), ["-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", String(SR), "-"], { maxBuffer: 1 << 30 })
  if (out.status !== 0) throw new Error(`ffmpeg could not read ${path}: ${out.error?.message ?? out.stderr?.toString().trim()}`)
  const buf = out.stdout as Buffer
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const n = all.length / 2
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    l[i] = all[2 * i]!
    r[i] = all[2 * i + 1]!
  }
  return { l, r }
}

function tags(path: string): Record<string, string> {
  const out = spawnSync(bin("ffprobe"), ["-v", "error", "-show_entries", "format_tags", "-of", "json", path], { encoding: "utf8" })
  try {
    const t = JSON.parse(out.stdout).format?.tags ?? {}
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k.toLowerCase(), String(v)]))
  } catch {
    return {}
  }
}

// ── Spectrum ──────────────────────────────────────────────────────────
/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len
    const wr = Math.cos(a)
    const wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const p = i + k
        const q = p + len / 2
        const tr = re[q]! * cr - im[q]! * ci
        const ti = re[q]! * ci + im[q]! * cr
        re[q] = re[p]! - tr
        im[q] = im[p]! - ti
        re[p]! += tr
        im[p]! += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

const SIZE = 4096
const HANN = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE))

/** The magnitude spectrum of the `SIZE` samples centred on `at`. */
function spectrumAt(mono: Float32Array, at: number): Float64Array {
  const re = new Float64Array(SIZE)
  const im = new Float64Array(SIZE)
  const start = at - SIZE / 2
  for (let i = 0; i < SIZE; i++) {
    const j = start + i
    re[i] = j >= 0 && j < mono.length ? mono[j]! * HANN[i]! : 0
  }
  fft(re, im)
  const mag = new Float64Array(SIZE / 2)
  for (let i = 0; i < SIZE / 2; i++) mag[i] = Math.hypot(re[i]!, im[i]!) / (SIZE / 4)
  return mag
}

const binHz = SR / SIZE
const db = (x: number) => 10 * Math.log10(x + 1e-12)

// ── Loudness (BS.1770) ────────────────────────────────────────────────
/** The K-weighting filter's two biquads, at 44.1 kHz. */
function kWeight(x: Float32Array): Float64Array {
  const stages = [
    { b: [1.53090959966428, -2.65116903469258, 1.16916686457007], a: [-1.66375011153713, 0.712595428073225] },
    { b: [1, -2, 1], a: [-1.98916967362980, 0.989199640723098] },
  ]
  let y = Float64Array.from(x)
  for (const { b, a } of stages) {
    const out = new Float64Array(y.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < y.length; i++) {
      const v = b[0]! * y[i]! + b[1]! * x1 + b[2]! * x2 - a[0]! * y1 - a[1]! * y2
      x2 = x1
      x1 = y[i]!
      y2 = y1
      y1 = v
      out[i] = v
    }
    y = out
  }
  return y
}

function loudnessOf(l: Float32Array, r: Float32Array) {
  const kl = kWeight(l)
  const kr = kWeight(r)
  // Squares summed, so any window's mean square is two lookups.
  const sum = new Float64Array(kl.length + 1)
  for (let i = 0; i < kl.length; i++) sum[i + 1] = sum[i]! + kl[i]! * kl[i]! + kr[i]! * kr[i]!
  const lufs = (from: number, to: number) => {
    const a = Math.max(0, Math.floor(from * SR))
    const b = Math.min(kl.length, Math.floor(to * SR))
    if (b <= a) return -70
    return Math.max(-70, -0.691 + db((sum[b]! - sum[a]!) / (b - a)))
  }
  const duration = l.length / SR
  const shortTerm: number[] = []
  for (let t = 0; t < duration; t += 0.1) shortTerm.push(lufs(t - 3, t))
  // Integrated: 400 ms blocks, gated at -70 and then 10 LU under their mean.
  const blocks: number[] = []
  for (let t = 0; t + 0.4 <= duration; t += 0.1) blocks.push(lufs(t, t + 0.4))
  const mean = (xs: number[]) => -0.691 + db(xs.reduce((s, v) => s + 10 ** ((v + 0.691) / 10), 0) / Math.max(1, xs.length))
  const loud = blocks.filter((b) => b > -70)
  const rel = mean(loud) - 10
  const integrated = mean(loud.filter((b) => b > rel))
  const st = shortTerm.filter((v) => v > -70 && v > integrated - 20).sort((a, b) => a - b)
  const range = st.length ? st[Math.floor(st.length * 0.95)]! - st[Math.floor(st.length * 0.1)]! : 0
  return { lufs, shortTerm, integrated, range }
}

/** The highest peak between samples, 4x oversampled (dBTP). */
function truePeak(x: Float32Array): number {
  let peak = 0
  const taps = 8
  for (let i = taps; i < x.length - taps; i++) {
    peak = Math.max(peak, Math.abs(x[i]!))
    for (const f of [0.25, 0.5, 0.75]) {
      let v = 0
      for (let k = -taps + 1; k <= taps; k++) {
        const d = k - f
        const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / taps)
        v += x[i + k]! * (Math.sin(Math.PI * d) / (Math.PI * d)) * w
      }
      peak = Math.max(peak, Math.abs(v))
    }
  }
  return 20 * Math.log10(peak + 1e-12)
}

// ── Chords ────────────────────────────────────────────────────────────
const PITCH = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

/** The major and minor triad that fit a chroma best, and how well (cosine). */
function triad(chroma: number[]): { name: string; fit: number } {
  let best = { name: "N", fit: 0 }
  const norm = Math.hypot(...chroma) || 1
  for (let root = 0; root < 12; root++) {
    for (const [suffix, third] of [["", 4], ["m", 3]] as const) {
      const t = new Array(12).fill(0)
      t[root] = 1
      t[(root + third) % 12] = 0.8
      t[(root + 7) % 12] = 0.8
      const fit = t.reduce((s, v, i) => s + v * chroma[i]!, 0) / (norm * Math.hypot(...t))
      if (fit > best.fit) best = { name: PITCH[root] + suffix, fit }
    }
  }
  return best
}

/** Plomp and Levelt's roughness of a spectrum's strongest peaks. */
function roughness(mag: Float64Array): number {
  const peaks: [number, number][] = []
  for (let i = 2; i < mag.length - 2; i++) {
    const f = i * binHz
    if (f < 60 || f > 5000) continue
    if (mag[i]! > mag[i - 1]! && mag[i]! >= mag[i + 1]! && mag[i]! > 1e-4) peaks.push([f, mag[i]!])
  }
  peaks.sort((a, b) => b[1] - a[1])
  const top = peaks.slice(0, 24)
  const total = top.reduce((s, p) => s + p[1], 0) || 1
  let d = 0
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const [f1, a1] = top[i]!
      const [f2, a2] = top[j]!
      const s = 0.24 / (0.021 * Math.min(f1, f2) + 19)
      const x = Math.abs(f2 - f1) * s
      d += ((a1 * a2) / (total * total)) * (Math.exp(-3.5 * x) - Math.exp(-5.75 * x))
    }
  }
  return Math.min(1, d * 4)
}

// ── Essentia ──────────────────────────────────────────────────────────
let essentia: any
async function ess() {
  if (!essentia) {
    const mod: any = await import("essentia.js")
    essentia = new mod.Essentia(mod.EssentiaWASM)
  }
  return essentia
}

// ── The analysis ──────────────────────────────────────────────────────
const cache = new Map<string, Analysis>()

export function markersOf(path: string): Markers {
  const file = `${path}.markers.json`
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Markers
  } catch {
    return {}
  }
}

export function mtimeOf(path: string): number {
  const m = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0)
  return Math.max(m(path), m(`${path}.markers.json`), m(`${path}.tracks.json`))
}

export function tracksOf(path: string): TrackSpec[] {
  const file = `${path}.tracks.json`
  if (!existsSync(file)) return []
  try {
    const t = JSON.parse(readFileSync(file, "utf8")).tracks as TrackSpec[]
    return t.filter((x) => typeof x?.file === "string" && existsSync(x.file))
  } catch {
    return []
  }
}

function peaksOf(mono: Float32Array): number[] {
  const n = mono.length
  const out: number[] = []
  for (let c = 0; c < COLUMNS; c++) {
    let p = 0
    for (let i = Math.floor((c / COLUMNS) * n); i < Math.floor(((c + 1) / COLUMNS) * n); i += 4) p = Math.max(p, Math.abs(mono[i]!))
    out.push(Math.round(Math.min(1, p) * 255))
  }
  return out
}

export async function analyze(path: string): Promise<Analysis> {
  const mtime = mtimeOf(path)
  const had = cache.get(path)
  if (had && had.mtime === mtime) return had
  const { l, r } = decode(path)
  const n = l.length
  const duration = n / SR
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) mono[i] = (l[i]! + r[i]!) / 2
  const t = tags(path)
  const markers = markersOf(path)

  const e = await ess()
  const vec = e.arrayToVector(mono)
  const rhythm = e.RhythmExtractor2013(vec, 208, "multifeature", 40)
  const keyed = e.KeyExtractor(vec)
  const onsetTimes: number[] = (() => {
    // High-frequency-content onsets, from essentia's onset detection over each frame.
    const hop = 512
    const fn: number[] = []
    let prev = 0
    for (let at = 0; at < n; at += hop) {
      let hfc = 0
      const mag = spectrumAt(mono, at)
      for (let i = 0; i < mag.length; i++) hfc += mag[i]! * mag[i]! * i
      fn.push(Math.max(0, hfc - prev))
      prev = hfc
    }
    const out: number[] = []
    const w = 8
    for (let i = w; i < fn.length - w; i++) {
      const around = fn.slice(i - w, i + w + 1)
      const mean = around.reduce((s, v) => s + v, 0) / around.length
      if (fn[i] === Math.max(...around) && fn[i]! > mean * 2.2 && fn[i]! > 1e-3) out.push((i * hop) / SR)
    }
    return out
  })()
  vec.delete?.()

  const bpm = markers.bpm ?? rhythm.bpm
  const offset = markers.offset ?? (markers.bpm ? 0 : (e.vectorToArray(rhythm.ticks)[0] ?? 0))
  const beatsPerBar = markers.beatsPerBar ?? 4
  const beat = 60 / bpm
  const barLen = beat * beatsPerBar
  const loud = loudnessOf(l, r)

  // Bars.
  const bars: Bar[] = []
  const sixteenth = beat / 4
  for (let k = 0, from = offset; from < duration - 0.05; k++, from += barLen) {
    const to = Math.min(duration, from + barLen)
    const a = Math.floor(from * SR)
    const b = Math.floor(to * SR)
    let peak = 0, ll = 0, rr = 0, lr = 0, mid = 0, side = 0
    for (let i = a; i < b; i++) {
      peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!))
      ll += l[i]! * l[i]!
      rr += r[i]! * r[i]!
      lr += l[i]! * r[i]!
      mid += ((l[i]! + r[i]!) / 2) ** 2
      side += ((l[i]! - r[i]!) / 2) ** 2
    }
    const chroma = new Array(12).fill(0)
    let low = 0, middle = 0, high = 0, rough = 0, frames = 0
    for (let at = a + SIZE / 2; at < b - SIZE / 2; at += SIZE / 2) {
      const mag = spectrumAt(mono, at)
      for (let i = 1; i < mag.length; i++) {
        const f = i * binHz
        const p = mag[i]! * mag[i]!
        if (f < 150) low += p
        else if (f < 2000) middle += p
        else high += p
        if (f > 100 && f < 2500) chroma[(Math.round(12 * Math.log2(f / 440) + 69) % 12 + 12) % 12] += mag[i]!
      }
      rough += roughness(mag)
      frames++
    }
    const onsets = onsetTimes.filter((o) => o >= from && o < to)
    const off = onsets.map((o) => {
      const d = (o - offset) / sixteenth
      return Math.abs(d - Math.round(d)) * sixteenth * 1000
    })
    const { name, fit } = triad(chroma)
    const section = [...(markers.sections ?? [])].reverse().find((s) => s.at <= from + 0.01)?.name
    const f = Math.max(1, frames)
    bars.push({
      n: k + 1,
      from,
      to,
      section,
      lufs: loud.lufs(from, to),
      peak: 20 * Math.log10(peak + 1e-12),
      low: db(low / f),
      mid: db(middle / f),
      high: db(high / f),
      chord: name,
      chordFit: fit,
      meant: markers.chords?.[k],
      dissonance: rough / f,
      onsets: onsets.length,
      offGrid: off.length ? off.reduce((s, v) => s + v, 0) / off.length : 0,
      correlation: lr / Math.sqrt(ll * rr + 1e-12),
      width: db(side) - db(mid),
    })
  }

  // Each track: its stem's loudness, overall and a bar at a time, and its waveform.
  const tracks: Track[] = tracksOf(path).map((spec) => {
    const st = decode(spec.file)
    const lm = loudnessOf(st.l, st.r)
    const m = new Float32Array(st.l.length)
    let peak = 0
    for (let i = 0; i < m.length; i++) {
      m[i] = (st.l[i]! + st.r[i]!) / 2
      peak = Math.max(peak, Math.abs(m[i]!))
    }
    // A waveform scaled to the track's own peak, as a DAW draws a region.
    const wave = peaksOf(m).map((v) => Math.round(Math.min(255, (v / Math.max(1, peak * 255)) * 255)))
    return { ...spec, lufs: lm.integrated, bars: bars.map((b) => Math.round(lm.lufs(b.from, b.to) * 10) / 10), waveform: wave }
  })

  // The player's spectrum: log bands from 40 Hz to 16 kHz, each 0-255 over -72..0 dB, falling slowly.
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => 40 * (16000 / 40) ** (i / BANDS))
  const spectrum: number[] = []
  const held = new Array(BANDS).fill(0)
  for (let fr = 0; fr < Math.ceil(duration * FPS); fr++) {
    const mag = spectrumAt(mono, Math.floor((fr / FPS) * SR))
    for (let k = 0; k < BANDS; k++) {
      let p = 0
      const lo = Math.max(1, Math.floor(edges[k]! / binHz))
      const hi = Math.max(lo + 1, Math.ceil(edges[k + 1]! / binHz))
      for (let i = lo; i < hi; i++) p = Math.max(p, mag[i]!)
      const v = Math.max(0, Math.min(1, (20 * Math.log10(p + 1e-9) + 72) / 72))
      held[k] = Math.max(v, held[k] * 0.82)
      spectrum.push(Math.round(held[k] * 255))
    }
  }
  const waveform = peaksOf(mono)

  const meters: number[] = []
  for (let fr = 0; fr < Math.ceil(duration * FPS); fr++) {
    const end = Math.min(n, Math.floor((fr / FPS) * SR))
    let pl = 0, pr = 0, ll = 0, rr = 0, lr = 0
    for (let i = Math.max(0, end - Math.floor(0.05 * SR)); i < end; i++) {
      pl = Math.max(pl, Math.abs(l[i]!))
      pr = Math.max(pr, Math.abs(r[i]!))
    }
    for (let i = Math.max(0, end - Math.floor(0.1 * SR)); i < end; i++) {
      ll += l[i]! * l[i]!
      rr += r[i]! * r[i]!
      lr += l[i]! * r[i]!
    }
    const dbfs = (x: number) => Math.round(Math.max(-60, 20 * Math.log10(x + 1e-9)) * 10)
    const t = fr / FPS
    meters.push(dbfs(pl), dbfs(pr), Math.round(loud.lufs(t - 0.4, t) * 10), Math.round((ll * rr > 1e-12 ? lr / Math.sqrt(ll * rr) : 1) * 100))
  }

  let clipped = 0
  for (let i = 0; i < n; i++) if (Math.abs(l[i]!) >= 0.999 || Math.abs(r[i]!) >= 0.999) clipped++
  const tp = Math.max(truePeak(l), truePeak(r))

  const a: Analysis = {
    path,
    mtime,
    duration,
    title: t.title ?? path.split("/").pop()!.replace(/\.[^.]+$/, ""),
    artist: t.artist ?? "",
    bpm,
    detectedBpm: rhythm.bpm,
    bpmConfidence: rhythm.confidence,
    key: `${keyed.key} ${keyed.scale}`,
    keyStrength: keyed.strength,
    integrated: loud.integrated,
    range: loud.range,
    truePeak: tp,
    clipped,
    markers: { ...markers, bpm, offset, beatsPerBar },
    bars,
    loudness: loud.shortTerm.map((v) => Math.round(v * 10) / 10),
    onsets: onsetTimes.map((o) => Math.round(o * 1000) / 1000),
    spectrum,
    waveform,
    meters,
    problems: [],
    tracks,
  }
  a.problems = problems(a)
  cache.set(path, a)
  return a
}

/** What a mix engineer would point at, from the numbers. */
function problems(a: Analysis): string[] {
  const out: string[] = []
  const at = (b: Bar) => `bar ${b.n} (${b.from.toFixed(2)}s${b.section ? `, ${b.section}` : ""})`
  if (a.clipped > 0) out.push(`${a.clipped} samples at full scale: it clips.`)
  if (a.truePeak > -1) out.push(`True peak ${a.truePeak.toFixed(1)} dBTP: over -1, it may clip once encoded.`)
  if (a.integrated > -9) out.push(`Integrated ${a.integrated.toFixed(1)} LUFS: very loud, it will be turned down and may sound squashed.`)
  if (a.integrated < -20) out.push(`Integrated ${a.integrated.toFixed(1)} LUFS: quiet.`)
  if (a.markers.bpm && Math.abs(a.detectedBpm - a.markers.bpm) > 2 && Math.abs(a.detectedBpm - a.markers.bpm * 2) > 2 && Math.abs(a.detectedBpm * 2 - a.markers.bpm) > 2)
    out.push(`The tempo heard is ${a.detectedBpm.toFixed(1)} BPM, not the ${a.markers.bpm} the markers say: the beat may not read clearly.`)
  for (let i = 0; i < a.bars.length; i++) {
    const b = a.bars[i]!
    const prev = a.bars[i - 1]
    if (b.high - b.mid > 3) out.push(`${at(b)}: highs ${(b.high - b.mid).toFixed(1)} dB over the mids, harsh.`)
    if (b.low - b.mid > 12) out.push(`${at(b)}: lows ${(b.low - b.mid).toFixed(1)} dB over the mids, boomy.`)
    if (b.correlation < 0.2) out.push(`${at(b)}: stereo correlation ${b.correlation.toFixed(2)}, it will thin out in mono.`)
    if (b.dissonance > 0.25) out.push(`${at(b)}: rough (dissonance ${b.dissonance.toFixed(2)}).`)
    if (b.meant && b.chordFit > 0.6 && b.chord !== b.meant) out.push(`${at(b)}: heard as ${b.chord}, meant ${b.meant}.`)
    if (b.onsets >= 4 && b.offGrid > 25) out.push(`${at(b)}: hits ${b.offGrid.toFixed(0)} ms off the sixteenth grid on average.`)
    if (prev && b.lufs - prev.lufs > 8 && !b.section) out.push(`${at(b)}: ${(b.lufs - prev.lufs).toFixed(1)} LU jump from the bar before.`)
  }
  return out
}

/** The analysis as text: the whole song, then each bar, and the notes on it. */
export function report(a: Analysis, notes: { from: number; to: number; text: string; done?: boolean }[] = [], range?: { from?: number; to?: number }): string {
  const f1 = (x: number) => x.toFixed(1)
  const lines = [
    `${a.title}${a.artist ? ` by ${a.artist}` : ""}: ${a.duration.toFixed(2)}s, ${a.bpm} BPM (heard ${f1(a.detectedBpm)}, confidence ${f1(a.bpmConfidence)}), ${a.key} (strength ${a.keyStrength.toFixed(2)})`,
    `loudness ${f1(a.integrated)} LUFS integrated, range ${f1(a.range)} LU, true peak ${f1(a.truePeak)} dBTP, ${a.clipped} clipped samples`,
  ]
  if (a.markers.cues?.length) lines.push(`cues: ${a.markers.cues.map((c) => `${c.name} ${c.at.toFixed(2)}s`).join(", ")}`)
  const from = range?.from ?? 0
  const to = range?.to ?? a.duration
  lines.push("", "bar  time          section   LUFS   peak  low/mid/high dB   chord (meant) fit  diss  hits off  corr  width")
  for (const b of a.bars) {
    if (b.to <= from || b.from >= to) continue
    const chord = `${b.chord}${b.meant ? ` (${b.meant})` : ""}`.padEnd(10)
    lines.push(
      `${String(b.n).padStart(3)}  ${f1(b.from).padStart(5)}-${f1(b.to).padEnd(6)}  ${(b.section ?? "").padEnd(8)} ${f1(b.lufs).padStart(6)} ${f1(b.peak).padStart(6)}  ${f1(b.low).padStart(5)}/${f1(b.mid).padStart(5)}/${f1(b.high).padStart(5)}   ${chord} ${b.chordFit.toFixed(2)}  ${b.dissonance.toFixed(2)}  ${String(b.onsets).padStart(4)} ${b.offGrid.toFixed(0).padStart(3)}ms ${b.correlation.toFixed(2).padStart(5)} ${f1(b.width).padStart(6)}`,
    )
  }
  if (a.tracks.length) {
    // Each track's loudness a bar at a time, LUFS: which part is too loud or lost, and where.
    const shown = a.bars.filter((b) => b.to > from && b.from < to)
    lines.push("", `track LUFS by bar    all  ${shown.map((b) => String(b.n).padStart(4)).join("")}`)
    for (const t of a.tracks) {
      const cells = shown.map((b) => {
        const v = t.bars[b.n - 1] ?? -70
        return (v <= -60 ? "·" : v.toFixed(0)).padStart(4)
      })
      lines.push(`${t.name.slice(0, 18).padEnd(18)} ${(t.lufs <= -69 ? "·" : t.lufs.toFixed(1)).padStart(6)} ${cells.join("")}`)
    }
  }
  lines.push("", a.problems.length ? "problems:" : "problems: none found")
  for (const p of a.problems) lines.push(`- ${p}`)
  const open = notes.filter((n) => n.to > from && n.from < to)
  lines.push("", open.length ? "notes:" : "notes: none")
  for (const n of open) lines.push(`- ${n.from.toFixed(2)}-${n.to.toFixed(2)}s${n.done ? " (done)" : ""}: ${n.text}`)
  return lines.join("\n")
}
