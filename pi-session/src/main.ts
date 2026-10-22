// `pi-session`: the buttons at the end of a pi pane's strip, past its dot and title. Fork opens
// `pi --fork <session>` in a pane beside it, in the same directory; Copy puts the session's id,
// path and directory on the clipboard.
//
// A pane is pi's when its agent's hook said so: `@agent` is `pi` and `@agent_session` is set
// (`pumi skill setup pi`). The buttons are `ui.tsx`'s (the manifest's `contributes.points.
// pane.strip`), which draws them on those panes alone; what they do is here.
import { fork as forkPane, copy as copyPane } from "./actions.ts";

/** Opens `pi --fork <session>` in a pane beside `pane`, in that pane's directory. */
export function fork(pane: number): Promise<void> {
  return forkPane(pane);
}

/** The session's id, path and directory, on the clipboard; answers what it put there. */
export function copy(pane: number): Promise<string> {
  return copyPane(pane);
}
