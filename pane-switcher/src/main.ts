// pane-switcher: Alt-Tab for panes. The trigger (`trigger`, `<M-Tab>` — Option-Tab on a Mac, or the
// command "Switch pane") puts a row of cards over the window, one per pane, each showing what its
// pane holds; `←`/`→` (and `Tab`, `↑`/`↓`, `Ctrl-P`/`Ctrl-N`, `Home`/`End`, `1`–`9`) move the
// highlight, `Enter` (or a click) goes to the highlighted pane, `x` closes it, and the app closes
// the float on Escape or a press outside the cards.
//
// This is the package's own half: the view, the trigger bound in the global key table as its option
// says, the panes remembered as they are used, and the function that opens it from anywhere.
import { command, key, on, pkg, provide, view, type Disposer } from "pumi";

import { remember } from "./recent.ts";
import { trigger } from "./settings.ts";
import { advance, open, Switcher } from "./switcher.ts";

view("switcher", Switcher);

// The trigger: on to the next card if the switcher is already up, otherwise open it. It is a
// command so the palette, a key of the user's and `pumi call` all reach the same thing.
command("switch", () => (advance() ? undefined : open()));

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
