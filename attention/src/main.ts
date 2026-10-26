// attention: tell the user when an agent is blocked and they are looking elsewhere. All of it is
// logic, so all of it is here: the package contributes no slot and opens no pane, and has no
// `ui.tsx` for the window to draw.
//
// An agent's state is its pane's `traits.agent.status` (one word: `working`, `blocked`, `done`,
// `idle`, `error`), which agents' hooks report (`pumi skill setup` installs them). A notice says
// how many are blocked once each time the count goes up; the Dock bounce and the badge come with
// the system mod (phase 4). What is said is `count.ts`'s rule; this reads the panes.
import { call, on, option, request, self } from "pumi";
import { count, said } from "./count.ts";

/** How many were blocked at the last look, so the notice is said once each time it goes up. */
let waiting = 0;

/** `bounce`: whether the Dock bounces (and whether the notice is said at all). */
async function bounce(): Promise<string> {
  return (await option.get("bounce")) ?? "once";
}

/** How many panes' agents are blocked. */
async function blocked(): Promise<number> {
  const ids: string[] = await call("pane.list", {});
  const panes = await Promise.all(ids.map((id) => call("pane.get", id)));
  return count(panes.map((each) => each.traits?.agent?.status ?? null));
}

/** Count them again: say so if more are waiting than before. */
async function update(): Promise<void> {
  const now = await blocked();
  const words = said(waiting, now);
  // Ahead of the notice: two agents blocked in the same turn fire two events, and the second look
  // is then not of a count that went up.
  waiting = now;
  if (words && (await bounce()) !== "none") await request.open({ kind: "notification", title: words, level: "warn" });
}

const desc = "count the agents waiting for you";
on("option.changed", { match: [self.plugin.prefixed("bounce"), self.plugin.prefixed("badge")], desc }, () => update());
// An agent's state is a trait of its pane: it changed when the pane's agent traits did.
on("pane.changed", { desc }, (e) => {
  const keys: string[] = e.data?.keys ?? [];
  if (keys.some((key) => key === "traits.agent" || key.startsWith("traits.agent."))) void update();
});
on("pane.closed", { desc }, () => update());
