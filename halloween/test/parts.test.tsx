// Halloween's parts drawn in the native test renderer: the gravestone question, the menu with its
// submenu, and the start screen. Skipped where the renderer is not built. With `HALLOWEEN_SHOTS`
// set to a folder, each is saved there as a PNG to look at.
import { describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// One React for the theme's code and the renderer: the renderer's.
const React = await import("../../../runtime/app/node_modules/react/index.js")
mock.module("react", () => React)

const { createTestRoot, hasNativeTestRenderer } = await import("../../../runtime/app/react/testing.ts")
const { ThemeContext, DARK, METRICS } = await import("../../../runtime/app/sdk/theme.ts")
const { DEFAULT } = await import("../../../runtime/app/app/theme/default.tsx")
const theme = (await import("../themes/halloween/theme.tsx")).default

const tokens = { ...DARK, ...theme.colors!.dark } as any
const metrics = { ...METRICS, ...theme.metrics }
const components = { ...DEFAULT, ...theme.components } as any
const state = { spec: theme, appearance: "dark", tokens, metrics, components } as any
const shots = process.env.HALLOWEEN_SHOTS

function draw(node: unknown, size = { width: 720, height: 480 }) {
  const t = createTestRoot(size)
  for (const font of theme.fonts ?? []) t.renderer.registerFont(readFileSync(font))
  t.render(
    <ThemeContext.Provider value={state}>
      <div style={{ width: "100%", height: "100%", backgroundColor: tokens.window }}>{node as any}</div>
    </ThemeContext.Provider>,
  )
  return t
}

/** Saves what is drawn, once its entrance (the stone's spring, the pumpkin's flicker) has played. */
function shot(t: ReturnType<typeof draw>, name: string) {
  if (!shots) return
  t.renderer.clockFastForward(900)
  t.renderer.flush()
  t.renderer.captureScreenshot(join(shots, `${name}.png`))
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30))
const action = (id: string, title: string, more: Record<string, unknown> = {}) => ({ plugin: "app", id, title, run: () => {}, ...more })

describe.skipIf(!hasNativeTestRenderer)("Halloween's parts", () => {
  test("a question is a gravestone, and one that ends something reads R.I.P.", async () => {
    const C = components
    let answered = ""
    const t = draw(<C.Dialog title="Close this tab?" detail="Its terminal keeps running until you close it." confirm="Close" cancel="Keep" danger onConfirm={() => (answered = "yes")} onCancel={() => (answered = "no")} />)
    await tick()
    t.renderer.flush()
    const text = t.renderer.getAllText().join(" ")
    expect(text).toContain("R . I . P .")
    expect(text).toContain("Close this tab?")
    expect(text).toContain("Keep")
    shot(t, "dialog")
    t.unmount()
    expect(answered).toBe("")
  })

  test("a prompt has its field on the stone", async () => {
    const C = components
    const t = draw(<C.Dialog title="Rename the view" confirm="Rename" cancel="Cancel" input={{ value: "haunted", onChange() {} }} onConfirm={() => {}} onCancel={() => {}} />)
    await tick()
    t.renderer.flush()
    expect(t.renderer.getAllText().join(" ")).not.toContain("R . I . P .")
    shot(t, "prompt")
    t.unmount()
  })

  test("a menu draws its groups, keys and a submenu's row", async () => {
    const C = components
    const actions = [
      action("split", "Split right", { keys: "⌘ D", icon: "split" }),
      action("zoom", "Zoom", { checked: true }),
      action("move", "Move to view", { group: "move", items: [action("v1", "1 Crypt"), action("v2", "2 Attic")] }),
      action("close", "Close tab", { group: "end", danger: true, keys: "⌘ W" }),
    ]
    const t = draw(<C.Menu at={{ x: 40, y: 30 }} actions={actions} close={() => {}} />)
    await tick()
    t.renderer.flush()
    const text = t.renderer.getAllText().join(" ")
    for (const title of ["Split right", "Zoom", "Move to view", "Close tab", "⌘ D"]) expect(text).toContain(title)
    shot(t, "menu")
    t.unmount()
  })

  test("the start screen lights a pumpkin, and a ghost when it gave up", async () => {
    const C = components
    const t = draw(<C.Starting title="Summoning pumi…" detail="Waking the server" gaveUp={false} lines={[]} />)
    await tick()
    t.renderer.flush()
    expect(t.renderer.getAllText().join(" ")).toContain("Summoning pumi…")
    shot(t, "starting")
    t.unmount()
    const failed = draw(<C.Starting title="pumi could not start" detail="The server did not answer." gaveUp lines={["pumid: address in use", "exit 1"]} />)
    await tick()
    failed.renderer.flush()
    expect(failed.renderer.getAllText().join(" ")).toContain("address in use")
    shot(failed, "gave-up")
    failed.unmount()
  })
})
