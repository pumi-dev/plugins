// nudge: a notification from the OS when an agent stops to wait for you or finishes, so a long
// turn does not need the window watched. All of it is logic: the package contributes no slot and
// opens no pane, so it has no `ui.tsx` for the window to draw.
//
// An agent's state is its pane's `@agent_status` (one word: `working`, `blocked`, `done`, `idle`,
// `error`), which the agents' hooks report (`pumi skill setup` installs them). A change to
// `blocked` or `done` (and `error`, when asked for) is posted with `message.notify`: the pane
// goes with it, so a click can show it where the app supports one, and the pane's id is the
// notice's group, so a second notice for a pane replaces the first instead of piling up. When the
// state moves on — you answered it, or looked at the result — the notice is taken back.
import { command, emit, message, notify, on, option, plugin, type PumiEvent } from "pumi";
import { headline, isStatus, level, news, urgency, wanted, where, type Status, type Toggles } from "./notice.ts";

/** How long a state must hold before it is told: a result the app shows you at once is not news. */
const SETTLE_MS = 300;
/** At most one notice per pane in this long: agents go through states as they work. */
const QUIET_MS = 2000;

/** pane -> the state last told, and when. */
const told = new Map<number, { status: string; at: number }>();
/** pane -> the look planned at its state, once it has settled. */
const pending = new Map<number, ReturnType<typeof setTimeout>>();
/** Whether a notice the API refused was said already: it is said once, not once a turn. */
let saidOff = false;

/** The switches, as the options say (a switch never set is its default). */
async function toggles(): Promise<Toggles> {
  const [blocked, done, error] = await Promise.all([option.get("blocked"), option.get("done"), option.get("error")]);
  return { blocked: blocked !== false, done: done === true, error: error === true };
}

/** One of the pane's own options, as a string when it says something. */
async function saidBy(pane: number, name: string): Promise<string | null> {
  try {
    const value = await option.get(name, { pane });
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    // An option a pane does not have is one it says nothing with.
    return null;
  }
}

/** What the pane says of itself now: its state, read again a moment after it changed. */
async function current(pane: number): Promise<string> {
  return (await saidBy(pane, "@agent_status")) ?? "";
}

/** The group is the pane: one notice per pane, and the id it is taken back with. */
function group(pane: number): string {
  return plugin.prefixed(`pane.${pane}`);
}

/** Tells the user `status` happened in `pane`, as the pane describes itself. */
async function post(pane: number, status: Status): Promise<void> {
  const [agent, title, dir, sound] = await Promise.all([
    saidBy(pane, "@agent"),
    saidBy(pane, "title"),
    saidBy(pane, "pane_current_path"),
    option.get("sound"),
  ]);
  told.set(pane, { status, at: Date.now() });
  const notice = { title: headline(status, agent), body: where(pane, title, dir) };
  try {
    await message.notify(notice.body, level(status), {
      title: notice.title,
      group: group(pane),
      sound: typeof sound === "string" && sound !== "" ? sound : null,
      urgency: urgency(status),
      pane,
      data: { pane, status, agent },
    });
    saidOff = false;
  } catch (e: any) {
    // The API refused it: nothing was said, so an in-app notice says why, and the turns after it
    // are not told about it again.
    if (saidOff) return;
    saidOff = true;
    await notify(`nudge: ${e?.message ?? e}`, "warn");
    return;
  }
  // It is told: anything listening hears `amresyd.nudge.said` with what was said.
  await emit("said", { pane, status, agent, ...notice });
}

/** A state the pane may have left already: only one it still has is news. */
async function look(pane: number, status: Status): Promise<void> {
  if ((await current(pane)) !== status) return;
  // A state the switches have off is one not to say, so an older notice for it goes.
  if (!wanted(status, await toggles())) return void forget(pane);
  await post(pane, status);
}

/** The state is over: take its notice back. What was told of it is kept, so one that comes back
 * within the quiet is not said twice. */
async function forget(pane: number): Promise<void> {
  try {
    await message.withdraw(group(pane));
  } catch {
    // Nothing was shown, or this platform cannot take one back: both are quiet.
  }
}

/** A pane's agent changed state. Ask again once it settles: the handler stays quick. */
function changed(e: PumiEvent): void {
  const pane = e.pane;
  if (typeof pane !== "number") return;
  clearTimeout(pending.get(pane));
  pending.delete(pane);
  const status = String(e.data?.new ?? "");
  // `working`, `idle` or nothing: the wait or the result is over, and so is its notice.
  if (!isStatus(status)) return void forget(pane);
  if (!news(status, told.get(pane), Date.now(), QUIET_MS)) return;
  pending.set(
    pane,
    setTimeout(() => {
      pending.delete(pane);
      void look(pane, status);
    }, SETTLE_MS),
  );
}

const desc = "say an agent is blocked or done";

on("option.changed", { match: "@agent_status", desc }, changed);
on("pane.closed", { desc: "take back a closed pane's notice" }, (e) => {
  const pane = e.pane ?? Number(e.data?.pane);
  if (typeof pane !== "number" || Number.isNaN(pane)) return;
  clearTimeout(pending.get(pane));
  pending.delete(pane);
  told.delete(pane);
  void forget(pane);
});

/** `Nudge: send a test notification`: whether the system will show one, before an agent needs it. */
command("test", async () => {
  const sound = await option.get("sound");
  return message.notify("An agent that is blocked or done will be said here.", "info", {
    title: "pumi can nudge you",
    sound: typeof sound === "string" && sound !== "" ? sound : null,
  });
});
