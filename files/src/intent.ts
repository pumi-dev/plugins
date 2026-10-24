// What a gesture of the panel comes to, and what carrying it out does: core/files' `Intent` and
// `carry_out` (`lib.rs`). The panel decides, this file acts — files on disk, the clipboard, and
// opening a file: in a file pane (`file.open`, drawn by whichever plugin fits it), a terminal pane
// running the user's editor, or whatever app owns it.
import { dirname } from "node:path";
import { file, pane, plugin } from "pumi";
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

/** What the core plugin opens by itself once something is made: a new file, and a file a paste put
 * down. A moved folder is left closed, where the core plugin would open it too. */
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
 * Opens `rel` as the `open_with` option says, split on the right of the pane whose directory the
 * tree follows: in a file pane (`file.open`: the one showing it already, else a new one, drawn by
 * the plugin that fits it), the user's editor in a terminal pane, or the system's app.
 */
export async function openFile(panel: Panel, rel: string): Promise<void> {
  if (panel.settings.openWith === "system") {
    await ops.openWithSystem(panel.root, rel);
    return;
  }
  const path = panel.tree.abs(rel);
  const place =
    panel.followedPane === null
      ? { kind: "tiled" as const, split: "right" as const }
      : { kind: "tiled" as const, beside: panel.followedPane, split: "right" as const, size: "45%" };
  const editor = panel.settings.editor.trim();
  const command = editor === "" ? `"\${EDITOR:-vi}" ${quote(path)}` : `${editor} ${quote(path)}`;
  try {
    if (panel.settings.openWith === "pane") await file.open(path, {}, place);
    else await pane.open("terminal", { command, cwd: dirname(path) }, place);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(`${plugin.prefix}: cannot open ${path}: ${why}`);
    // The next honest thing: the app the system gives it, rather than nothing at all.
    await ops.openWithSystem(panel.root, rel);
  }
}

/** A path as one shell argument, in single quotes. */
export function quote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}
