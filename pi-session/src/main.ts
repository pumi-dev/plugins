// `pi-session`: two buttons in a pi pane's title bar, beside its split and close. Fork opens
// `pi --fork <session>` in a pane beside it, in the same directory; Copy puts the session's id,
// path and directory on the clipboard.
//
// A pane is pi's when its agent's hook said so: `@agent` is `pi` and `@agent.session` is set
// (`pumi skill setup pi`). The buttons are `ui.tsx`'s (the manifest's `contributes.slots.
// pane.toolbar`), which draws them on those panes alone; what they do is here.
import type { PaneId } from "pumi";

import { fork as forkPane, copy as copyPane } from "./actions.ts";

/** Opens `pi --fork <session>` in a pane beside `pane`, in that pane's directory. */
export function fork(pane: PaneId): Promise<void> {
  return forkPane(pane);
}

/** The session's id, path and directory, on the clipboard; answers what it put there. */
export function copy(pane: PaneId): Promise<string> {
  return copyPane(pane);
}
