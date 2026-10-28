// What a row's context menu offers, in its order. The app's own context menu cannot be given items
// by a plugin, so the tree draws the menu itself, in a popover over the row, out of these names.

/** What the menu depends on: the row, and what the panel can do to it. */
export interface EntryContext {
  isDir: boolean;
  /** The project's own row: it cannot be trashed, deleted or renamed away. */
  isRoot: boolean;
  /** A directory holding one directory: it can be folded into one row. */
  isFoldable: boolean;
  /** A directory in a chain nobody has unfolded: it can be unfolded. */
  isUnfoldable: boolean;
  hasGitRepo: boolean;
  /** Something was cut or copied, so there is something to paste. */
  hasPasteableContent: boolean;
}

/** The actions of a row's menu, in order. */
export function contextMenu(context: EntryContext): string[] {
  const entries = ["New File", "New Folder", "Reveal in Finder", "Open in Default App"];
  if (context.isUnfoldable) entries.push("Unfold Directory");
  if (context.isFoldable) entries.push("Fold Directory");
  entries.push("Cut", "Copy", "Duplicate");
  if (context.hasPasteableContent) entries.push("Paste");
  entries.push("Copy Path", "Copy Relative Path");
  if (context.hasGitRepo) entries.push("Add to .gitignore", "Add to .git/info/exclude");
  entries.push("Rename");
  if (!context.isRoot) entries.push("Trash", "Delete");
  if (context.isDir) entries.push("Expand All", "Collapse All");
  return entries;
}
