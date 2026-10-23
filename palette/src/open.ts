// A file the palette chose. The core plugin asks the app to open it in the app's own editor, as a
// document tab; a package cannot — the editor and its tabs are the app's, and nothing asks the app
// for a document on a package's behalf (BRIEF, gap 4). So a chosen file opens the way a terminal
// opens a file: `$EDITOR` in a terminal pane of its own, in a tab named after the file, the way an
// editor tab would. A file no editor can render — an image, a PDF, a video, an archive — goes to
// `fs.open` instead, which is the desktop's own viewer for it.
import { basename, dirname } from "node:path";
import { fs, pane } from "pumi";

/** The kinds the desktop opens better than a text editor does. */
const VIEWERS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "ico", "icns",
  "pdf", "psd", "ai", "sketch", "fig",
  "mp3", "m4a", "wav", "flac", "ogg", "aac", "mp4", "mov", "mkv", "avi", "webm",
  "zip", "tar", "gz", "bz2", "xz", "7z", "rar", "dmg", "iso",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pages", "numbers", "key", "epub",
]);

/** Whether a path is one of those: by its extension, which is all there is to go on. */
export function viewed(path: string): boolean {
  const name = basename(path);
  const at = name.lastIndexOf(".");
  return at > 0 && VIEWERS.has(name.slice(at + 1).toLowerCase());
}

/** The editor to run, as the words to run: `$EDITOR`, then `$VISUAL`, then `vi`. Split on spaces, so
 * a `code --wait` is two words and the file is the third. */
export function editor(): string[] {
  for (const said of [process.env.EDITOR, process.env.VISUAL]) {
    if (said === undefined) continue;
    const words = said.trim().split(/\s+/).filter((word) => word !== "");
    if (words.length > 0) return words;
  }
  return ["vi"];
}

/** Opens `path` with the editor, in a tab of its own, its directory the one it runs in. */
export async function openChosen(path: string): Promise<void> {
  if (viewed(path)) {
    await fs.open({ path });
    return;
  }
  await pane.open("terminal", { command: [...editor(), path], cwd: dirname(path) }, { kind: "tab", name: basename(path) });
}
