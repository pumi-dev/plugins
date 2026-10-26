// The plan: a desk per tab, or per pane with "One desk per pane", and what a desk's agent is doing.
import { expect, test } from "bun:test"
import type { Pane, Session, Tab } from "pumi/theme"
import { plan, seatsOf, statusOf } from "../themes/office/plan.ts"

const session = { workspace_id: "$1", label: "orbit" } as Session
const tabs = [{ tab_id: "@1", workspace_id: "$1", number: 1, label: "api" }, { tab_id: "@2", workspace_id: "$1", number: 2, label: "web" }] as Tab[]
const panes = [
  { pane_id: "%1", tab_id: "@1", agent: "claude", agent_status: "working" },
  { pane_id: "%2", tab_id: "@1", agent: "codex", agent_status: "blocked" },
  { pane_id: "%3", tab_id: "@2" },
] as Pane[]

test("a desk for every tab, or for every pane", () => {
  expect(plan([session], tabs, panes, 1400, 800, false).pods[0]!.seats.map((s) => s.pane?.pane_id ?? s.tab.tab_id)).toEqual(["@1", "@2"])
  expect(plan([session], tabs, panes, 1400, 800, true).pods[0]!.seats.map((s) => s.pane?.pane_id)).toEqual(["%1", "%2", "%3"])
})

test("a tab's desk says what its most urgent agent is doing; a pane's desk, its own", () => {
  const [api, web] = tabs.map((tab) => seatsOf(tab, panes, false)[0]!)
  expect(statusOf(api!, panes)).toBe("blocked")
  expect(statusOf(web!, panes)).toBe("")
  const [first, second] = seatsOf(tabs[0]!, panes, true)
  expect(statusOf(first!, panes)).toBe("working")
  expect(statusOf(second!, panes)).toBe("blocked")
})
