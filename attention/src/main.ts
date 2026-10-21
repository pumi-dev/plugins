// attention: tell the user when an agent is blocked and they are looking elsewhere.
// An agent's state is its pane's `@agent_status` (one word: `working`, `blocked`, `done`, `idle`,
// `error`), which agents' hooks report (`pumi skill setup` installs them). While any is blocked,
// `@attention` is how many, and a notice says so once each time the count goes up. The Dock
// bounce and the badge come with the system mod (phase 4); until then they are `@attention` and
// the notice.
//
// No view: what it makes is options, events and the global `@attention`.
import { notify, on, option, pane, pkg } from "pumi";

/** How many were blocked at the last look, so the notice is said once each time it goes up. */
let waiting = 0;

/** `bounce`: whether the Dock bounces (and whether the notice is said at all). */
async function bounce(): Promise<string> {
  return (await option.get("bounce")) ?? "once";
}

/** How many panes' agents are blocked. */
async function blocked(): Promise<number> {
  const panes = await pane.list();
  const states = await Promise.all(panes.map((p) => p.options.get("@agent_status")));
  return states.filter((state) => state === "blocked").length;
}

/** Count them again: say so if more are waiting than before, and keep `@attention` the count. */
async function update(): Promise<void> {
  const now = await blocked();
  const more = now > waiting;
  // Ahead of the notice: two agents blocked in the same turn fire two events, and the second look
  // is then not of a count that went up.
  waiting = now;
  if (more && (await bounce()) !== "none") {
    const said = now === 1 ? "An agent is waiting for you" : `${now} agents are waiting for you`;
    await notify(said, "warn");
  }
  await option.set("@attention", now > 0 ? now : null);
}

const desc = "count the agents waiting for you";
on("option.changed", { match: ["@agent_status", pkg.prefixed("bounce"), pkg.prefixed("badge")], desc }, () => update());
on("pane.closed", { desc }, () => update());
