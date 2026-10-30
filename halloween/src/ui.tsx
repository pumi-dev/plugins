// The night over the window, while the Halloween theme draws it: bats crossing the top, a cobweb
// in the top right corner with a spider bobbing on its thread, another web low on the left, and
// fog drifting along the foot. When an agent changes, a scare: a ghost rises when it needs you,
// lightning strikes when it fails, and bats fly out when it is done. It sits in `window.overlay`,
// which takes no pointer: nothing here is in the way of a press.
import { useEffect, useRef, useState } from "react"
import { motion, useOption } from "pumi"
import { useApp, useWindowSize } from "pumi/theme"
import { Bats, Swarm } from "./bats.tsx"
import { FOG, GHOST, LIGHTNING, SPIDER, cobweb } from "./sprites.ts"

const WEB = cobweb(150)
const SMALL_WEB = cobweb(96, 4, 6, 180)
const OPTION = "pumi_dev.halloween."

export function Night() {
  const [theme] = useOption<string>("ui_theme")
  const [critters] = useOption<boolean>(`${OPTION}critters`)
  const [fog] = useOption<boolean>(`${OPTION}fog`)
  const [scares] = useOption<boolean>(`${OPTION}scares`)
  if (theme !== "halloween") return null
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}>
      {fog !== false ? <Fog /> : null}
      {critters !== false ? <Critters /> : null}
      {scares !== false ? <Scares /> : null}
    </div>
  )
}

export function Critters() {
  const { width, height } = useWindowSize()
  return (
    <>
      {/* The big web in the top right corner, its spider coming down on a thread and back. */}
      <div cache style={{ position: "absolute", top: 0, left: width - 150, width: 150, height: 150 }}>
        <svg src={WEB} style={{ width: 150, height: 150, color: "#c9b8e866" }} />
      </div>
      <motion.div
        animate={{ height: [30, 120, 90, 120, 30] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", fps: 60 }}
        style={{ position: "absolute", top: 0, left: width - 46, width: 1, backgroundColor: "#c9b8e888" }}
      />
      <motion.img
        src={SPIDER}
        animate={{ y: [30, 120, 90, 120, 30] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", fps: 60 }}
        style={{ position: "absolute", top: 0, left: width - 56, width: 20, height: 20 }}
      />
      {/* A smaller one low on the left, its hub in the corner it hangs from. */}
      <div cache style={{ position: "absolute", top: height - 96, left: 0, width: 96, height: 96 }}>
        <svg src={SMALL_WEB} style={{ width: 96, height: 96, color: "#c9b8e844" }} />
      </div>
      <Bats />
    </>
  )
}

/** Two banks of fog along the foot, drifting at different speeds; faint, so the text under them reads. */
export function Fog() {
  const { width, height } = useWindowSize()
  const banks = [
    { h: 90, opacity: 0.07, duration: 46, back: false },
    { h: 64, opacity: 0.05, duration: 70, back: true },
  ]
  return (
    <>
      {banks.map((b, i) => {
        // Twice the window wide, so half of it can drift by and the other half still covers it.
        const w = width * 2
        const path = b.back ? [-width, 0] : [0, -width]
        return (
          <motion.img
            key={i}
            src={FOG}
            objectFit="fill"
            animate={{ x: path }}
            transition={{ duration: b.duration, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", fps: 20 }}
            style={{ position: "absolute", left: 0, top: height - b.h, width: w, height: b.h, opacity: b.opacity }}
          />
        )
      })}
    </>
  )
}

// ── Scares ─────────────────────────────────────────────────────────────────────────────────

type Kind = "blocked" | "error" | "done"
interface Scare {
  id: number
  kind: Kind
  /** Where across the window, 0 to 1: the same for the same tab. */
  at: number
}

/** How long each scare plays, in ms, after which it is taken away. */
const LASTS: Record<Kind, number> = { blocked: 3600, error: 1200, done: 2600 }
/** How many may play at once: a burst of changes is one scare or two, not a dozen. */
const AT_ONCE = 3

/** A number from 0 to 1 from a string, the same each time. */
function spot(s: string): number {
  let n = 2166136261
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619)
  return 0.15 + ((n >>> 0) % 1000) / 1000 * 0.7
}

/**
 * The scares a change of statuses makes: one for each tab whose status turned `blocked`, `error`
 * or `done` from another. A tab that was not there before (it opened) makes none.
 */
export function scaresFor(was: Map<string, string>, now: Map<string, string>): { tab: string; kind: Kind }[] {
  const out: { tab: string; kind: Kind }[] = []
  for (const [tab, status] of now) {
    const before = was.get(tab)
    if (before === undefined || before === status) continue
    if (status === "blocked" || status === "error" || status === "done") out.push({ tab, kind: status })
  }
  return out
}

/** Plays `scaresFor` each time the statuses change; the ones the window first sees are where it starts. */
function Scares() {
  const statuses = useApp((s) => (s.snapshot?.tabs ?? []).map((p) => `${p.tab_id}=${p.status ?? ""}`).join("\n"))
  const seen = useRef<Map<string, string> | null>(null)
  const next = useRef(0)
  const [playing, setPlaying] = useState<Scare[]>([])
  useEffect(() => {
    const now = new Map(statuses ? statuses.split("\n").map((line) => line.split("=") as [string, string]) : [])
    const was = seen.current
    seen.current = now
    if (!was) return
    const fresh = scaresFor(was, now).map((s) => ({ id: next.current++, kind: s.kind, at: spot(s.tab) }))
    if (!fresh.length) return
    setPlaying((all) => [...all, ...fresh].slice(-AT_ONCE))
    for (const s of fresh) setTimeout(() => setPlaying((all) => all.filter((p) => p.id !== s.id)), LASTS[s.kind])
  }, [statuses])
  const { width, height } = useWindowSize()
  return (
    <>
      {playing.map((s) => {
        const x = Math.round(s.at * width)
        if (s.kind === "blocked") return <RisingGhost key={s.id} x={x} height={height} />
        if (s.kind === "error") return <Lightning key={s.id} x={x} height={height} />
        return <Swarm key={s.id} x={x} width={width} height={height} />
      })}
    </>
  )
}

/** A ghost floating up from the foot of the window, swaying, and fading out near the top. */
export function RisingGhost({ x, height }: { x: number; height: number }) {
  const size = 72
  return (
    <motion.img
      src={GHOST}
      initial={{ x: x - size / 2, y: height, opacity: 0 }}
      animate={{ x: [x - size / 2, x - size / 2 - 24, x - size / 2 + 24, x - size / 2], y: [height, height * 0.62, height * 0.38, height * 0.18], opacity: [0, 0.95, 0.9, 0] }}
      transition={{ duration: 3.4, ease: "easeOut", fps: 60 }}
      style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}
    />
  )
}

/** A flash over the whole window twice, and a bolt from its top. */
export function Lightning({ x, height }: { x: number; height: number }) {
  const flash = { duration: 0.9, times: [0, 0.08, 0.2, 0.3, 1], ease: "easeOut" as const, fps: 60 }
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0, 0.24, 0, 0.14, 0] }} transition={flash} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", backgroundColor: "#e8dcff" }} />
      <motion.img
        src={LIGHTNING}
        objectFit="fill"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0, 0.9, 0] }}
        transition={flash}
        style={{ position: "absolute", left: x - 30, top: 0, width: 60, height: Math.round(height * 0.55) }}
      />
    </>
  )
}
