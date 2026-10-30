// Bats: one flying across a box, the colony that keeps crossing the top of the window, and a
// swarm that flies out once (when an agent is done). The theme's start screen and the plugin's
// overlay both fly them.
import { motion } from "pumi"
import { useWindowSize } from "pumi/theme"
import { BAT_DOWN, BAT_UP } from "./sprites.ts"

/** One bat's flight: when it sets off, how long it takes, where it starts and ends, how big it is. */
export interface Flight {
  delay: number
  duration: number
  from: { x: number; y: number }
  to: { x: number; y: number }
  size: number
  /** Flies again after this many seconds; once if left out. */
  again?: number
}

const WINGS = { duration: 0.28, repeat: Infinity, ease: { steps: 1 } as const, fps: 30 }

/** A bat's colour: dark, but a shade off the night so it shows against it. */
const BAT = "#3b2a52"

export function Bat({ flight, color = BAT }: { flight: Flight; color?: string }) {
  const w = flight.size
  const h = flight.size / 2
  const { from, to } = flight
  // Up and down a little as it goes, out of step with its wings.
  const dy = (to.y - from.y) / 4
  const y = [from.y, from.y + dy - 18, from.y + dy * 2 + 6, from.y + dy * 3 - 12, to.y]
  const repeat = flight.again === undefined ? {} : { repeat: Infinity, repeatDelay: flight.again }
  return (
    <motion.div
      initial={{ x: from.x, y: from.y }}
      animate={{ x: [from.x, to.x], y }}
      transition={{ duration: flight.duration, delay: flight.delay, ease: "linear", fps: 60, ...repeat }}
      style={{ position: "absolute", left: 0, top: 0, width: w, height: h, color }}
    >
      <motion.svg src={BAT_UP} animate={{ opacity: [1, 0] }} transition={WINGS} style={{ position: "absolute", left: 0, top: 0, width: w, height: h }} />
      <motion.svg src={BAT_DOWN} animate={{ opacity: [0, 1] }} transition={WINGS} style={{ position: "absolute", left: 0, top: 0, width: w, height: h }} />
    </motion.div>
  )
}

/** The colony: four bats crossing the top of the window, two each way, over and over. */
const COLONY = [
  { delay: 0, duration: 7, top: 70, size: 34 },
  { delay: 1.6, duration: 8.5, top: 140, size: 24, back: true },
  { delay: 3.4, duration: 6.2, top: 40, size: 18 },
  { delay: 5.2, duration: 9, top: 200, size: 28, back: true },
]

export function Bats() {
  const { width } = useWindowSize()
  return (
    <>
      {COLONY.map((b, i) => {
        const left = { x: -60, y: b.top }
        const right = { x: width + 40, y: b.top }
        return <Bat key={i} flight={{ delay: b.delay, duration: b.duration, size: b.size, from: b.back ? right : left, to: b.back ? left : right, again: 2 }} />
      })}
    </>
  )
}

/** A swarm let out of the window's foot near `x`, fanning up and out over the top: once. */
export function Swarm({ x, width, height }: { x: number; width: number; height: number }) {
  const bats = [-0.9, -0.5, -0.2, 0.15, 0.45, 0.8, 1.1]
  return (
    <>
      {bats.map((spread, i) => (
        <Bat
          key={i}
          flight={{
            delay: i * 0.07,
            duration: 1.6 + (i % 3) * 0.25,
            size: 16 + ((i * 7) % 4) * 4,
            from: { x: x + (i - 3) * 6, y: height + 10 },
            to: { x: x + spread * width * 0.45, y: -40 - (i % 2) * 30 },
          }}
        />
      ))}
    </>
  )
}
