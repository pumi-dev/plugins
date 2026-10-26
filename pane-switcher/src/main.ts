// pane-switcher: Alt-Tab for panes. The trigger (`trigger`, `<M-Tab>` — Option-Tab on a Mac, or the
// command "Switch pane") puts a row of cards over the window, one per pane, each showing what its
// pane holds; `←`/`→` (and `Tab`, `↑`/`↓`, `Ctrl-P`/`Ctrl-N`, `Home`/`End`, `1`–`9`) move the
// highlight, `Enter` (or a click) goes to the highlighted pane, `x` closes it, and the app closes
// the float on Escape or a press outside the cards.
//
// This is the package's logic half, in its worker: the trigger bound in the root key table as
// its option says, the panes remembered as they are used, the float the switcher opens in, and
// what `ui.tsx` asks of it as it draws — the cards, the pane a card picks, and the one it closes.
import { call, fn, on, request, self, type PaneId } from "pumi";

import type { Card } from "./cards.ts";
import { fromTrigger } from "./keys.ts";
import { cards as makeCards } from "./panes.ts";
import { recently, remember } from "./recent.ts";
import { settings, trigger, type Settings } from "./settings.ts";

/** The server's key tables, as its `keys` option holds them. */
type Keys = Record<string, Record<string, { call: string; args: unknown[] }>>;

/** The key the trigger is bound to now, so the last one can be unbound. */
let bound: string | null = null;

/** Binds `trigger` in the root key table, and unbinds the key it was bound to before. The binding
 * has no disposer: the app takes every key a plugin made away when the plugin stops. */
async function bind(): Promise<void> {
  const wanted = await trigger();
  if (bound === wanted) return;
  const found = await call("option.get", ["keys", { scope: "global" }]);
  const root: Keys = found && typeof found === "object" && !Array.isArray(found) ? { ...(found as Keys) } : {};
  const table = { ...(root.root ?? {}) };
  if (bound !== null) delete table[bound];
  table[wanted] = { call: self.plugin.prefixed("switch"), args: [] };
  bound = wanted;
  await call("option.set", ["keys", { ...root, root: table }, { scope: "global" }]).catch((err: unknown) =>
    console.error(`${self.plugin.prefix}: binding ${wanted} threw:`, err),
  );
}

void bind();

// Its options are read again when one changes: the trigger above all.
on("option.changed", { match: self.plugin.prefixed("*"), desc: "pane-switcher follows its options" }, () => void bind());

// The panes are remembered as they are used, so `order = "recent"` opens on the last few: a tab's
// active pane moving is a pane being used.
on("tab.changed", { desc: "pane-switcher remembers the panes used" }, (e) => {
  const active = (e.data as { patch?: { activePane?: PaneId } })?.patch?.activePane;
  remember(active);
});

/** The trigger, as the manifest's command and the key table both reach it. */
fn.set(self.plugin.prefixed("switch"), { desc: "Switch pane", callback: () => open() });

// `pumi call amresyd.pane_switcher.open`, from anywhere: opens the switcher over the window.
fn.set(self.plugin.prefixed("open"), { desc: "Open the pane switcher over the window.", callback: () => open() });

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
export async function load(keep?: PaneId, at = 0): Promise<Opened> {
  const asked = await settings();
  const found = await makeCards(asked, recently());
  const wanted = keep ?? (await call("pane.get", [null]))?.id;
  const index = found.findIndex((card) => card.pane === wanted);
  return {
    cards: found,
    at: index >= 0 ? index : Math.min(at, Math.max(0, found.length - 1)),
    cardWidth: asked.cardWidth,
    rows: asked.rows,
  };
}

/** Goes to `to`, whichever tab its pane is in, and closes the float `from`. */
export async function pick(to: PaneId, from: PaneId): Promise<void> {
  try {
    await call("pane.focus", [to]);
  } catch (err) {
    request.open({ kind: "notification", title: `pane-switcher: ${message(err)}`, level: "error" });
  }
  await dismiss(from);
}

/** Closes the pane a card shows. */
export async function closePane(at: PaneId): Promise<void> {
  try {
    await call("pane.close", [at]);
  } catch (err) {
    request.open({ kind: "notification", title: `pane-switcher: ${message(err)}`, level: "error" });
  }
}

/** Closes the float itself: a pane picked, or nothing left to pick. */
export async function dismiss(from: PaneId): Promise<void> {
  try {
    await call("pane.close", [from]);
  } catch {
    // It is going anyway.
  }
}

/** The chord the trigger is bound to, as the window writes it (`alt+tab`): pressed while the
 * switcher is up, it moves the highlight on. Empty when the trigger is a sequence of keys. */
export async function triggerChord(): Promise<string> {
  return fromTrigger(await trigger()) ?? "";
}

/** What an error says, for a notice. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Opens the switcher over the window: `false` when it could not open it. Any switcher already up
 * is replaced. */
async function open(): Promise<boolean> {
  try {
    for (const other of await call("pane.list", [{ block: self.plugin.prefixed("switcher") }])) {
      if (typeof other === "string") await call("pane.close", [other]);
    }
    const asked = await settings();
    await call("pane.open", [self.plugin.prefixed("switcher"), {}, place(asked)]);
    return true;
  } catch (err) {
    request.open({ kind: "notification", title: `pane-switcher: ${message(err)}`, level: "error" });
    return false;
  }
}

/** Where its float goes: over the whole window, whichever tab of the session shows, so a switch
 * from another tab still shows it; centred by its anchor, dimming what is under it by `backdrop`,
 * and closed by the app on Escape or a press outside it (`dismiss`). `focus: false`: the switcher
 * must not become the pane it is switching from. */
function place(asked: Settings) {
  return {
    kind: "float",
    relative: "client",
    anchor: "center",
    width: `${asked.width}%`,
    height: asked.height,
    backdrop: asked.backdrop,
    dismiss: ["escape", "press"],
    zIndex: 70,
    focus: false,
  };
}
