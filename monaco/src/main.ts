// monaco: a code editor in a pane — Monaco, VS Code's editor, in a page of the plugin's own
// (`web/`, built from `page/` by `bun scripts/build.ts`), drawn by `ui.tsx`'s `Editor`.
//
//   pumi call amresyd.monaco.open /src/main.rs                  # in an editor pane, or a new one
//   pumi call amresyd.monaco.open /src/main.rs '{"line":42}'    # at line 42
//   pumi call amresyd.monaco.reveal '{"path":"/src/main.rs","line":42}'
//   pumi call amresyd.monaco.save 7                             # the file pane 7 shows, to disk
//
// The page holds the text; this holds the disk. The page reads and writes through the exports
// below (`read`, `write`, its `<prefix>rpc`), and is told what to show through its pane: the
// option `path` (which a pane comes back with), and `wanted` for a line to go to, which it takes
// when it loads or when the block's `reveal` method says there is one.
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { ApiError, call, command, dialog, format, notify, option, pane, plugin, provide, type PlaceSpec } from "pumi";

/** The block an editor pane holds: `amresyd.monaco.editor`. */
const BLOCK = plugin.prefixed("editor");
/** The pane option naming its file, by its full name: what `pane.open` sets as a pane opens. */
const PATH = plugin.prefixed("path");
/** A file larger than this is not opened: the page would hold it all. */
const LIMIT = 16 * 1024 * 1024;
/** How long `save` waits for the page to hand over its text. */
const SAVE_WAIT = 8000;

/** Where a call asks a file to be shown. */
interface At {
  path: string;
  line?: number;
  column?: number;
}

/** What `open` takes beside the path. */
interface OpenOpts {
  line?: number;
  column?: number;
  /** An editor pane to show it in, instead of finding one. */
  pane?: number;
  /** Where a new pane goes; beside the current one, on its right, by default. */
  place?: PlaceSpec;
}

/** What each editor page is to show when it next asks (`wanted`), by pane. */
const wants = new Map<number, At>();
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

