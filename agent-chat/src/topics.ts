// What the worker tells the chat's views, named once for both halves. No `import … from "pumi"`
// here: `ui.tsx` imports it, and so does `bridge.ts`.
import type { Update } from "../../lib/conversation/src/change.ts";
import type { Cursor } from "../../lib/conversation/src/model.ts";

/** The channel topic (`ui.post`) a view hears its pane's batches on. */
export const UPDATE = "update";

/** What `UPDATE` carries. */
export interface PaneUpdate {
  pane: number;
  update: Update;
}

/**
 * The data of `<prefix>conversation.changed`: the convention's `{pane, changes, cursor}`, and
 * `from`, the cursor the changes go on from (`null` for a new epoch: read again).
 */
export interface Changed {
  pane: number;
  changes: Extract<Update, { type: "changes" }>["changes"];
  cursor: Cursor;
  from: Cursor | null;
}
