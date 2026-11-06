// The night over the window, while the Halloween theme draws it: bats crossing the top, a cobweb
// in the top right corner with a spider bobbing on its thread, and another web low on the left.
// It sits in `window.overlay`, which takes no pointer: nothing here is in the way of a press.
import { motion, useOption } from "pumi"
import { useWindowSize } from "pumi/theme"
import { BAT_DOWN, BAT_UP, SPIDER, cobweb } from "./sprites.ts"

const WEB = cobweb(150)
const SMALL_WEB = cobweb(96, 4, 6, 180)

/** One bat's flight: when it sets off, how long it takes across, how high and how big it flies. */
interface Flight {
  delay: number
  duration: number
  top: number
  size: number
  /** Right to left. */
  back?: boolean
}
const FLIGHTS: Flight[] = [
  { delay: 0, duration: 7, top: 70, size: 34 },
  { delay: 1.6, duration: 8.5, top: 140, size: 24, back: true },
  { delay: 3.4, duration: 6.2, top: 40, size: 18 },
  { delay: 5.2, duration: 9, top: 200, size: 28, back: true },
]

function Bat({ flight, width }: { flight: Flight; width: number }) {
  const w = flight.size
  const h = flight.size / 2
  const from = flight.back ? width + 40 : -60
  const to = flight.back ? -60 : width + 40
  // Up and down a little as it goes, out of step with its wings.
  const bob = [0, -18, 6, -12, 0]
  const wings = { duration: 0.28, repeat: Infinity, ease: { steps: 1 } as const, fps: 30 }
  return (
    <motion.div
      initial={{ x: from, y: 0 }}
      animate={{ x: [from, to], y: bob }}
      transition={{ duration: flight.duration, delay: flight.delay, repeat: Infinity, repeatDelay: 2, ease: "linear", fps: 60 }}
      style={{ position: "absolute", left: 0, top: flight.top, width: w, height: h, color: "#0a0610" }}
    >
      <motion.svg src={BAT_UP} animate={{ opacity: [1, 0] }} transition={wings} style={{ position: "absolute", left: 0, top: 0, width: w, height: h }} />
      <motion.svg src={BAT_DOWN} animate={{ opacity: [0, 1] }} transition={wings} style={{ position: "absolute", left: 0, top: 0, width: w, height: h }} />
    </motion.div>
  )
}

export function Night() {
  const [theme] = useOption<string>("ui_theme")
  const [critters] = useOption<boolean>("amresyd.halloween.critters")
  const { width, height } = useWindowSize()
  if (theme !== "halloween" || critters === false) return null
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}>
      {/* The big web in the top right corner, its spider coming down on a thread and back. */}
      <div cache style={{ position: "absolute", top: 0, left: width - 150, width: 150, height: 150 }}>
        <svg src={WEB} style={{ width: 150, height: 150, color: "#c9b8e866" }} />
      </div>
      <motion.div
        animate={{ height: [30, 120, 90, 120, 30] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", fps: 60 }}
        style={{ position: "absolute", top: 0, left: width - 46, width: 1, backgroundColor: "#c9b8e888" }}
      />
      <motion.svg
        src={SPIDER}
        animate={{ y: [30, 120, 90, 120, 30] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", fps: 60 }}
        style={{ position: "absolute", top: 0, left: width - 56, width: 20, height: 20, color: "#120a18" }}
      />
      {/* A smaller one low on the left, its hub in the corner it hangs from. */}
      <div cache style={{ position: "absolute", top: height - 96, left: 0, width: 96, height: 96 }}>
        <svg src={SMALL_WEB} style={{ width: 96, height: 96, color: "#c9b8e844" }} />
      </div>
      {FLIGHTS.map((f, i) => (
        <Bat key={i} flight={f} width={width} />
      ))}
    </div>
  )
}
