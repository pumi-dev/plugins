// What a gesture of the panel comes to, and what carrying it out does. The panel decides, this file acts — files on disk, the clipboard, and
// opening a file: in a file tab (`tab.open("file", …)`, drawn by whichever plugin fits it), a
// terminal tab running the user's editor (the Terminal plugin's `pumi_dev.terminal.shell`), or
// whatever app owns it.
import { dirname } from "node:path";
import { self, workspace } from "pumi";
import type { Transfer } from "./ops.ts";
import * as ops from "./ops.ts";
import type { Panel } from "./panel.ts";

export type Intent =
  | { kind: "none" }
  | { kind: "redraw" }
  /** A file, opened as the settings say. */
  | { kind: "open"; rel: string }
  | { kind: "clipboard"; text: string }
  | { kind: "create"; path: string; isDir: boolean }
  | { kind: "rename"; from: string; to: string; paste: boolean }
  | { kind: "copy"; from: string; to: string; isFile: boolean }
  | { kind: "drop"; transfers: Transfer[] }
  | { kind: "trash"; rel: string }
  | { kind: "delete"; rel: string }
  | { kind: "reveal"; rel: string }
  | { kind: "systemOpen"; rel: string }
  | { kind: "ignore"; file: "gitignore" | "exclude"; rel: string; isDir: boolean };

/** Carries `intent` out: what touches the disk reads the tree again, and the panel always says so,
 * so that the view draws again. */
export async function perform(panel: Panel, intent: Intent): Promise<void> {
  switch (intent.kind) {
    case "none":
      return;
    case "redraw":
      panel.announce();
      return;
    case "open":
      await openFile(panel, intent.rel);
      panel.announce();
      return;
    case "clipboard":
      await ops.putOnClipboard(intent.text);
      panel.announce();
      return;
    case "reveal":
      await ops.reveal(panel.root, intent.rel);
      panel.announce();
      return;
    case "systemOpen":
      await ops.openWithSystem(panel.root, intent.rel);
      panel.announce();
      return;
    case "create":
      ops.create(panel.root, intent.path, intent.isDir);
      break;
    case "rename":
      ops.rename(panel.root, intent.from, intent.to);
      break;
    case "copy":
      ops.copy(panel.root, intent.from, intent.to);
      break;
    case "drop":
      ops.drop(panel.root, intent.transfers);
      break;
    case "trash":
      await ops.trash(panel.root, intent.rel);
      break;
    case "delete":
      await ops.remove(panel.root, intent.rel);
      break;
    case "ignore":
      ops.ignore(panel.root, intent.file, intent.rel, intent.isDir);
      break;
  }
  panel.rescan();
  await panel.refreshGit();
  panel.announce();
  const opened = opensAfter(panel, intent);
  if (opened !== null) await openFile(panel, opened);
}

/** What opens by itself once something is made: a new file, and a file a paste put down. A moved
 * folder is left closed. */
function opensAfter(panel: Panel, intent: Intent): string | null {
  switch (intent.kind) {
    case "create":
      return intent.isDir ? null : intent.path;
    case "copy":
      return intent.isFile ? intent.to : null;
    case "rename":
      return intent.paste && panel.tree.entry(intent.to)?.kind === "file" ? intent.to : null;
    default:
      return null;
  }
}

/**
 * Opens `rel` as the `open_with` option says: in a view of its own, a file tab split on the right
 * (drawn by the viewer that fits it), the user's editor in a terminal tab (the Terminal plugin's
 * block), or the system's app.
 */
export async function openFile(panel: Panel, rel: string): Promise<void> {
  if (panel.settings.openWith === "system") {
    await ops.openWithSystem(panel.root, rel);
    return;
  }
  const path = panel.tree.abs(rel);
  if (panel.settings.openWith === "tab") {
    try {
      await openInTab(path);
    } catch (err) {
      console.error(`${self.plugin.prefix}: cannot open ${path}: ${err instanceof Error ? err.message : String(err)}`);
      await ops.openWithSystem(panel.root, rel);
    }
    return;
  }
  const place = { kind: "tiled" as const, split: "right" as const };
  const editor = panel.settings.editor.trim();
  const command = editor === "" ? `"\${EDITOR:-vi}" ${quote(path)}` : `${editor} ${quote(path)}`;
  try {
    if (panel.settings.openWith === "beside") await workspace.openTab("file", { path }, place);
    else await workspace.openTab("pumi_dev.terminal.shell", { command, cwd: dirname(path) }, place);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(`${self.plugin.prefix}: cannot open ${path}: ${why}`);
    // The next honest thing: the app the system gives it, rather than nothing at all.
    await ops.openWithSystem(panel.root, rel);
  }
}

/** A file in a view of its own: the file tab of this session that shows it already, brought
 *  forward, else a new view holding a file tab of it. */
async function openInTab(path: string): Promise<void> {
  await workspace.ready;
  const here = workspace.currentSession?.id ?? null;
  const tabs = await workspace.tabs(here === null ? { block: "file" } : { session: here, block: "file" });
  for (const each of tabs) {
    if ((each.options ?? {})["path"] !== path) continue;
    await each.view?.focus();
    await each.focus();
    return;
  }
  await workspace.openTab("file", { path }, { kind: "view" });
}

/** A path as one shell argument, in single quotes. */
export function quote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}
