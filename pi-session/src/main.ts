// `pi-session`: two buttons in a pi tab's title bar, beside its split and close. Fork opens
// `pi --fork <session>` in a tab beside it, in the same directory; Copy puts the session's id,
// path and directory on the clipboard.
//
// A tab is pi's when its agent's hook said so: `@agent` is `pi` and `@agent.session` is set
// (`pumi skill add pi`). The buttons are `ui.tsx`'s (the manifest's `contributes.slots.
// tab.toolbar`), which draws them on those tabs alone; what they do is here.
import type { TabId } from "pumi";

import { fork as forkTab, copy as copyTab } from "./actions.ts";

/** Opens `pi --fork <session>` in a tab beside `tab`, in that tab's directory. */
export function fork(tab: TabId): Promise<void> {
  return forkTab(tab);
}

/** The session's id, path and directory, on the clipboard; answers what it put there. */
export function copy(tab: TabId): Promise<string> {
  return copyTab(tab);
}
