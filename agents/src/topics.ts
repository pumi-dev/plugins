// What the worker tells the chat's views, named once for both halves. No `import … from "pumi"`
// here: `ui.tsx` imports it, and so does `bridge.ts`.
import type { Update } from "./conversation/change.ts";
import type { SharedDraft } from "./conversation/draft.ts";
import type { Cursor } from "./conversation/model.ts";
import type { HostState } from "./session/wire.ts";

/** The channel topic (`ui.post`) the chat hears its tab's batches on. */
export const UPDATE = "update";

/** The channel topic (`ui.post`) a tab's draft is heard on (`drafts.ts`). */
export const DRAFT = "draft";

/** What `DRAFT` carries: a tab's draft as one window of it wrote it. */
export interface DraftUpdate {
  tab: number;
  state: SharedDraft;
}

/** What `<prefix>session.changed` carries: a session tab's own state (`sessions.ts` `publishState`). */
export interface StateChanged {
  tab: number;
  state: HostState;
}

/** What `UPDATE` carries. */
export interface TabUpdate {
  tab: number;
  update: Update;
}

/**
 * What `<prefix>conversation.read` answers: the whole of it (`{snapshot, cursor}`), or what
 * followed `since` (`{changes, cursor}`).
 */
export type ConversationRead =
  | { snapshot: Extract<Update, { type: "snapshot" }>["transcript"]; cursor: Cursor }
  | { changes: Extract<Update, { type: "changes" }>["changes"]; cursor: Cursor };

/**
 * The data of `<prefix>conversation.changed`: `{tab, changes, cursor}`, and
 * `from`, the cursor the changes go on from (`null` for a new epoch: read again).
 */
export interface Changed {
  tab: number;
  changes: Extract<Update, { type: "changes" }>["changes"];
  cursor: Cursor;
  from: Cursor | null;
}
