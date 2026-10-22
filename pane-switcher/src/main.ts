// pane-switcher: Alt-Tab for panes. The trigger (`trigger`, `<M-Tab>` — Option-Tab on a Mac, or the
// command "Switch pane") puts a row of cards over the window, one per pane, each showing what its
// pane holds; `←`/`→` (and `Tab`, `↑`/`↓`, `Ctrl-P`/`Ctrl-N`, `Home`/`End`, `1`–`9`) move the
// highlight, `Enter` (or a click) goes to the highlighted pane, `x` closes it, and the app closes
// the float on Escape or a press outside the cards.
//
// This is the package's logic half, in its worker: the trigger bound in the global key table as
// its option says, the panes remembered as they are used, the float the switcher opens in, and
// what `ui.tsx` asks of it as it draws — the cards, the pane a card picks, and the one it closes.
import { command, key, notify, on, pane, pkg, provide, type Disposer, type PlaceSpec } from "pumi";

import type { Card } from "./cards.ts";
import { fromTrigger } from "./keys.ts";
import { cards as makeCards } from "./panes.ts";
import { recently, remember } from "./recent.ts";
import { settings, trigger, type Settings } from "./settings.ts";

// The trigger: opens the switcher over the window, on the panes its options ask for. It is a
// command so the palette, a key of the user's and `pumi call` all reach the same thing. Pressed
// while a switcher is up, the switcher answers it itself (its cards step on) and keeps the key
// from reaching this.
command("switch", () => void open());

/** The key the trigger is bound to now, so the last one can be unbound. */
let bound: { key: string; dispose: Disposer } | null = null;

/** Binds `trigger` in the global key table, and unbinds the key it was bound to before. */
async function bind(): Promise<void> {
  const wanted = await trigger();
  if (bound?.key === wanted) return;
  bound?.dispose();
  bound = null;
  bound = {
    key: wanted,
    dispose: key.set("global", wanted, { call: pkg.prefixed("switch"), args: [] }, { desc: "Switch pane" }),
  };
}

void bind();

// Its options are read again when one changes: the trigger above all.
on("option.changed", { match: pkg.prefixed("*"), desc: "pane-switcher follows its options" }, () => void bind());

// The panes are remembered as they are used, so `order = "recent"` opens on the last few.
on("pane.focused", { desc: "pane-switcher remembers the panes used" }, (e) => remember(e.data?.pane ?? e.pane));

// `pumi call amresyd.pane_switcher.open`, from anywhere: opens the switcher over the window.
provide(pkg.prefixed("open"), { desc: "Open the pane switcher over the window." }, () => open());

/** What the switcher draws, and where its highlight goes. */
export interface Opened {
  /** A card per pane, in the order it shows them. */
  cards: Card[];
  /** Which card the highlight is on: the pane being switched from, or the one it was on. */
  at: number;
  /** How wide one card is, in pixels. */
  cardWidth: number;
  /** How many lines of a pane's screen a card shows. */
  rows: number;
}

/** Reads the panes as `ui.tsx` draws them: a card each, the highlight on `keep` — the pane being
 * switched from, or the one the highlight was on (`at`), as far as there are cards. */
export async function load(keep?: number, at = 0): Promise<Opened> {
  const asked = await settings();
  const found = await makeCards(asked, recently());
  const wanted = keep ?? (await pane.current()).id;
  const index = found.findIndex((card) => card.pane === wanted);
  return {
    cards: found,
    at: index >= 0 ? index : Math.min(at, Math.max(0, found.length - 1)),
    cardWidth: asked.cardWidth,
    rows: asked.rows,
  };
}

/** Goes to `to`, whichever tab its pane is in, and closes the float `from`. */
export async function pick(to: number, from: string): Promise<void> {
  try {
    await pane.select({ to });
  } catch (err) {
    notify(`pane-switcher: ${message(err)}`, "error");
  }
  await dismiss(from);
}

/** Closes the pane a card shows (its `PaneClosePre` may refuse). */
export async function closePane(at: number): Promise<void> {
  try {
    await pane.close(at);
  } catch (err) {
    notify(`pane-switcher: ${message(err)}`, "error");
  }
}

/** Closes the float itself: a pane picked, or nothing left to pick. */
export async function dismiss(from: string): Promise<void> {
  try {
    await pane.close(idOf(from), true);
  } catch {
    // It is going anyway.
  }
}

/** The chord the trigger is bound to, as the window writes it (`alt+tab`): pressed while the
 * switcher is up, it moves the highlight on. Empty when the trigger is a sequence of keys. */
export async function triggerChord(): Promise<string> {
  return fromTrigger(await trigger()) ?? "";
}

/** A pane id as the API takes it (`%12` as `12`): the id `ui.tsx` has as its prop. */
function idOf(id: string): number {
  return Number(id.replace(/^[%@$]/, ""));
}

/** What an error says, for a notice. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Opens the switcher over the window: `false` when it could not open it. Any switcher already up
 * is replaced. */
async function open(): Promise<boolean> {
  try {
    for (const other of await pane.list({ type: pkg.prefixed("switcher") })) await other.close(true);
    const asked = await settings();
    await pane.open(pkg.prefixed("switcher"), {}, place(asked));
    return true;
  } catch (err) {
    notify(`pane-switcher: ${message(err)}`, "error");
    return false;
  }
}

/** Where its float goes: over the whole window, whichever tab of the session shows, so a switch
 * from another tab still shows it; centred by its anchor, dimming what is under it by `backdrop`,
 * and closed by the app on Escape or a press outside it (`dismiss`). `focus: false`: the switcher
 * must not become the pane it is switching from. */
function place(asked: Settings): PlaceSpec {
  return {
    kind: "float",
    relative: "client",
    anchor: "center",
    width: `${asked.width}%`,
    height: asked.height,
    backdrop: asked.backdrop,
    dismiss: ["escape", "press"],
    zindex: 70,
    focus: false,
  };
}
