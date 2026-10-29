// nudge: a notification from the OS when an agent stops to wait for you or finishes, so a long
// turn does not need the window watched. All of it is logic: the package contributes no slot and
// opens no pane, so it has no `ui.tsx` for the window to draw.
//
// An agent's state is its tab's `@status` (one word: `working`, `blocked`, `error`, `done`,
// `idle`, `unknown`), which pumi-host keeps from what the program reports, and the Agents plugin's
// hooks report (Settings → Agents). A change to `blocked` or `done` (and `error`, when asked for)
// is posted with `request.open` as a notification: the tab goes with it, so a click can show it
// where the app supports one, and the tab's id is the notice's group, so a second notice for a tab
// replaces the first instead of piling up. When the state moves on — you answered it, or looked at
// the result — the request is closed and its notice goes.
import { emit, fn, on, option, request, self, type PumiEvent } from "pumi";
import { headline, isStatus, level, news, urgency, wanted, where, type Status, type Toggles } from "./notice.ts";

/** How long a state must hold before it is told: a result the app shows you at once is not news. */
const SETTLE_MS = 300;
/** At most one notice per tab in this long: agents go through states as they work. */
const QUIET_MS = 2000;

/** The number a tab's wire id names (`%3` is `3`). */
function numberOf(id: string | null | undefined): number | undefined {
  if (typeof id !== "string") return undefined;
  const found = /^(?:[A-Za-z0-9._-]+\/)?%(\d+)$/.exec(id);
  return found === null ? undefined : Number(found[1]);
}

/** tab -> the state last told, and when. */
const told = new Map<number, { status: string; at: number }>();
/** tab -> the look planned at its state, once it has settled. */
const pending = new Map<number, ReturnType<typeof setTimeout>>();
/** tab -> the notification request open for it, with what it says. */
const posted = new Map<number, string>();
/** Whether a notice the API refused was said already: it is said once, not once a turn. */
let saidOff = false;

/** The switches, as the options say (a switch never set is its default). */
async function toggles(): Promise<Toggles> {
  const [blocked, done, error] = await Promise.all([option.get("blocked"), option.get("done"), option.get("error")]);
  return { blocked: blocked !== false, done: done === true, error: error === true };
}

/** One of the tab's own options, as a string when it says something. */
async function saidBy(tab: number, name: string): Promise<string | null> {
  try {
    const value = await option.get(name, { scope: "tab", id: `%${tab}` });
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    // An option a tab does not have is one it says nothing with.
    return null;
  }
}

/** What the tab says of itself now: its state, read again a moment after it changed. */
async function current(tab: number): Promise<string> {
  return (await saidBy(tab, "@status")) ?? "";
}

/** What a notification carries of its own: the OS's notice, and what a click on it is. */
interface Notice {
  title: string;
  detail?: string;
  level?: "info" | "warn" | "error";
  notification: {
    group?: string;
    sound?: string;
    urgency?: "low" | "normal" | "critical";
    data?: Record<string, unknown>;
  };
}

/**
 * Opens `notice` as a notification for `tab` (`request.open`), and answers the request's id.
 *
 * The request is asked as a variable, not written into the call: the generated `request.open`
 * type (`runtime/app/worker/sdk/api.types.gen.ts`) does not carry the export's `notification`
 * fields yet, and the server keeps them (`crates/pumid/src/api/requests.rs`).
 */
function open(notice: Notice, tab?: number): Promise<string> {
  const asked = { kind: "notification" as const, ...notice };
  return request.open(asked, tab === undefined ? {} : { tab: `%${tab}` });
}

/** The group is the tab: one notice per tab, and what a newer one replaces. */
function group(tab: number): string {
  return self.plugin.prefixed(`tab.${tab}`);
}

