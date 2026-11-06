// The plan: a desk per view, or per tab with "One desk per tab", and what a desk's tab is doing.
import { expect, test } from "bun:test"
import type { Session, Tab, View } from "pumi/theme"
import { plan, seatsOf, statusOf } from "../themes/pixel-office/plan.ts"

const session = { workspace_id: "$1", label: "orbit" } as Session
const views = [{ view_id: "@1", workspace_id: "$1", number: 1, label: "api", status: "" }, { view_id: "@2", workspace_id: "$1", number: 2, label: "web", status: "" }] as View[]
const tabs = [
  { tab_id: "%1", view_id: "@1", workspace_id: "$1", block: "pumi_dev.terminal.shell", status: "working" },
  { tab_id: "%2", view_id: "@1", workspace_id: "$1", block: "pumi_dev.terminal.shell", status: "blocked" },
  { tab_id: "%3", view_id: "@2", workspace_id: "$1", block: "pumi_dev.terminal.shell", status: "" },
] as Tab[]

test("a desk for every view, or for every tab", () => {
  expect(plan([session], views, tabs, 1400, 800, false).desks.seats.map((s) => s.tab?.tab_id ?? s.view.view_id)).toEqual(["@1", "@2"])
  expect(plan([session], views, tabs, 1400, 800, true).desks.seats.map((s) => s.tab?.tab_id)).toEqual(["%1", "%2", "%3"])
})

test("every session's desks on one floor, a session after the other, the free desk last", () => {
  const other = { workspace_id: "$2", label: "pumi" } as Session
  const more = [...views, { view_id: "@3", workspace_id: "$2", number: 1, label: "docs", status: "" }] as View[]
  const room = plan([session, other], more, tabs, 1400, 800, false)
  expect(room.desks.seats.map((s) => s.view.view_id)).toEqual(["@1", "@2", "@3"])
  expect(room.desks.cells).toHaveLength(4)
  // No two desks share a cell, and the floor holds them all.
  expect(new Set(room.desks.cells.map((c) => `${c.x},${c.y}`)).size).toBe(4)
  for (const cell of room.desks.cells) expect(cell.x + 176).toBeLessThanOrEqual(room.width)
})

test("the desks wrap onto more rows when the floor is narrow", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ view_id: `@${i + 1}`, workspace_id: "$1", number: i + 1, label: `${i}`, status: "" })) as View[]
  const room = plan([session], many, [], 600, 800, false)
  expect(room.desks.cols).toBe(2)
  expect(room.desks.down).toBe(5)
})

test("a view's desk says what its most urgent tab is doing; a tab's desk, its own", () => {
  const [api, web] = views.map((view) => seatsOf(view, tabs, false)[0]!)
  expect(statusOf(api!, tabs)).toBe("blocked")
  expect(statusOf(web!, tabs)).toBe("")
  const [first, second] = seatsOf(views[0]!, tabs, true)
  expect(statusOf(first!, tabs)).toBe("working")
  expect(statusOf(second!, tabs)).toBe("blocked")
})
