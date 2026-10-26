// The options that decide what the bar and its panel show, read the same way by the worker (which
// fetches on their schedule) and by the window (which follows them with `useOption`). The manifest
// declares each one; what is here is the reading of it, with the defaults a value falls back to
// before the window has the server's options, or when a value is of the wrong kind.

import type { Resets } from "./model.ts";

export type Layout = "detailed" | "compact" | "meters";

export interface Settings {
  /** Whether the status bar draws the segments at all. */
  show: boolean;
  /** Plans shown, by provider id: `false` hides one whatever its sign-in. */
  claude: boolean;
  codex: boolean;
  copilot: boolean;
  openrouter: boolean;
  /** What a segment draws: a meter and numbers, numbers only, or meters only. */
  layout: Layout;
  /** How many of a plan's windows the bar names, tightest first. */
  windows: number;
  /** How a window's reset is said. */
  resets: Resets;
  /** Whether a segment starts with the plan's name. */
  label: boolean;
  /** How wide a segment's meter is, in px. */
  meter: number;
  /** Whether numbers and meters take the warning and error colours as a window fills. */
  tint: boolean;
  /** The share a window is drawn as a warning from, and spoken of. */
  warnAt: number;
  /** The share a window is drawn as critical from, and spoken of. */
  critAt: number;
  /** Minutes between reads. */
  every: number;
  /** Whether crossing `critAt` is said in a notification. */
  alert: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  show: true,
  claude: true,
  codex: true,
  copilot: true,
  openrouter: true,
  layout: "detailed",
  windows: 2,
  resets: "countdown",
  label: true,
  meter: 36,
  tint: true,
  warnAt: 70,
  critAt: 90,
  every: 5,
  alert: false,
};

/**
 * Each setting's option, as `package.json` declares it under `pumi.contributes.options`: the
 * prefix (`amresyd.usage.`) is the plugin's, so this is the key the worker's `option.get` and a
 * view's `useOption` take without it.
 */
export const OPTION_OF: Record<keyof Settings, string> = {
  show: "show",
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
  openrouter: "openrouter",
  layout: "layout",
  windows: "windows",
  resets: "resets",
  label: "label",
  meter: "meter",
  tint: "tint",
  warnAt: "warn_at",
  critAt: "crit_at",
  every: "every",
  alert: "alert",
};

/** Every setting's option, in the order they are read. */
export const OPTIONS = Object.values(OPTION_OF);

const LAYOUTS: Layout[] = ["detailed", "compact", "meters"];
const RESETS: Resets[] = ["countdown", "clock", "off"];

/**
 * The settings, from an option getter (`option.get` in the worker, `useOption` in a view, both by
 * `OPTION_OF`'s name). A value of the wrong kind, or one the manifest's bounds refuse, falls back
 * to the default rather than drawing a bar the user did not ask for.
 */
export function coerce(get: (option: string) => unknown): Settings {
  const value = (key: keyof Settings) => get(OPTION_OF[key]);
  const bool = (key: keyof Settings): boolean => {
    const it = value(key);
    return typeof it === "boolean" ? it : (DEFAULT_SETTINGS[key] as boolean);
  };
  const number = (key: keyof Settings, min: number, max: number): number => {
    const it = value(key);
    const parsed = typeof it === "number" ? it : Number(it);
    if (it === undefined || it === null || it === "" || !Number.isFinite(parsed)) return DEFAULT_SETTINGS[key] as number;
    return Math.min(max, Math.max(min, parsed));
  };
  const one = <T extends string>(key: keyof Settings, choices: T[]): T => {
    const it = value(key);
    return choices.includes(it as T) ? (it as T) : (DEFAULT_SETTINGS[key] as T);
  };
  return {
    show: bool("show"),
    claude: bool("claude"),
    codex: bool("codex"),
    copilot: bool("copilot"),
    openrouter: bool("openrouter"),
    layout: one("layout", LAYOUTS),
    windows: Math.round(number("windows", 1, 3)),
    resets: one("resets", RESETS),
    label: bool("label"),
    meter: Math.round(number("meter", 16, 80)),
    tint: bool("tint"),
    warnAt: number("warnAt", 1, 99),
    critAt: number("critAt", 1, 99),
    every: Math.round(number("every", 1, 60)),
    alert: bool("alert"),
  };
}
