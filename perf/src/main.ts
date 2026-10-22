// perf: how the app is doing, floating in a corner of the window. The app keeps the numbers
// (`app.perf`: its CPU and memory, its frames, each core plugin's calls, the busiest threads,
// sampled every second); this package asks for them and draws them.
//
// The overlay is a float over the whole window (`relative: "client"`), pinned to a corner by its
// anchor so it stays there as the window changes size. It takes neither the keyboard nor the
// pointer, so the terminal under it goes on working.
//
// What is here is the logic: opening, placing and closing the float, the key that toggles it, and
// the numbers read from the app. What the numbers mean and how the rows are laid out is
// `report.ts`'s; `ui.tsx` draws them.
import { call, command, key, menu, notify, on, option, pane, pkg, system, type Disposer, type Pane } from "pumi";

import { place } from "./place.ts";
import { EMPTY, heightOf, reportOf, type Report } from "./report.ts";

/** The view's id (`amresyd.perf.overlay`). */
const VIEW = "overlay";
/** The app's function that answers with the numbers. */
const REPORT = "app.perf";
/** The key that toggles it, and the corner it floats in, when their options are empty. */
const DEFAULT_TRIGGER = "<D-M-p>";
const DEFAULT_CORNER = "NE";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The report now, or an empty one when the app does not answer (a build without it). */
export async function report(): Promise<Report> {
  try {
    return reportOf(await call(REPORT));
  } catch (err) {
    console.error(`perf: ${REPORT}: ${message(err)}`);
    return EMPTY;
  }
}

/** `corner`: the corner of the window it floats in. */
export async function corner(): Promise<string> {
  try {
    const value = await option.get("corner");
    return typeof value === "string" && value !== "" ? value : DEFAULT_CORNER;
  } catch (err) {
    console.error(`perf: ${message(err)}`);
    return DEFAULT_CORNER;
  }
}

/** The font the overlay's tables line up in: the terminal's (`guifont`), else the system's
 * monospace, since only a font whose glyphs are the same width keeps the columns straight. */
export async function family(): Promise<string> {
  const value = await option.get("guifont").catch(() => null);
  const set = typeof value === "string" ? value.split(":")[0]!.trim().replace(/_/g, " ") : "";
  if (set !== "") return set;
  try {
    return (await system.platform())?.os === "macos" ? "Menlo" : "monospace";
  } catch {
    return "monospace";
  }
}

/** Where the overlay goes, for a report as tall as it shows. */
export async function at(): Promise<ReturnType<typeof place>> {
  return place(heightOf(await report()), await corner());
}

/** The overlays open now. */
async function openPanes(): Promise<Pane[]> {
  try {
    return (await pane.list({ type: pkg.prefixed(VIEW) })) ?? [];
  } catch (err) {
    console.error(`perf: ${message(err)}`);
    return [];
  }
}

/** Shows it, or takes it away; whether it is shown now. */
async function toggle(): Promise<boolean> {
  const open = await openPanes();
  if (open.length > 0) {
    for (const overlay of open) await pane.close(overlay, true).catch(() => {});
    return false;
  }
  const where = await at();
  try {
    await pane.open(pkg.prefixed(VIEW), { height: heightOf(await report()) }, where);
    return true;
  } catch (err) {
    await notify(`perf: ${message(err)}`, "error");
    return false;
  }
}

/** An open overlay moves to the corner the option says now. */
async function replace(): Promise<void> {
  const where = await at();
  for (const overlay of await openPanes()) {
    try {
      await pane.setPlace(overlay, where);
    } catch (err) {
      console.error(`perf: ${message(err)}`);
    }
  }
}

/** The trigger last bound in the global key table, so the next one can unbind it. */
let bound: { trigger: string; mapping: Disposer } | null = null;

/** Bind `trigger` in the global key table, and unbind the last one. */
async function bind(): Promise<void> {
  const value = await option.get("trigger").catch(() => null);
  const trigger = typeof value === "string" && value !== "" ? value : DEFAULT_TRIGGER;
  if (bound?.trigger === trigger) return;
  bound?.mapping();
  bound = null;
  const mapping = key.set("global", trigger, () => void toggle(), { desc: "Toggle the performance overlay" });
  mapping.ready.catch((err: unknown) => console.error(`perf: ${message(err)}`));
  bound = { trigger, mapping };
}

command("toggle", () => toggle());
menu.add("View.Performance Overlay", { call: pkg.prefixed("toggle") }, { desc: "How the app is doing: CPU, memory, frames, core plugins, threads." });
void bind();
on("option.changed", { match: pkg.prefixed("*"), desc: "perf follows its options" }, () => {
  void bind();
  void replace();
});
