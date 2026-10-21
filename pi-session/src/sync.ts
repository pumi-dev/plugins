// Every pi pane has its buttons in its strip (or only the current one, with `focused_only`), and no
// other pane has them. A pane is pi's when its agent's hook said so: `@agent` is `pi` and
// `@agent_session` is set (`pumi skill setup pi`).
import { option, pane, pkg, type Pane } from "pumi";

import { message } from "./errors.ts";
import { focusedOnly } from "./settings.ts";

/** The pane type of the view the buttons are. */
const STRIP = pkg.prefixed("strip");
/** How wide the buttons ask to be in the strip (its `@width`, in pixels): two of the app's square
 * icon buttons side by side, and what is left over stays between them and the title. */
const WIDTH = 50;
/** Which end of the strip the buttons sit at (`@start`): the row's end, to the right of the title
 * and beside the pane's own split and close buttons. */
const START = false;

/** Whether the pane `at` runs pi in a conversation the hook named. */
async function isPi(at: number): Promise<boolean> {
  const text = async (name: string) => {
    const value = await option.get(name, { pane: at });
    return typeof value === "string" ? value : null;
  };
  const agent = await text("@agent");
  const session = await text("@agent_session");
  return agent === "pi" && session !== null && session !== "";
}

/** Whether the strip view `view` is dressed the way this version dresses one: at the row's end, and
 * as wide as these buttons add up to. One an older version dressed (further along, another width)
 * is made again. */
async function dressed(view: number): Promise<boolean> {
  const width = await option.get("@width", { pane: view });
  const start = await option.get("@start", { pane: view });
  return width === WIDTH && start === START;
}

/** The buttons in `owner`'s strip: the view opened there, dressed for it. */
async function put(owner: number): Promise<void> {
  try {
    const view = await pane.open(STRIP, { pane: owner }, { kind: "slot", slot: "PaneStrip", owner, focus: false });
    await option.set("@width", WIDTH, { pane: view.id });
    await option.set("@start", START, { pane: view.id });
  } catch (err) {
    console.error(`pi-session: ${message(err)}`);
  }
}

/** Where the buttons are now: the pane each view belongs to, and the view itself. */
async function places(): Promise<Map<number, Pane>> {
  const views = new Map<number, Pane>();
  for (const view of await pane.list({ type: STRIP })) {
    const place = await view.getPlace();
    // One left elsewhere (an older version's bar), or not dressed for the strip yet: made again
    // below, where it belongs.
    if (place.kind !== "slot" || place.name !== "PaneStrip" || !(await dressed(view.id))) {
      await view.close(true);
      continue;
    }
    if (typeof place.owner === "number") views.set(place.owner, view);
  }
  return views;
}

/** Puts the buttons on every pi pane, and takes them off everything else. */
async function place(): Promise<void> {
  const views = await places();
  const only = (await focusedOnly()) ? (await pane.current()).id : null;
  for (const terminal of await pane.list({ type: "terminal" })) {
    const wanted = (await isPi(terminal.id)) && (only === null || only === terminal.id);
    const view = views.get(terminal.id);
    if (view !== undefined) {
      views.delete(terminal.id);
      if (!wanted) await view.close(true);
    } else if (wanted) {
      await put(terminal.id);
    }
  }
  // A pane that is no longer a terminal's (or no longer pi's) has no buttons.
  for (const view of views.values()) await view.close(true);
}

let running: Promise<void> = Promise.resolve();

/** Syncs the buttons, one run at a time: each works from what is there when it starts, so a burst of
 * events is a few looks rather than a few races. */
export function sync(): Promise<void> {
  const next = running.then(place);
  running = next.catch((err) => console.error(`pi-session: ${message(err)}`));
  return running;
}
