// palette: a float over the whole window, for finding things by their name — a command by what it
// does, a file by its path, the way an editor's quick-open does.
//
//   cmd+shift+p   every command there is: the app's menus and buttons, and the packages' commands
//   cmd+p         the project's files; `>` typed first turns it into the commands
//
// Both are contributed commands of this package (`toggle`, `go_to_file`), so the keys work before
// its worker has ever run: pressing one starts the worker and runs the command, which opens the
// float. `pumi call amresyd.palette.toggle` opens it too.
//
// The model is `model.ts` (what is typed, the rows a query keeps, and what ↑ walks); `ui.tsx` draws
// it. Every gesture comes back here, and answers the rows as they are afterwards.
import { command, notify, pane, pkg, provide, type PlaceSpec } from "pumi";

import { model, type Mode, type PaletteView } from "./model.ts";

export type { Mode, PaletteView, Row } from "./model.ts";

/**
 * Where the palette goes: over the whole window, whichever tab shows, dimming what is under it, and
 * dismissed the two ways it always is — Escape, and a press outside. It does not become the current
 * pane (`focus: false`), so the terminal it was opened from keeps its place; its input takes the
 * keyboard all the same. Above everything else, since it is asked for by a key from anywhere.
 */
export const PLACE: PlaceSpec = {
  kind: "float",
  relative: "client",
  width: "60%",
  height: "50%",
  backdrop: 30,
  dismiss: ["escape", "press"],
  focus: false,
  focusable: true,
  zindex: 100,
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The palette's float, if one is up. */
async function shown(): Promise<number | null> {
  try {
    const [there] = await pane.list({ type: pkg.prefixed("main") });
    return there?.id ?? null;
  } catch {
    return null;
  }
}

/** Opens the palette in `mode`, as a new float (replacing one that is up). */
async function open(mode: Mode): Promise<boolean> {
  try {
    const up = await shown();
    if (up !== null) await pane.close(up, true).catch(() => {});
    model.opening = mode;
    model.done = false;
    await model.start();
    await pane.open(pkg.prefixed("main"), { mode }, PLACE);
    return true;
  } catch (err) {
    await notify(`palette: ${message(err)}`, "error");
    return false;
  }
}

/** Closes the palette, if one is up. */
async function close(): Promise<void> {
  model.done = true;
  const up = await shown();
  if (up !== null) await pane.close(up, true).catch(() => {});
}

/** `cmd+shift+p`: the commands, or the way out of a palette that is up. */
async function toggle(): Promise<boolean> {
  if ((await shown()) !== null) {
    await close();
    return true;
  }
  return open("commands");
}

// ---- what the window asks for

/** The palette as it is now: the mode, the query, and the rows it keeps. */
export async function view(): Promise<PaletteView> {
  return model.view();
}

/** What is typed into the input. */
export async function typed(value: string): Promise<PaletteView> {
  model.typed(value);
  return model.view();
}

/** A key pressed while the input has it: the palette's own. `close` when it is done. */
export async function pressed(key: string): Promise<{ close: boolean; view: PaletteView }> {
  switch (key) {
    case "escape":
      return { close: true, view: model.view() };
    case "enter": {
      await model.run();
      return { close: true, view: model.view() };
    }
    case "tab":
      model.goToFile();
      return { close: false, view: model.view() };
    case "up":
      if (model.query === "" && model.history(-1)) return { close: false, view: model.view() };
      model.step(-1);
      return { close: false, view: model.view() };
    case "down":
      if (model.query === "" && model.history(1)) return { close: false, view: model.view() };
      model.step(1);
      return { close: false, view: model.view() };
    case "pageup":
      model.step(-10);
      return { close: false, view: model.view() };
    case "pagedown":
      model.step(10);
      return { close: false, view: model.view() };
    default:
      return { close: false, view: model.view() };
  }
}

/** A row pressed: it runs, and the palette closes. */
export async function pick(at: number): Promise<{ close: boolean; view: PaletteView }> {
  model.selected = at;
  await model.run();
  return { close: true, view: model.view() };
}

command("toggle", () => toggle());
command("go_to_file", () => open("files"));

provide(pkg.prefixed("toggle"), { desc: "Show or hide the palette: every command there is.", examples: [{ args: [] }] }, () => toggle());
provide(pkg.prefixed("go_to_file"), { desc: "Show the palette on the project's files.", examples: [{ args: [] }] }, () => open("files"));
