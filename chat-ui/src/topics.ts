// What the worker tells the chat's views, named once for both halves. No `import … from "pumi"`
// here: `ui.tsx` imports it, and so does `bridge.ts`.
import type { Update } from "./conversation/change.ts";
import type { Cursor } from "./conversation/model.ts";

/** The channel topic (`ui.post`) the chat hears its tab's batches on. */
export const UPDATE = "update";

/** What `UPDATE` carries. */
export interface TabUpdate {
  tab: number;
  update: Update;
}

/**
 * The data of `<prefix>conversation.changed`: the convention's `{tab, changes, cursor}`, and
 * `from`, the cursor the changes go on from (`null` for a new epoch: read again).
 */
export interface Changed {
  tab: number;
  changes: Extract<Update, { type: "changes" }>["changes"];
  cursor: Cursor;
  from: Cursor | null;
}
