// awake's arithmetic: what the Mac should be doing, from what the tabs are doing and what the
// options say. Nothing here touches the machine, so a test can call it.

/** What the options say. A value never set is its default. */
export interface Settings {
  /** Hold while an agent works. */
  working: boolean;
  /** Hold with the lid shut (`pmset -a disablesleep`, which needs the admin rule). */
  lid: boolean;
  /** Battery percent under which the hold gives up; `0` holds until the Mac is empty. */
  batteryFloor: number;
  /** Hours one agent may hold for; `0` has no limit. */
  maxHours: number;
  /** Seconds to keep holding after the last agent stops: a turn ends, another starts. */
  linger: number;
  /** The cup in the menu bar. */
  menubar: boolean;
}

export const DEFAULTS: Settings = {
  working: true,
  lid: false,
  batteryFloor: 20,
  maxHours: 3,
  linger: 60,
  menubar: true,
};

/** What to do now: hold the machine up, and whether that means the lid too. */
export interface Want {
  hold: boolean;
  lid: boolean;
}

/** What the machine is running on. `percent` is -1 when it is not known. */
export interface Power {
  onBattery: boolean;
  percent: number;
}

/** Whether a tab's `@status` is one worth holding a Mac up for. */
export function busy(status: unknown, settings: Pick<Settings, "working">): boolean {
  return settings.working && typeof status === "string" && status.trim().toLowerCase() === "working";
}

/** The tabs holding the Mac up: their ids, in the order they were given. */
export function busyTabs(tabs: Iterable<readonly [string, unknown]>, settings: Pick<Settings, "working">): string[] {
  const held: string[] = [];
  for (const [id, status] of tabs) if (busy(status, settings)) held.push(id);
  return held;
}

/** Whether a tab that has been working since `since` has worked long enough to stop waiting for it. */
export function tooLong(since: number, now: number, maxHours: number): boolean {
  return maxHours > 0 && now - since >= maxHours * 3_600_000;
}

/**
 * What the machine should be doing: `working` tabs are working, and `power` says what it is running
 * on. Under the battery floor it gives up.
 */
export function wanted(working: number, settings: Settings, power: Power): Want {
  const enough = !power.onBattery || power.percent < 0 || power.percent > settings.batteryFloor;
  const hold = working > 0 && enough;
  return { hold, lid: hold && settings.lid };
}

/** Why the Mac is up, or why it is not, in a few words. */
export function why(working: number, settings: Settings, power: Power): string {
  if (working === 0) return "no agent working";
  if (power.onBattery && power.percent >= 0 && power.percent <= settings.batteryFloor) return `${agents(working)} · battery ${power.percent}%`;
  return agents(working);
}

function agents(working: number): string {
  return working === 1 ? "1 agent working" : `${working} agents working`;
}

/** Whether `pmset -g` says the lid's sleep is off (`SleepDisabled 1`). */
export function lidSleepOff(pmset: string): boolean {
  return /^[ \t]*SleepDisabled[ \t]+1[ \t]*$/m.test(pmset);
}

/** Whether `pmset -g batt` says the machine is drawing from its battery. */
export function onBattery(pmsetBatt: string): boolean {
  return /Battery Power/i.test(pmsetBatt);
}

/** The battery's percent as `pmset -g batt` says it, or -1. */
export function batteryPercent(pmsetBatt: string): number {
  const found = /(\d{1,3})%/.exec(pmsetBatt);
  return found === null ? -1 : Number(found[1]);
}

/** A number from an option, in bounds. */
export function bounded(value: unknown, fallback: number, low: number, high: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(high, Math.max(low, Math.round(number)));
}

/** The options as settings, from what `option.get` answered for each (anything else is its default). */
export function settingsFrom(stored: {
  working?: unknown;
  lid?: unknown;
  battery_floor?: unknown;
  max_hours?: unknown;
  linger?: unknown;
  menubar?: unknown;
}): Settings {
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  return {
    working: flag(stored.working, DEFAULTS.working),
    lid: flag(stored.lid, DEFAULTS.lid),
    batteryFloor: bounded(stored.battery_floor, DEFAULTS.batteryFloor, 0, 100),
    maxHours: bounded(stored.max_hours, DEFAULTS.maxHours, 0, 48),
    linger: bounded(stored.linger, DEFAULTS.linger, 0, 3600),
    menubar: flag(stored.menubar, DEFAULTS.menubar),
  };
}
