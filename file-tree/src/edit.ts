// The row being renamed, or the name of the file or folder about to be made.
// The row holds the app's `input` element, which keeps the cursor and the selection, so what is
// here is what the name means when the user is done typing.
import * as relpath from "./relpath.ts";

export interface Edit {
  /** The directory a new entry goes in, or the entry being renamed. */
  entry: string;
  /** The entry being renamed; `null` for one that does not exist yet. */
  leaf: string | null;
  /** A folder is being made or renamed rather than a file. */
  isDir: boolean;
  /** What has been typed so far. */
  name: string;
  /** The folded row a new entry is being typed under, opened for as long as it is typed: the row
   * above it is in a chain that is drawn as one row. */
  temporarilyUnfolded: string | null;
}

/** Whether the edit is typing the name of something new. */
export function isNewEntry(edit: Edit): boolean {
  return edit.leaf === null;
}

/** The name the edit commits to, and what is being made of it; `null` while it names nothing, which
 * leaves the field where it is. A name ending in `/` makes a folder, as `mkdir` reads it. */
export function draftOf(edit: Edit): { name: string; isDir: boolean } | null {
  let name = edit.name.trim();
  let isDir = edit.isDir;
  if (edit.leaf === null && name.endsWith("/")) {
    isDir = true;
    name = name.replace(/\/+$/, "");
  }
  return name === "" ? null : { name, isDir };
}

/** Where an edit of the entry `rel` would put it: a new entry's own path, or a rename's two ends. */
export function targetOf(edit: Edit, name: string): { from: string; to: string } | null {
  if (edit.leaf === null) return { from: "", to: relpath.join(edit.entry, name) };
  return { from: edit.leaf, to: relpath.join(relpath.parent(edit.leaf), name) };
}
