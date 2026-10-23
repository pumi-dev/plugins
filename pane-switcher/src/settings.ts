// What the switcher is asked to show, read from its options as it opens: a switcher is momentary,
// so nothing of it is kept between openings.
import { option } from "pumi";

/** What the switcher is asked to show. */
export interface Settings {
  /** `tab`, `session` (its tabs) or `all`. */
  scope: string;
  /** `recent` (most recently used first) or `layout`. */
  order: string;
  /** The float: how wide a share of the window, and how many rows tall. */
  width: number;
  height: number;
  /** How much it dims what is under it, 0 to 80. */
  backdrop: number;
  /** How wide one card is, in pixels. */
  cardWidth: number;
  /** Whether a card shows its pane's screen, and how many lines tall that is. */
  preview: boolean;
  rows: number;
}

/** What each option means when the user has not set it. */
export const DEFAULTS: Settings = {
  scope: "session",
  order: "recent",
  width: 80,
  height: 18,
  backdrop: 30,
  cardWidth: 220,
  preview: true,
  rows: 14,
};

/** `value` as a number between `min` and `max`, or `fallback` when it is not one. */
function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** `value` as text, or `fallback` when it is not one (or is empty). */
function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/** Its options, as the switcher opens on them. */
export async function settings(): Promise<Settings> {
  const read = (name: string) => option.get(name);
  return {
    scope: text(await read("scope"), DEFAULTS.scope),
    order: text(await read("order"), DEFAULTS.order),
    width: number(await read("width"), DEFAULTS.width, 20, 100),
    height: number(await read("height"), DEFAULTS.height, 8, 60),
    backdrop: number(await read("backdrop"), DEFAULTS.backdrop, 0, 80),
    cardWidth: number(await read("card_width"), DEFAULTS.cardWidth, 120, 600),
    preview: (await read("preview")) !== false,
    rows: number(await read("preview_rows"), DEFAULTS.rows, 1, 60),
  };
}

/** `trigger`: the key that opens it, from any pane. */
export async function trigger(): Promise<string> {
  return text(await option.get("trigger"), "<M-Tab>");
}
