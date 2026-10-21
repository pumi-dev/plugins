// insert-path: type `/` in a terminal and pick a file. The trigger key is bound in the terminal's
// key table, and opens the picker's float over the tab with what it needs to type a path in: the
// terminal, its directory, whether to quote it, and — when the trigger was a bare key — what to
// type back if the picker is dismissed.
//
// The picker itself is `picker.ts`; the walk, the matching and the quoting are `entries.ts`,
// `match.ts` and `path.ts`.
import { key, notify, on, option, pane, pkg, provide, view, type Disposer, type Pane } from "pumi";
import { Picker, type PickerArgs } from "./picker.ts";

/** The trigger last bound in the terminal's key table, so the next one can unbind it. */
let bound: { key: string; mapping: Disposer } | null = null;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `trigger`: the key that opens the picker in a terminal, `/` when it is empty. */
async function trigger(): Promise<string> {
  const key = await option.get("trigger");
  return typeof key === "string" && key !== "" ? key : "/";
}

/** Whether a trigger is a bare key, which a cancel types back. */
function bare(trigger: string): boolean {
  const chars = Array.from(trigger);
  return chars.length === 1 && chars[0]!.trim() !== "";
}

/** `height`: how many terminal rows tall the picker is. */
async function height(): Promise<number> {
  const rows = await option.get("height");
  return typeof rows === "number" && Number.isFinite(rows) ? Math.max(1, Math.round(rows)) : 18;
}

/** The caller's pane, or `undefined` when there is none. */
async function currentPane(): Promise<number | undefined> {
  try {
    const current = await pane.current();
    return typeof current?.id === "number" ? current.id : undefined;
  } catch {
    return undefined;
  }
}

/** The picker's pane, if one is open. */
async function picker(): Promise<Pane | undefined> {
  try {
    return (await pane.list({ type: pkg.prefixed("picker") }))?.[0];
  } catch {
    return undefined;
  }
}

/** Close the picker, wherever it is. */
async function close(): Promise<void> {
  const open = await picker();
  if (open) await pane.close(open, true);
}

/** Open the picker over the tab of `event.pane`, or of the current pane. Whether it opened. */
async function open(event: { pane?: number } = {}): Promise<boolean> {
  const term = typeof event?.pane === "number" ? event.pane : await currentPane();
  if (term === undefined) {
    await notify("insert-path: no pane to pick a path for", "error");
    return false;
  }
  await close();
  const pressed = await trigger();
  const args: PickerArgs = {
    pane: term,
    quote: (await option.get("quote")) !== false,
    // A bare key was typed to get here, so closing without a pick types it back. A chord was
    // not, so there is nothing to type back.
    cancel: bare(pressed) ? pressed : null,
  };
  const cwd = await option.get("pane_current_path", { pane: term });
  if (typeof cwd === "string" && cwd !== "") args.cwd = cwd;
  // `row` anchors it under the tabline; without it the host centers the float in the tab, and a
  // press outside it dismisses it.
  try {
    await pane.open(pkg.prefixed("picker"), args, {
      kind: "float",
      width: "28%",
      height: await height(),
      row: 1,
      zindex: 60,
      focus: false,
      dismiss: ["press"],
    });
  } catch (err) {
    await notify(`insert-path: ${message(err)}`, "error");
    return false;
  }
  return true;
}

/** Bind `trigger` in the terminal's key table, and unbind the last one. */
async function bind(): Promise<void> {
  const pressed = await trigger();
  if (bound?.key === pressed) return;
  bound?.mapping();
  bound = null;
  const mapping = key.set("terminal", pressed, (event: { pane?: number }) => void open(event), {
    desc: "Insert a path…",
  });
  mapping.ready.catch((err: unknown) => console.error(`insert-path: ${message(err)}`));
  bound = { key: pressed, mapping };
}

view<PickerArgs>("picker", Picker);
void bind();
on("option.changed", { match: pkg.prefixed("trigger"), desc: "insert-path follows its trigger" }, () => bind());
provide(
  pkg.prefixed("open"),
  { desc: "Open the path picker over the current tab.", examples: [{ args: [] }] },
  (event: { pane?: number } = {}) => open(event ?? {}),
);
