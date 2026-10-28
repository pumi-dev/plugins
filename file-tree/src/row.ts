// A row of the project tree. It is what the view draws — where the row sits,
// what it says, what it is drawn in, and what can be done to it — and the key it is known by across
// renders, so the app's diff keeps a row's node when the tree around it moves.
import type { LabelColor } from "./git.ts";

/** A row's key is `e:<path in the project>`; the root's is `e:.`. */
export const ENTRY_KEY = "e:";
const ROOT_KEY = ".";
/** The row a new file or folder is typed into, until it has a name. */
export const NEW_ENTRY_KEY = "new:entry";

/** The key of the entry at `rel`. */
export function entryKey(rel: string): string {
  return `${ENTRY_KEY}${rel === "" ? ROOT_KEY : rel}`;
}

/** The path a row's key names; `null` for a key that names no entry. */
export function entryRel(key: string): string | null {
  if (key === NEW_ENTRY_KEY) return null;
  const at = key.startsWith(ENTRY_KEY) ? key.slice(ENTRY_KEY.length) : null;
  if (at === null) return null;
  return at === ROOT_KEY ? "" : at;
}

/** The indent a level of the tree takes, in pixels: VS Code's density, a level a chevron and a half. */
export const DEFAULT_INDENT = 12;

/** Where a row's guideline sits inside its indent: under the middle of its parent's chevron. */
export const GUIDE_OFFSET = 8;

export interface Row {
  key: string;
  /** `folder` or `file`. */
  kind: "folder" | "file";
  /** How many directories deep it is drawn, after the folded chains above it. */
  depth: number;
  /** A folder's own disclosure triangle is open. */
  open: boolean;
  /** Its icon, the Material Icon Theme's name for it (`rust`, `folder-src`; `icon-path.ts` makes
   *  it a file), or `""` for none. */
  icon: string;
  text: string;
  color: LabelColor;
  selected: boolean;
  /** Pixels per level of the indent. */
  indent: number;
  /** Where it is on disk, for a drag or a copy; `""` for the row being typed into. */
  path: string;
  /** What its context menu offers, in order. */
  actions: string[];
  /** It is being renamed, and `text` is what has been typed so far. */
  editing: boolean;
}

/** A row before the panel has said anything about it. */
export function plainRow(key: string): Row {
  return {
    key,
    kind: "file",
    depth: 0,
    open: false,
    icon: "",
    text: "",
    color: "muted",
    selected: false,
    indent: DEFAULT_INDENT,
    path: "",
    actions: [],
    editing: false,
  };
}

/** What a row's git summary is drawn as: the theme tokens its text takes, the first the theme has.
 *  A theme may colour git's states itself (`status.added`, …); the default theme's `success`,
 *  `warning` and `error` stand in for them. */
export function colorTokens(color: LabelColor): string[] {
  switch (color) {
    case "conflict":
      return ["status.conflict", "error"];
    case "deleted":
      return ["status.deleted", "error"];
    case "modified":
      return ["status.modified", "warning"];
    case "added":
      return ["status.added", "success"];
    case "ignored":
      return ["faint"];
    case "selected":
      return ["text"];
    case "muted":
      return ["muted"];
  }
}
