// A file the palette chose: opened as `pumi open` does (`pane.open` of a `file` block), a file pane
// on the right of the current pane, drawn by whichever enabled plugin fits it. A file a text editor cannot show — an image, a PDF, a video, an archive — goes to
// `fs.open`, the desktop's own viewer for it, unless a viewer of its own kind is enabled (one
// whose `match` fits it better than `*`).
import { basename } from "node:path";
import { fs, registry, workspace } from "pumi";

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

/** Opens `path` in a file pane, or with the desktop when only an editor of every file would draw it. */
export async function openChosen(path: string): Promise<void> {
  if (viewed(path)) {
    const viewers = (await registry.list("viewer", { path }).catch(() => [])) as { fit?: number }[];
    if (!viewers.some((v) => (v.fit ?? 0) > 0)) {
      await fs.open(path);
      return;
    }
  }
  await workspace.openPane("file", { path }, { kind: "tiled", split: "right" });
}
