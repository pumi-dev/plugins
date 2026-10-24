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
import { call, fn, menu, on, option, request, self, workspace } from "pumi";

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
  return process.platform === "darwin" ? "Menlo" : "monospace";
}

/** Where the overlay goes, for a report as tall as it shows. */
export async function at(): Promise<ReturnType<typeof place>> {
  return place(heightOf(await report()), await corner());
}

/** The overlays open now. */
async function openPanes() {
  try {
    return await workspace.panes({ block: self.plugin.prefixed(VIEW) });
  } catch (err) {
    console.error(`perf: ${message(err)}`);
    return [];
  }
}

/** Shows it, or takes it away; whether it is shown now. */
async function toggle(): Promise<boolean> {
  const open = await openPanes();
  if (open.length > 0) {
    for (const overlay of open) await overlay.close().catch(() => {});
    return false;
  }
  const where = await at();
  try {
    await workspace.openPane(self.plugin.prefixed(VIEW), { height: heightOf(await report()) }, where);
    return true;
  } catch (err) {
    await request.open({ kind: "notification", title: `perf: ${message(err)}`, level: "error" });
    return false;
  }
}

/** An open overlay moves to the corner the option says now. */
async function replace(): Promise<void> {
  const where = await at();
  for (const overlay of await openPanes()) {
    try {
      await overlay.update({ place: where });
    } catch (err) {
      console.error(`perf: ${message(err)}`);
    }
  }
}

/** The server's key tables, as its `keys` option holds them. */
type Keys = Record<string, Record<string, { call: string; args: unknown[] }>>;

/** The trigger last bound in the global key table, so the next one can unbind it. */
let bound: string | null = null;

/** Binds `trigger` in the global key table, and unbinds the last one. The `keys` option has no
 * disposer of its own: the app takes every key a plugin made away when the plugin stops. */
async function bind(): Promise<void> {
  const value = await option.get("trigger").catch(() => null);
  const trigger = typeof value === "string" && value !== "" ? value : DEFAULT_TRIGGER;
  if (bound === trigger) return;
  const found = await option.get("keys", { scope: "global" });
  const root: Keys = found && typeof found === "object" && !Array.isArray(found) ? { ...(found as Keys) } : {};
  const table = { ...(root.global ?? {}) };
  if (bound !== null) delete table[bound];
  table[trigger] = { call: self.plugin.prefixed("toggle"), args: [] };
  try {
    await option.set("keys", { ...root, global: table }, { scope: "global" });
    bound = trigger;
  } catch (err) {
    // Nothing is recorded, so the next change asks again rather than thinking it is bound.
    console.error(`perf: keys ${trigger}: ${message(err)}`);
  }
}

// The manifest's command, which is what gives it its title and key.
fn.set(self.plugin.prefixed("toggle"), { desc: "Toggle the performance overlay", callback: () => toggle() });
menu.set("View.Performance Overlay", { fn: self.plugin.prefixed("toggle"), title: "Performance Overlay", desc: "How the app is doing: CPU, memory, frames, core plugins, threads." });
void bind();
on("option.changed", { match: self.plugin.prefixed("*"), desc: "perf follows its options" }, () => {
  void bind();
  void replace();
});
