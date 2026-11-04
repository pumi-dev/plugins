// The plugin's tab drafts (`conversation/drafts.ts`): one for the worker, sent to the windows of
// the plugin host on its channel and to every app's by the plugin's event. A chat draws a tab in
// more than one window (the same view in two windows, or another app on the server), and the words
// typed in one show in the others as they are written.
import { emit, ui } from "pumi";

import type { SavedDraft, SharedDraft } from "./conversation/draft.ts";
import { Drafts } from "./conversation/drafts.ts";
import { DRAFT_CHANGED } from "./names.ts";
import { DRAFT, type DraftUpdate } from "./topics.ts";

const drafts = new Drafts({
  publish: (tab: number, state: SharedDraft) => {
    const data: DraftUpdate = { tab, state };
    // The plugin host's own windows, in process (a window in another app never hears this).
    ui.post(DRAFT, data);
    void emit(DRAFT_CHANGED, data, { tab: `%${tab}` }).catch((err) => console.warn(`agents: ${DRAFT_CHANGED}: ${err?.message ?? err}`));
  },
});

export const draftOf = (tab: number): SharedDraft | undefined => drafts.get(tab);
export const setDraft = (tab: number, by: string, saved: SavedDraft | null): SharedDraft => drafts.set(tab, by, saved);
export const forgetDraft = (tab: number): void => drafts.forget(tab);