/** Tells the user `status` happened in `tab`, as the tab describes itself. */
async function post(tab: number, status: Status): Promise<void> {
  const [agent, title, dir, sound] = await Promise.all([
    saidBy(tab, "@pumi_dev.agents.agent"),
    saidBy(tab, "title"),
    saidBy(tab, "tab_current_path"),
    option.get("sound"),
  ]);
  told.set(tab, { status, at: Date.now() });
  const notice = { title: headline(status, agent), body: where(tab, title, dir) };
  try {
    const id = await open(
      {
        title: notice.title,
        detail: notice.body,
        level: level(status),
        notification: {
          group: group(tab),
          sound: typeof sound === "string" && sound !== "" ? sound : undefined,
          urgency: urgency(status),
          data: { tab: `%${tab}`, status, agent },
        },
      },
      tab,
    );
    posted.set(tab, id);
    saidOff = false;
  } catch (e: any) {
    // The API refused it: nothing was said, so an in-app notice says why, and the turns after it
    // are not told about it again.
    if (saidOff) return;
    saidOff = true;
    await request.open({ kind: "notification", title: `nudge: ${e?.message ?? e}`, level: "warn" });
    return;
  }
  // It is told: anything listening hears `amresyd.nudge.said` with what was said.
  await emit("said", { tab: `%${tab}`, status, agent, ...notice });
}

/** A state the tab may have left already: only one it still has is news. */
async function look(tab: number, status: Status): Promise<void> {
  if ((await current(tab)) !== status) return;
  // A state the switches have off is one not to say, so an older notice for it goes.
  if (!wanted(status, await toggles())) return void forget(tab);
  await post(tab, status);
}

/** The state is over: take its notice back. What was told of it is kept, so one that comes back
 * within the quiet is not said twice. */
async function forget(tab: number): Promise<void> {
  const id = posted.get(tab);
  posted.delete(tab);
  if (id === undefined) return;
  try {
    await request.close(id);
  } catch {
    // Nothing was shown, or this platform cannot take one back: both are quiet.
  }
}

/** The state a tab's changed patch says, when it carries one. */
function statusIn(event: PumiEvent): string | undefined {
  const patch = event.data?.patch as { options?: Record<string, unknown> } | undefined;
  const said = patch?.options?.["@status"];
  return typeof said === "string" ? said : undefined;
}

/** A tab's agent changed state. Ask again once it settles: the handler stays quick. */
async function changed(event: PumiEvent): Promise<void> {
  const tab = numberOf(event.tab);
  const keys: string[] = event.data?.keys ?? [];
  if (tab === undefined || !keys.includes("options.@status")) return;
  clearTimeout(pending.get(tab));
  pending.delete(tab);
  const status = statusIn(event) ?? (await current(tab));
  // `working`, `idle` or nothing: the wait or the result is over, and so is its notice.
  if (!isStatus(status)) return void forget(tab);
  if (!news(status, told.get(tab), Date.now(), QUIET_MS)) return;
  pending.set(
    tab,
    setTimeout(() => {
      pending.delete(tab);
      void look(tab, status);
    }, SETTLE_MS),
  );
}

/** The events nudge follows: what an agent is doing is its tab's own option, so `tab.changed`. */
on("tab.changed", { desc: "say an agent is blocked or done" }, (event: PumiEvent) => void changed(event));
on("tab.closed", { desc: "take back a closed tab's notice" }, (event: PumiEvent) => {
  const tab = numberOf(event.tab);
  if (tab === undefined) return;
  clearTimeout(pending.get(tab));
  pending.delete(tab);
  told.delete(tab);
  void forget(tab);
});

/** `Nudge: send a test notification`: whether the system will show one, before an agent needs it. */
fn.set("test", { desc: "Send a test notification: whether the system will show one." }, async () => {
  const sound = await option.get("sound");
  return open({
    title: "pumi can nudge you",
    detail: "An agent that is blocked or done will be said here.",
    notification: { sound: typeof sound === "string" && sound !== "" ? sound : undefined },
  });
});
