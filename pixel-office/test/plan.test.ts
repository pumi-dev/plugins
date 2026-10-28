// The plan: a desk per view, or per tab with "One desk per tab", and what a desk's agent is doing.
import { expect, test } from "bun:test"
import type { Session, Tab, View } from "pumi/theme"
import { plan, seatsOf, statusOf } from "../themes/pixel-office/plan.ts"

const session = { workspace_id: "$1", label: "orbit" } as Session
const views = [{ view_id: "@1", workspace_id: "$1", number: 1, label: "api", agent_status: "" }, { view_id: "@2", workspace_id: "$1", number: 2, label: "web", agent_status: "" }] as View[]
const tabs = [
  { tab_id: "%1", view_id: "@1", workspace_id: "$1", block: "terminal", agent: "claude", agent_status: "working" },
  { tab_id: "%2", view_id: "@1", workspace_id: "$1", block: "terminal", agent: "codex", agent_status: "blocked" },
  { tab_id: "%3", view_id: "@2", workspace_id: "$1", block: "terminal", agent_status: "" },
] as Tab[]

test("a desk for every view, or for every tab", () => {
  expect(plan([session], views, tabs, 1400, 800, false).pods[0]!.seats.map((s) => s.tab?.tab_id ?? s.view.view_id)).toEqual(["@1", "@2"])
  expect(plan([session], views, tabs, 1400, 800, true).pods[0]!.seats.map((s) => s.tab?.tab_id)).toEqual(["%1", "%2", "%3"])
})

test("a view's desk says what its most urgent agent is doing; a tab's desk, its own", () => {
  const [api, web] = views.map((view) => seatsOf(view, tabs, false)[0]!)
  expect(statusOf(api!, tabs)).toBe("blocked")
  expect(statusOf(web!, tabs)).toBe("")
  const [first, second] = seatsOf(views[0]!, tabs, true)
  expect(statusOf(first!, tabs)).toBe("working")
  expect(statusOf(second!, tabs)).toBe("blocked")
})
