// code-editor: a code editor for the core's `file` tabs, written in TSX. Its `ui.tsx` draws the file
// with pumi's own elements (no web page): CodeMirror's state and parsers hold and colour the text
// (`src/codemirror.ts`), and `<text-input>` gives it the platform's typing.
//
//   pumi open src/main.rs                   # any text file; the languages ship colours
//   pumi call pumi_dev.code_editor.save %7  # the file the file tab %7 shows, to disk
//
// This half holds the disk: it reads a file for the view, writes what the view hands it, and
// keeps the tab's `dirty` option, which says whether its file has unsaved changes.
import { dirname } from "node:path";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { ApiError, fn, option, request, ui, workspace } from "pumi";

/** A file larger than this is not opened: the view would hold it all. */
const LIMIT = 16 * 1024 * 1024;
/** The channel the views hear what is asked of their tab on (`ui.tsx`'s `useChannelListener`). */
const VIEW = "view";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A file's text and when it last changed; `missing` for one not there yet (saving makes it). */
export async function read(path: string): Promise<{ text: string; mtime: number; missing: boolean }> {
  let info;
  try {
    info = statSync(path);
  } catch {
    return { text: "", mtime: 0, missing: true };
  }
  if (info.isDirectory()) throw new ApiError("invalid_params", `${path} is a folder`);
  if (info.size > LIMIT) throw new ApiError("invalid_params", `${path} is ${(info.size / 1024 / 1024).toFixed(0)} MB: the editor opens files up to ${LIMIT / 1024 / 1024} MB`);
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  if (bytes.subarray(0, 8192).includes(0)) throw new ApiError("invalid_params", `${path} is not text`);
  return { text: new TextDecoder().decode(bytes), mtime: info.mtimeMs, missing: false };
}

/** Writes `text` to `path` for the view of tab `tab`, and answers when the file now changed. */
export async function write(tab: string, path: string, text: string): Promise<{ mtime: number }> {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    await setDirty(tab, false);
    return { mtime: statSync(path).mtimeMs };
  } catch (err) {
    void request.open({ kind: "notification", title: `Could not save ${path}: ${message(err)}`, level: "error" }).catch(() => undefined);
    throw new ApiError("exception", `${path}: ${message(err)}`);
  }
}

/** Says whether tab `tab`'s file has unsaved changes (the tab's `dirty` option). */
export async function setDirty(tab: string, dirty: boolean): Promise<null> {
  await option.set("dirty", dirty, { scope: "tab", id: tab }).catch(() => undefined);
  return null;
}

/** A tab a call names: `"%7"`, `{ tab: "%7" }`, or `7`; undefined for none. */
function tabOf(what: unknown): string | undefined {
  const named = typeof what === "object" && what !== null ? (what as { tab?: unknown }).tab : what;
  if (named === undefined || named === null) return undefined;
  const id = typeof named === "number" ? `%${named}` : named;
  if (typeof id !== "string" || !/^(?:[A-Za-z0-9._-]+\/)?%[1-9][0-9]*$/.test(id)) throw new ApiError("invalid_params", `not a tab: ${String(named)}`);
  return id;
}

fn.set(
  "save",
  {
    desc: "Save the file a file tab the code editor draws shows (the current tab without one).",
    effect: "write",
    parameters: [["string", "tab"]],
    examples: [{ args: [], desc: "The current tab, if the editor draws it." }, { args: ["%7"] }],
    returns: "The tab asked, or null when there is none.",
  },
  async (what?: unknown) => {
    await workspace.ready.catch(() => undefined);
    const tab = tabOf(what) ?? workspace.currentTab?.id;
    if (!tab || workspace.getTab(tab)?.block !== "file") return null;
    // The view holds the text: it writes it through `write`.
    ui.post(VIEW, { tab, method: "save" });
    return { tab };
  },
);
