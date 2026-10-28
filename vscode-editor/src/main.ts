// vscode-editor: a code editor for the core's `file` tabs: Monaco, VS Code's editor, in a page of
// the plugin's own (`web/`, built from `page/` by `page.ts` the first time it runs), drawn by
// `ui.tsx`'s `Editor`. Its manifest's `renderers.file` claims every file (`*`), so a file opened
// anywhere (`pumi open`, the File Tree, the palette) is drawn here unless a viewer that fits it
// better is enabled, or the tab's `@tab_renderer` names another.
//
//   pumi open src/main.rs                               # on the right of this tab
//   pumi open --line 42 notes.md                        # at line 42, in this editor
//   pumi call pumi_dev.vscode_editor.save %7            # the file tab %7 shows, to disk
//
// The page holds the text; this holds the disk. The page reads and writes through the exports
// below (`read`, `write`, its `<prefix>rpc`), and learns what to show from its tab: the core's
// option `path`, and `tab.call(tab, "at")` for a line to go to, which it takes when it loads or
// when the block's `reveal` says there is one.
import { dirname } from "node:path";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { ApiError, fn, option, request, self, ui, workspace, type TabId } from "pumi";
import { ensurePage } from "./page.ts";

/** The core's block for a file, which the editor draws. */
const BLOCK = "file";
/** A file larger than this is not opened: the page would hold it all. */
const LIMIT = 16 * 1024 * 1024;
/** How long `save` waits for the page to hand over its text. */
const SAVE_WAIT = 8000;

/** The channel this plugin's pages hear their tab's methods on (`ui.tsx`'s `useChannelListener`). */
const PAGE = "page";

/** Who waits for each tab's save, settled when its page writes (or says it can't). */
const saving = new Map<TabId, { resolve(path: string): void; reject(err: Error): void }[]>();

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A tab a call names: `"%7"`, `{ tab: "%7" }` (or `7`, which is `%7`); undefined for none. */
function tabOf(what: unknown): TabId | undefined {
  const named = typeof what === "object" && what !== null ? (what as { tab?: unknown }).tab : what;
  if (named === undefined || named === null) return undefined;
  const id = typeof named === "number" ? `%${named}` : named;
  if (typeof id !== "string" || !/^(?:[A-Za-z0-9._-]+\/)?%[1-9][0-9]*$/.test(id)) throw new ApiError("invalid_params", `not a tab: ${String(named)}`);
  return id as TabId;
}

/** The current tab, as the app has it; null when there is none. */
async function here(): Promise<{ id: TabId; block: string } | null> {
  await workspace.ready.catch(() => undefined);
  const tab = workspace.currentTab;
  return tab === null ? null : { id: tab.id as TabId, block: String(tab.block) };
}

async function isEditor(id: TabId): Promise<boolean> {
  await workspace.ready.catch(() => undefined);
  return workspace.getTab(id)?.block === BLOCK;
}

/** Writes the file tab `id` shows (the current tab without one) and answers its path; a tab
 *  that is not a file tab is an error only when it was named. */
export async function save(id?: TabId): Promise<{ tab: TabId; path: string } | null> {
  const named = id !== undefined;
  const target = id ?? (await here())?.id;
  if (target === undefined || !(await isEditor(target))) {
    if (named) throw new ApiError("invalid_params", `tab ${target} is not a file tab`);
    return null;
  }
  const path = await option.get("path", { scope: "tab", id: target }).catch(() => "");
  if (typeof path !== "string" || path === "") throw new ApiError("invalid_params", `tab ${target} shows no file`);
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
    waiter?.reject(new ApiError("timeout", `the editor in tab ${target} did not answer: is it drawn in a window, by this plugin?`));
  }, SAVE_WAIT);
  try {
    // The page draws the text and hands it back through plain text: nothing asks it through the
    // wire, which would be this same function.
    ui.post(PAGE, { tab: target, method: "save" });
    return { tab: target, path: await written };
  } finally {
    clearTimeout(timer);
  }
}

/** Settles whoever waits for tab `id`'s save. */
function settle(id: TabId, outcome: { path: string } | { error: Error }): void {
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

/** Writes `text` to `path` for the page of tab `id`, and answers when the file now changed. */
export function write(id: TabId, path: string, text: string): { mtime: number } {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    const mtime = statSync(path).mtimeMs;
    settle(id, { path });
    return { mtime };
  } catch (err) {
    const error = new ApiError("exception", `${path}: ${message(err)}`);
    settle(id, { error });
    void request.open({ kind: "notification", title: `Could not save ${path}: ${message(err)}`, level: "error" });
    throw error;
  }
}

/** The page of tab `id` had nothing to save. */
export function unsaved(id: TabId, why: string): null {
  settle(id, { error: new ApiError("invalid_params", `tab ${id}: ${why}`) });
  return null;
}

// ---- what the app reaches: `save` is the manifest's command (`<D-s>`) and the function a script
// or an agent calls, so it is provided with its parameter rather than through `command`.

fn.set(self.plugin.prefixed("save"), {
  desc: "Save the file a file tab the editor draws shows (the current tab without one). Answers the tab and the path written.",
  effect: "write",
  parameters: [["string", "tab"]],
  examples: [{ args: ["%7"] }, { args: [{ tab: "%7" }] }, { args: [], desc: "The current tab, if it is a file tab." }],
  returns: "`{tab, path}`, or null when the current tab is not a file tab.",
  callback: (first?: unknown) => save(tabOf(first)),
});

/** Runs one of Monaco's actions in the file tab `what` names, or the current one. */
async function act(what: unknown, id: string): Promise<null> {
  const target = tabOf(what) ?? (await here())?.id;
  if (target === undefined || !(await isEditor(target))) return null;
  ui.post(PAGE, { tab: target, method: "action", args: { id } });
  return null;
}

// The manifest's commands, which is what gives them their titles and keys.
fn.set(self.plugin.prefixed("find"), { desc: "Find in the file the editor draws.", callback: (what?: unknown) => act(what, "actions.find") });
fn.set(self.plugin.prefixed("goToLine"), { desc: "Go to a line of the file the editor draws.", callback: (what?: unknown) => act(what, "editor.action.gotoLine") });
fn.set(self.plugin.prefixed("commands"), { desc: "Show the editor's own commands.", callback: (what?: unknown) => act(what, "editor.action.quickCommand") });

/** Flips one of the plugin's boolean options, kept in settings.json as Settings keeps it. */
async function toggle(key: string): Promise<boolean> {
  const next = !(await option.get(key));
  await option.set(key, next);
  return next;
}

fn.set(self.plugin.prefixed("toggleWordWrap"), { desc: "Wrap the editor's long lines at the tab's edge.", callback: () => toggle("word_wrap") });
fn.set(self.plugin.prefixed("toggleMinimap"), { desc: "Draw the file in miniature along the tab's right edge.", callback: () => toggle("minimap") });

/** The page, built when this version of it has not been yet: the window waits for it to draw the
 *  editor. Answers the error that stopped it, or null. */
export async function page(): Promise<string | null> {
  return built;
}

const built: Promise<string | null> = ensurePage().then(
  () => null,
  (err) => {
    console.error(`vscode-editor: building the page: ${message(err)}`);
    return message(err);
  },
);
