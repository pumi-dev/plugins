// awake: keeps this Mac up while agents work — and, with closed-lid mode on, with the lid shut —
// then lets it sleep as soon as nothing is working.
//
// What an agent is doing is its tab's `@status`: one word the core keeps for every tab and the
// Agents plugin's hooks report (`working`, `blocked`, `done`, …). A tab that turns `working` puts
// the Mac under a hold, unless it has been working longer than `max_hours`; the last one that
// turns anything else starts the linger, after which the hold goes.
//
// The hold is `caffeinate` (machine.ts), plus `pmset -a disablesleep` when closed-lid mode is on:
// no assertion keeps a Mac up through the lid, and only root can turn that one off. The rule that
// lets `sudo` do it without a password is installed once, with macOS's own admin prompt.
import { join } from "node:path";
import { emit, fn, on, option, paths, request, self, workspace, type PumiEvent } from "pumi";
import { Menubar } from "./bar.ts";
import { battery, installRule, lidSleep, Machine, maySetLidSleep, reap, setLidSleep } from "./machine.ts";
import { busy, settingsFrom, tooLong, wanted, why, type Power, type Settings, type Want } from "./plan.ts";

/** A tab's `@status`: what the program in it is doing. */
const STATUS = "@status";

/** The options the manifest declares, by their key (their full name is `amresyd.awake.<key>`). */
const SETTINGS = ["working", "lid", "battery_floor", "max_hours", "linger", "menubar"] as const;

/** The plugin's own store: the lid's sleep, and the `caffeinate` out now. */
const LID = "lid_owned";
const ASSERTION = "assertion";

const machine = new Machine();

/** The cup in the menu bar, while there is something to say with it. */
const menubar = new Menubar(join(import.meta.dir, "bar.swift"), () => paths.cache);

/** Every tab's `@status`, and since when it has been `working`. */
const statuses = new Map<string, string | undefined>();
const since = new Map<string, number>();

/** What this run has done. */
const doing = { holding: false, since: null as number | null, lid: false };

/** Whether we turned the lid's sleep off ourselves. */
let lidOwned = false;

/** One admin prompt a run: a refusal turns closed-lid mode off instead of asking again. */
let asked = false;
/** Told once when macOS would not put the lid's sleep back. */
let warned = false;

/** What the plugin last wrote to its store, so a write that changes nothing is not made. */
const store = new Map<string, unknown>();

/** The wait after the last agent stops (`linger`) and the one that says what to do then. */
let wait: ReturnType<typeof setTimeout> | undefined;

/** The last thing reported to the window: `state` answers it, and `emit("state")` carries it. */
let last: Now | null = null;

/** What awake is doing, and why: what Settings draws and `pumi call amresyd.awake.state` answers. */
export interface Now {
  /** Whether the Mac is being held up now. */
  holding: boolean;
  /** How many tabs are working. */
  working: number;
  /** The lid's sleep is off: closing the lid will not put the Mac to sleep now. */
  lid: boolean;
  /** The machine is on battery power, and how full it is (-1 when unknown). */
  onBattery: boolean;
  battery: number;
  /** When the hold began (Unix ms), or nothing. */
  since: number | null;
  /** Why, in a few words. */
  why: string;
  platform: string;
}

function log(message: string): void {
  console.error(`pumi-awake: ${message}`);
}

/** Runs tasks one after another: the events arrive while a hold is still being put in place. */
let chain: Promise<void> = Promise.resolve();
function serial(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch((error) => log(error?.message ?? String(error)));
  return chain;
}

/** The switches, as the options say (a value never set is its default). */
async function settings(): Promise<Settings> {
  const read = async (key: string) => {
    try {
      return await option.get(key, { scope: "global" });
    } catch {
      return undefined;
    }
  };
  const [working, lid, floor, hours, linger, cup] = await Promise.all(SETTINGS.map(read));
  return settingsFrom({ working, lid, battery_floor: floor, max_hours: hours, linger, menubar: cup });
}

/** Writes one of the plugin's own values, when it says something new. */
async function remember(key: string, value: unknown): Promise<void> {
  if (store.get(key) === value) return;
  store.set(key, value);
  await option.set(key, value ?? null).catch(() => undefined);
}

