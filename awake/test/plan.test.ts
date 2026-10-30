import { describe, expect, test } from "bun:test";
import {
  batteryPercent,
  busy,
  busyTabs,
  bounded,
  DEFAULTS,
  lidSleepOff,
  onBattery,
  settingsFrom,
  tooLong,
  wanted,
  why,
  type Settings,
} from "../src/plan.ts";

const settings = (update: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, ...update });
const mains = { onBattery: false, percent: 100 };
const battery = (percent: number) => ({ onBattery: true, percent });

describe("what counts as work", () => {
  test("a working tab does, and nothing else", () => {
    expect(busy("working", DEFAULTS)).toBe(true);
    for (const word of ["idle", "done", "blocked", "error", "unknown", "", undefined, null, 3]) {
      expect(busy(word, DEFAULTS)).toBe(false);
    }
    expect(busy("  Working ", DEFAULTS)).toBe(true);
    expect(busy("working", settings({ working: false }))).toBe(false);
  });

  test("the busy tabs are listed, in their order", () => {
    const tabs: [string, unknown][] = [
      ["%1", "working"],
      ["%2", "idle"],
      ["%4", "working"],
    ];
    expect(busyTabs(tabs, DEFAULTS)).toEqual(["%1", "%4"]);
  });
});

describe("an agent that has worked too long", () => {
  const now = 10 * 3_600_000;

  test("stops holding after `maxHours`", () => {
    expect(tooLong(now - 2 * 3_600_000, now, 3)).toBe(false);
    expect(tooLong(now - 3 * 3_600_000, now, 3)).toBe(true);
    expect(tooLong(now - 9 * 3_600_000, now, 3)).toBe(true);
  });

  test("0 waits forever", () => {
    expect(tooLong(0, now, 0)).toBe(false);
  });
});

describe("what the machine should do", () => {
  test("an agent working is a hold, with the lid only when asked", () => {
    expect(wanted(1, DEFAULTS, mains)).toEqual({ hold: true, lid: false });
    expect(wanted(1, settings({ lid: true }), mains)).toEqual({ hold: true, lid: true });
  });

  test("no work is no hold", () => {
    expect(wanted(0, settings({ lid: true }), mains)).toEqual({ hold: false, lid: false });
  });

  test("on battery it holds above the floor, and gives up under it", () => {
    expect(wanted(1, DEFAULTS, battery(21)).hold).toBe(true);
    expect(wanted(1, DEFAULTS, battery(20)).hold).toBe(false);
    expect(wanted(1, DEFAULTS, battery(3)).hold).toBe(false);
    expect(wanted(1, settings({ batteryFloor: 0 }), battery(1)).hold).toBe(true);
    expect(wanted(1, settings({ batteryFloor: 50 }), battery(80)).hold).toBe(true);
    expect(wanted(1, settings({ lid: true }), battery(10))).toEqual({ hold: false, lid: false });
  });

  test("an unknown battery is no reason to give up", () => {
    expect(wanted(1, DEFAULTS, battery(-1)).hold).toBe(true);
  });
});

describe("why", () => {
  test("says the agents, then the battery", () => {
    expect(why(0, DEFAULTS, mains)).toBe("no agent working");
    expect(why(1, DEFAULTS, mains)).toBe("1 agent working");
    expect(why(3, DEFAULTS, mains)).toBe("3 agents working");
    expect(why(2, DEFAULTS, battery(12))).toBe("2 agents working · battery 12%");
    expect(why(2, DEFAULTS, battery(60))).toBe("2 agents working");
  });
});

describe("reading pmset", () => {
  test("the lid's sleep is off when the line says 1", () => {
    expect(lidSleepOff("System-wide power settings:\n SleepDisabled\t\t1\n standby 1\n")).toBe(true);
    expect(lidSleepOff("System-wide power settings:\n SleepDisabled\t\t0\n")).toBe(false);
    expect(lidSleepOff("")).toBe(false);
  });

  test("battery power and its percent", () => {
    const discharging = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t82%; discharging;";
    expect(onBattery(discharging)).toBe(true);
    expect(batteryPercent(discharging)).toBe(82);
    const charging = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged;";
    expect(onBattery(charging)).toBe(false);
    expect(batteryPercent(charging)).toBe(100);
    expect(batteryPercent("")).toBe(-1);
  });
});

describe("the options as settings", () => {
  test("nothing set is the defaults", () => {
    expect(settingsFrom({})).toEqual(DEFAULTS);
  });

  test("what is set wins, and a value of the wrong type does not", () => {
    expect(settingsFrom({ working: false, lid: true, menubar: "yes" })).toEqual({ ...DEFAULTS, working: false, lid: true });
    expect(settingsFrom({ battery_floor: 40, max_hours: 1 }).batteryFloor).toBe(40);
    expect(settingsFrom({ battery_floor: 40 }).maxHours).toBe(DEFAULTS.maxHours);
  });

  test("the numbers are whole and in bounds", () => {
    expect(bounded(90.6, 60, 0, 3600)).toBe(91);
    expect(bounded(-5, 60, 0, 3600)).toBe(0);
    expect(bounded(99999, 60, 0, 3600)).toBe(3600);
    expect(bounded("soon", 60, 0, 3600)).toBe(60);
    expect(settingsFrom({ max_hours: -2 }).maxHours).toBe(0);
    expect(settingsFrom({ battery_floor: 900 }).batteryFloor).toBe(100);
  });
});