/** A whole number a call gives (`line`), or undefined. */
function count(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

/** The current pane, as the app has it; null when there is none. */
async function here(): Promise<{ id: number; block: string; tab?: number } | null> {
  const info = await call("pane.get").catch(() => null);
  if (!info || typeof info.id !== "number") return null;
  const tab = (info.place as { tab?: unknown } | undefined)?.tab;
  return { id: info.id, block: String(info.block), tab: typeof tab === "number" ? tab : undefined };
}

/** `path` as an absolute one: `~` is home, and a relative path is the current pane's directory's. */
async function absolute(path: string): Promise<string> {
  if (path === "~" || path.startsWith("~/")) return join(homedir(), path.slice(1));
  if (isAbsolute(path)) return resolve(path);
  const at = await here();
  const dir = at ? await format.eval("#{pane_current_path}", { pane: at.id }).catch(() => "") : "";
  return resolve(typeof dir === "string" && dir !== "" ? dir : homedir(), path);
}

async function isEditor(id: number): Promise<boolean> {
  const info = await call("pane.get", id).catch(() => null);
  return info?.block === BLOCK;
}

/** The editor pane a file goes to: one showing it already, else the current pane if it is an
 *  editor, else an editor in the current tab; null when a new one is to open. */
async function editorFor(path: string): Promise<number | null> {
  const editors = ((await call("pane.list", { block: BLOCK }).catch(() => [])) as unknown[]).filter((id): id is number => typeof id === "number");
  for (const id of editors) {
    if ((await option.get("path", { pane: id }).catch(() => null)) === path) return id;
  }
  const at = await here();
  if (at?.block === BLOCK) return at.id;
  if (at?.tab === undefined) return null;
  const inTab = ((await call("pane.list", { tab: at.tab, block: BLOCK }).catch(() => [])) as unknown[]).filter((id): id is number => typeof id === "number");
  return inTab[0] ?? null;
}

/** Shows `path` in an editor pane (`opts.pane`, one already showing it, the current one, or a new
 *  one beside it), at `opts.line`. With no path it asks for a file. Answers where it is. */
export async function open(path?: string, opts: OpenOpts = {}): Promise<{ pane: number; path: string; opened: boolean }> {
  let asked = path;
  if (!asked) {
    const picked = await dialog.file({ mode: "open", prompt: "Open in the editor" });
    if (!picked.length) throw new ApiError("cancelled", "no file was chosen");
    asked = picked[0];
  }
  const file = await absolute(asked);
  const at: At = { path: file, line: count(opts.line), column: count(opts.column) };
  let target = opts.pane ?? null;
  if (target !== null && !(await isEditor(target))) throw new ApiError("invalid_params", `pane ${target} is not an editor (${BLOCK})`);
  target ??= await editorFor(file);
  if (target !== null) {
    wants.set(target, at);
    await option.set("path", file, { pane: target });
    // Its page, if it is drawn, takes what it is wanted to show; else it takes it when it loads.
    await call("pane.call", target, "reveal", {}).catch(() => null);
    await call("pane.select", { pane: target }).catch(() => null);
    return { pane: target, path: file, opened: false };
  }
  const opened = await pane.open(BLOCK, { [PATH]: file }, opts.place ?? { split: "right" });
  const id = Number(opened.id ?? opened);
  wants.set(id, at);
  return { pane: id, path: file, opened: true };
}

/** Writes the file pane `id` shows (the current pane without one) and answers its path; a pane
 *  that is not an editor is an error only when it was named. */
export async function save(id?: number): Promise<{ pane: number; path: string } | null> {
  const named = id !== undefined;
  const target = id ?? (await here())?.id;
  if (target === undefined || !(await isEditor(target))) {
    if (named) throw new ApiError("invalid_params", `pane ${target} is not an editor (${BLOCK})`);
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
    waiter?.reject(new ApiError("timeout", `the editor in pane ${target} did not answer: is it drawn in a window?`));
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

/** What pane `id`'s page is to show, once: a file and a line `open` asked for. */
export function wanted(id: number): At | null {
  const at = wants.get(id) ?? null;
  wants.delete(id);
  return at;
}

// ---- what the app reaches: the commands, which are the functions too

/** `open(path, opts)` as a call names it: a path, or `{ path, line, … }`; a slot's `{ pane }` is
 *  the pane to open a chosen file in. */
async function opening(first?: unknown, second?: unknown) {
  const table = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const opts = { ...table(first), ...table(second) };
  const path = typeof first === "string" ? first : typeof opts.path === "string" ? opts.path : undefined;
  return open(path, {
    line: count(opts.line),
    column: count(opts.column),
    pane: paneOf(opts),
    place: table(opts.place) as PlaceSpec,
  });
}

// `open` and `save` are the manifest's commands (the palette, `<D-s>`) and the functions a script or
// an agent calls, so they are provided with their parameters rather than through `command`.
provide(
  plugin.prefixed("open"),
  {
    desc: "Open a file in an editor pane: the one showing it already, the current pane if it is an editor, an editor in the current tab, or a new one beside the current pane. With no path it asks for a file. Answers the pane.",
    effect: "write",
    parameters: [
      ["string", "path"],
      ["table", "opts"],
    ],
    examples: [
      { args: ["/src/main.rs"], desc: "Show it in an editor." },
      { args: ["/src/main.rs", { line: 42 }], desc: "At line 42." },
      { args: [{ path: "src/lib.rs", pane: 7 }], desc: "In editor pane 7; a relative path is the current pane's directory's." },
    ],
    returns: "`{pane, path, opened}`: `opened` when a new pane was made.",
  },
  opening,
);

provide(
  plugin.prefixed("save"),
  {
    desc: "Save the file an editor pane shows (the current pane without one). Answers the pane and the path written.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [7] }, { args: [{ pane: 7 }] }, { args: [], desc: "The current pane, if it is an editor." }],
    returns: "`{pane, path}`, or null when the current pane is not an editor.",
  },
  (first?: unknown) => save(paneOf(first)),
);

provide(
  plugin.prefixed("reveal"),
  {
    desc: "Show a file at a line in an editor pane, as `open` does with a line.",
    effect: "write",
    parameters: [
      ["string", "path"],
      ["number", "line"],
    ],
    examples: [{ args: ["/src/main.rs", 42] }, { args: [{ path: "/src/main.rs", line: 42, column: 5 }] }],
    returns: "`{pane, path, opened}`.",
  },
  (first?: unknown, second?: unknown) => opening(first, typeof second === "number" || typeof second === "string" ? { line: second } : second),
);

/** Runs one of Monaco's actions in pane `what` names, or the current one if it is an editor. */
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