/** What a tab says of itself: its word, and when it started working. */
function keep(id: string, word: string | undefined, now = Date.now()): void {
  statuses.set(id, word);
  if (typeof word === "string" && word.trim().toLowerCase() === "working") {
    if (!since.has(id)) since.set(id, now);
  } else {
    since.delete(id);
  }
}

/** The tabs' statuses, read whole: at startup, and every half minute in case a word went by. */
async function resync(): Promise<void> {
  await workspace.ready;
  const tabs = await workspace.tabs();
  const now = Date.now();
  const seen = new Set<string>();
  for (const tab of tabs) {
    seen.add(tab.id);
    const word = tab.options?.[STATUS];
    keep(tab.id, typeof word === "string" ? word : undefined, now);
  }
  for (const id of [...statuses.keys()]) if (!seen.has(id)) keep(id, undefined);
}

/** The tabs that are working, but not for too long: their ids. */
function working(current: Settings, now: number): string[] {
  const ids: string[] = [];
  for (const [id, word] of statuses) {
    if (!busy(word, current)) continue;
    const at = since.get(id);
    if (at !== undefined && tooLong(at, now, current.maxHours)) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Decides what the machine should be doing now, and does it: hold while an agent is working (or a
 * hand says so), let go after the linger when none is.
 */
async function evaluate(): Promise<void> {
  const current = await settings();
  const ids = working(current, Date.now());
  const power = await battery();
  const want = wanted(ids.length, current, power);
  if (want.hold) {
    cancelWait();
    await engage(want);
  } else if (doing.holding) {
    await linger(current);
  }
  await report(ids.length, power, current);
}

/** Puts the hold in place: the assertion, and the lid's sleep when asked for. */
async function engage(want: Want): Promise<void> {
  machine.hold();
  await remember(ASSERTION, machine.pid);
  if (!doing.holding) {
    doing.holding = true;
    doing.since = Date.now();
  }
  if (want.lid) await keepLidAwake(true);
  else await putLidBack();
}

/** Waits `linger` seconds before letting go, so a turn's end and the next one's start are one hold. */
async function linger(current: Settings): Promise<void> {
  if (wait !== undefined) return;
  if (current.linger <= 0) return void (await letGo());
  wait = setTimeout(() => {
    wait = undefined;
    void serial(evaluate);
  }, current.linger * 1000);
}

function cancelWait(): void {
  if (wait === undefined) return;
  clearTimeout(wait);
  wait = undefined;
}

/** Lets go of everything: the assertion, and the lid's sleep if we turned it off. */
async function letGo(): Promise<void> {
  cancelWait();
  machine.stop();
  await remember(ASSERTION, null);
  await putLidBack();
  doing.holding = false;
  doing.since = null;
}

/**
 * Turns the lid's sleep off for the hold. The first time it is asked for, macOS's admin prompt
 * installs the rule; one prompt a run, and a refusal turns the option off rather than asking
 * again every turn.
 */
async function keepLidAwake(on: boolean): Promise<void> {
  if (!on) return void (await putLidBack());
  // Ours already — unless something else put it back (another app's `pmset`, a restore that was
  // missed): the flag is the machine's, not ours, so it is read again rather than assumed.
  if (lidOwned) {
    if (await lidSleep()) return;
    log("the lid's sleep came back while it was ours: taking it again");
  }
  if (await setLidSleep(true)) return void (await markLid(true));
  if (asked) return;
  asked = true;
  await notify("Awake: closed-lid mode needs an admin rule", "Approve the prompt macOS shows: it installs /etc/sudoers.d/pumi-awake, which allows `pmset -a disablesleep` and nothing else.");
  if ((await installRule()) && (await setLidSleep(true))) return void (await markLid(true));
  await option.set("lid", false, { scope: "global" }).catch(() => undefined);
  await notify("Awake: the lid will still put this Mac to sleep", "The admin rule was not installed.", "warn");
}

/** The lid's sleep is ours now (or no longer). */
async function markLid(off: boolean): Promise<void> {
  lidOwned = off;
  doing.lid = off;
  await remember(LID, off);
}

/** Turns the lid's sleep back on, when we were the ones who turned it off. */
async function putLidBack(): Promise<void> {
  if (!lidOwned) return;
  await markLid(false);
  if (await setLidSleep(false)) return;
  if (warned) return;
  warned = true;
  await notify("Awake: the lid's sleep is still off", "`sudo pmset -a disablesleep 0` puts it back.", "warn");
}

/**
 * Asks the window to open Settings at awake's page: Settings is the app's, and a worker has none
 * of its own — `ui.tsx`'s `Bridge` hears `open_settings` and opens it from there.
 */
function openSettings(): void {
  void emit("open_settings").catch((error: any) => log(`Settings would not open: ${error?.message ?? error}`));
}

/** Says what awake is doing: to the window (`state`), the side bar's button, and the cup. */
async function report(count: number, power: Power, current: Settings): Promise<void> {
  const lettingGo = doing.holding && count === 0;
  last = {
    holding: doing.holding,
    working: count,
    lid: doing.lid,
    onBattery: power.onBattery,
    battery: power.percent,
    since: doing.since,
    why: lettingGo ? "nothing working — letting go shortly" : why(count, current, power),
    platform: process.platform,
  };
  await emit("state", last).catch(() => undefined);
  await show(last, current);
}

/** The cup in the menu bar: while the Mac is held up, and nothing when it is not. */
async function show(now: Now, current: Settings): Promise<void> {
  if (!current.menubar) return menubar.stop();
  if (!now.holding) return void (await menubar.set(null));
  await menubar.set({ why: "Keeping mac awake" });
}

async function notify(title: string, detail?: string, level: "info" | "warn" | "error" = "info"): Promise<void> {
  await request.open({ kind: "notification", title, detail, level }).catch(() => undefined);
}

// What a tab says changed: a word, a tab going, a tab arriving.

on("tab.changed", { desc: "awake: an agent started or stopped working" }, (event: PumiEvent) => {
  const id = event.tab;
  const keys: string[] = event.data?.keys ?? [];
  if (typeof id !== "string" || !keys.includes(`options.${STATUS}`)) return;
  const patch = event.data?.patch as { options?: Record<string, unknown> } | undefined;
  const word = patch?.options?.[STATUS];
  keep(id, typeof word === "string" ? word : undefined);
  void serial(evaluate);
});

on("tab.closed", { desc: "awake: the tab that was working is gone" }, (event: PumiEvent) => {
  if (typeof event.tab !== "string" || !statuses.delete(event.tab)) return;
  since.delete(event.tab);
  void serial(evaluate);
});

on("tab.opened", { desc: "awake: a tab that may already be working" }, () => {
  void serial(async () => {
    await resync();
    await evaluate();
  });
});

on("option.changed", { desc: "awake: one of its own switches changed" }, (event: PumiEvent) => {
  const name = String(event.data?.name ?? event.match ?? "");
  if (!SETTINGS.some((key) => name === self.plugin.prefixed(key))) return;
  void serial(evaluate);
});

// What a click on the menu bar's cup asks for.

menubar.onCommand = (command) => {
  if (command === "settings") openSettings();
};

// What a person (or a key, or a script) asks it to do.

fn.set("state", { desc: "What awake is doing, and why." }, async () => {
  if (last === null) await serial(evaluate);
  return last;
});

fn.set("install", { desc: "Install the admin rule closed-lid mode needs." }, async () => {
  if (process.platform !== "darwin") return { installed: false };
  // Already allowed: nothing to install, and nothing to prompt for.
  if (await maySetLidSleep()) {
    asked = true;
    await notify("Awake: closed-lid mode is ready", "The admin rule is in place.");
    return { installed: true, already: true };
  }
  const installed = await installRule();
  if (installed && (await setLidSleep(false))) asked = true;
  return { installed };
});

fn.set("settings", { desc: "Open awake's page in Settings." }, () => openSettings());

// Starting up.

async function start(): Promise<void> {
  if (process.platform !== "darwin") {
    log(`keeping a Mac up with its lid shut is macOS's own: awake does nothing on ${process.platform}`);
    return;
  }
  // A run that died holding the lid's sleep off leaves it off: put it back before deciding again.
  if ((await option.get(LID).catch(() => null)) === true) {
    lidOwned = true;
    await putLidBack();
  }
  // The same for an assertion: it waits for pumi itself, so a restarted worker must put it out.
  const orphan = await option.get(ASSERTION).catch(() => null);
  if (typeof orphan === "number" && reap(orphan)) log(`an assertion from an earlier run went out (pid ${orphan})`);
  await resync();
  await evaluate();
  // The statuses are what mostly decides this, but the power does too, and an event can go by.
  setInterval(() => void serial(evaluate), 30_000);
}

void serial(start);
