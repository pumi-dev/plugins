// The night over the window: which status changes make a scare, and (in the native test renderer,
// where it is built) the critters, the fog and each scare drawn part of the way through. With
// `HALLOWEEN_SHOTS` set to a folder, each is saved there as a PNG to look at.
import { describe, expect, mock, test } from "bun:test"
import { join } from "node:path"

const React = await import("../../../runtime/app/node_modules/react/index.js")
mock.module("react", () => React)

const { createTestRoot, hasNativeTestRenderer } = await import("../../../runtime/app/react/testing.ts")
const { Critters, Fog, Lightning, RisingGhost, scaresFor } = await import("../src/ui.tsx")
const { Swarm } = await import("../src/bats.tsx")

const statuses = (o: Record<string, string>) => new Map(Object.entries(o))

describe("scaresFor", () => {
  test("a tab turning blocked, failing or finishing is a scare", () => {
    const was = statuses({ "%1": "working", "%2": "working", "%3": "working", "%4": "idle" })
    const now = statuses({ "%1": "blocked", "%2": "error", "%3": "done", "%4": "working" })
    expect(scaresFor(was, now)).toEqual([
      { tab: "%1", kind: "blocked" },
      { tab: "%2", kind: "error" },
      { tab: "%3", kind: "done" },
    ])
  })

  test("a tab that only opened, or did not change, is none", () => {
    expect(scaresFor(statuses({ "%1": "done" }), statuses({ "%1": "done", "%2": "blocked" }))).toEqual([])
  })
})

describe.skipIf(!hasNativeTestRenderer)("the night", () => {
  const size = { width: 720, height: 480 }
  function drawn(node: unknown, ms: number, name: string) {
    const t = createTestRoot(size)
    t.renderer.clockPause()
    t.render(<div style={{ width: "100%", height: "100%", backgroundColor: "#0c0911", position: "relative" }}>{node as any}</div>)
    t.renderer.clockFastForward(ms)
    t.renderer.flush()
    if (process.env.HALLOWEEN_SHOTS) t.renderer.captureScreenshot(join(process.env.HALLOWEEN_SHOTS, `${name}.png`))
    t.unmount()
  }

  test("the critters and the fog draw", () => drawn(<><Fog /><Critters /></>, 2500, "night"))
  test("a ghost rises", () => drawn(<RisingGhost x={360} height={480} />, 1500, "ghost"))
  test("lightning strikes", () => drawn(<Lightning x={420} height={480} />, 80, "lightning"))
  test("bats fly out", () => drawn(<Swarm x={360} width={720} height={480} />, 700, "swarm"))
})
