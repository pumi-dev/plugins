// monaco: a code editor for the core's `file` panes — Monaco, VS Code's editor, in a page of the
// plugin's own (`web/`, built from `page/` by `bun scripts/build.ts`), drawn by `ui.tsx`'s
// `Editor`. Its manifest's `renderers.file` claims every file (`*`), so a file opened anywhere
// (`pumi open`, `file.open`, the project tree, the palette) is drawn here unless a viewer that fits
// it better is enabled, or the pane's `@pane_renderer` names another.
//
//   pumi open src/main.rs                                       # on the right of this pane
//   pumi open --line 42 --with amresyd/monaco notes.md          # at line 42, in this editor
//   pumi call amresyd.monaco.save 7                             # the file pane 7 shows, to disk
//
// The page holds the text; this holds the disk. The page reads and writes through the exports
// below (`read`, `write`, its `<prefix>rpc`), and learns what to show from its pane: the core's
// option `path`, and `pane.call(pane, "at")` for a line to go to, which it takes when it loads or
// when the block's `reveal` says there is one.
import { dirname } from "node:path";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { ApiError, call, command, notify, option, provide, plugin } from "pumi";

/** The core's block for a file, which the editor draws. */
const BLOCK = "file";
/** A file larger than this is not opened: the page would hold it all. */
const LIMIT = 16 * 1024 * 1024;
/** How long `save` waits for the page to hand over its text. */
const SAVE_WAIT = 8000;

/** Who waits for each pane's save, settled when its page writes (or says it can't). */
const saving = new Map<number, { resolve(path: string): void; reject(err: Error): void }[]>();

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A pane a call names: `7`, `"%7"`, `{ pane: 7 }`; undefined for none. */
function paneOf(what: unknown): number | undefined {
  const named = typeof what === "object" && what !== null ? (what as { pane?: unknown }).pane : what;
  if (named === undefined || named === null) return undefined;
  const id = typeof named === "number" ? named : typeof named === "string" ? Number(named.replace(/^%/, "")) : NaN;
  if (!Number.isInteger(id)) throw new ApiError("invalid_params", `not a pane: ${String(named)}`);
  return id;
}

/** The current pane, as the app has it; null when there is none. */
async function here(): Promise<{ id: number; block: string } | null> {
  const info = await call("pane.get").catch(() => null);
  if (!info || typeof info.id !== "number") return null;
  return { id: info.id, block: String(info.block) };
}

async function isEditor(id: number): Promise<boolean> {
  const info = await call("pane.get", id).catch(() => null);
  return info?.block === BLOCK;
}

/** Writes the file pane `id` shows (the current pane without one) and answers its path; a pane
 *  that is not a file pane is an error only when it was named. */
export async function save(id?: number): Promise<{ pane: number; path: string } | null> {
  const named = id !== undefined;
  const target = id ?? (await here())?.id;
  if (target === undefined || !(await isEditor(target))) {
    if (named) throw new ApiError("invalid_params", `pane ${target} is not a file pane`);
    return null;
  }
  const path = await option.get("path", { pane: target }).catch(() => "");
  if (typeof path !== "string" || path === "") throw new ApiError("invalid_params", `pane ${target} shows no file`);
  let waiter: { resolve(path: string): void; reject(err: Error): void } | undefined;
  const written = new Promise<string>((resolve, reject) => {
    waiter = { resolve, reject };
    saving.set(target, [...(saving.get(target) ?? []), waiter]);
  });
  const timer = setTimeout(() => {
    // Nobody wrote: this waiter goes, and the call says why.
    const rest = (saving.get(target) ?? []).filter((w) => w !== waiter);
    if (rest.length) saving.set(target, rest);
    else saving.delete(target);
    waiter?.reject(new ApiError("timeout", `the editor in pane ${target} did not answer: is it drawn in a window, by this plugin?`));
  }, SAVE_WAIT);
  try {
    await call("pane.call", target, "save", {});
    return { pane: target, path: await written };
  } finally {
    clearTimeout(timer);
  }
}

/** Settles whoever waits for pane `id`'s save. */
function settle(id: number, outcome: { path: string } | { error: Error }): void {
  const list = saving.get(id) ?? [];
  saving.delete(id);
  for (const w of list) {
    if ("path" in outcome) w.resolve(outcome.path);
    else w.reject(outcome.error);
  }
}

// ---- what the page calls (through `<prefix>rpc`)

/** A file's text and when it last changed; `missing` for one that is not there yet (saving makes it). */
export async function read(path: string): Promise<{ text: string; mtime: number; missing: boolean }> {
  let info;
  try {
    info = statSync(path);
  } catch {
    return { text: "", mtime: 0, missing: true };
  }
  if (info.isDirectory()) throw new ApiError("invalid_params", "is a folder");
  if (info.size > LIMIT) throw new ApiError("invalid_params", `is ${(info.size / 1024 / 1024).toFixed(0)} MB: the editor opens files up to ${LIMIT / 1024 / 1024} MB`);
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  if (bytes.subarray(0, 8192).includes(0)) throw new ApiError("invalid_params", "is not text");
  return { text: new TextDecoder().decode(bytes), mtime: info.mtimeMs, missing: false };
}

/** Writes `text` to `path` for the page of pane `id`, and answers when the file now changed. */
export function write(id: number, path: string, text: string): { mtime: number } {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    const mtime = statSync(path).mtimeMs;
    settle(id, { path });
    return { mtime };
  } catch (err) {
    const error = new ApiError("exception", `${path}: ${message(err)}`);
    settle(id, { error });
    void notify(`Could not save ${path}: ${message(err)}`, "error");
    throw error;
  }
}

/** The page of pane `id` had nothing to save. */
export function unsaved(id: number, why: string): null {
  settle(id, { error: new ApiError("invalid_params", `pane ${id}: ${why}`) });
  return null;
}

// ---- what the app reaches: `save` is the manifest's command (`<D-s>`) and the function a script
// or an agent calls, so it is provided with its parameter rather than through `command`.

provide(
  plugin.prefixed("save"),
  {
    desc: "Save the file a file pane the editor draws shows (the current pane without one). Answers the pane and the path written.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [7] }, { args: [{ pane: 7 }] }, { args: [], desc: "The current pane, if it is a file pane." }],
    returns: "`{pane, path}`, or null when the current pane is not a file pane.",
  },
  (first?: unknown) => save(paneOf(first)),
);

/** Runs one of Monaco's actions in the file pane `what` names, or the current one. */
async function act(what: unknown, id: string): Promise<null> {
  const target = paneOf(what) ?? (await here())?.id;
  if (target === undefined || !(await isEditor(target))) return null;
  await call("pane.call", target, "action", { id });
  return null;
}

command("find", (what?: unknown) => act(what, "actions.find"));
command("goToLine", (what?: unknown) => act(what, "editor.action.gotoLine"));
command("commands", (what?: unknown) => act(what, "editor.action.quickCommand"));

/** Flips one of the plugin's boolean options, kept in settings.json as Settings keeps it. */
async function toggle(key: string): Promise<boolean> {
  const next = !(await option.get(key));
  await option.set(key, next, { save: true });
  return next;
}

command("toggleWordWrap", () => toggle("word_wrap"));
command("toggleMinimap", () => toggle("minimap"));
