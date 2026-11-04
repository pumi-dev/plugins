// A tab's draft, in this window: what is typed here goes to the worker (`main.ts` `draftWrite`),
// which keeps it for every window of the tab (`drafts.ts`); what is typed in another window comes
// back on the channel, or by the plugin's event in an app that is not the plugin host, and the
// field shows it as it is written (`composer.tsx` `remoteDraft`). The two windows of one chat then
// read each other's prompt, as two windows of a terminal read the same screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChannelListener, useEvent, useWindow } from "pumi";

import { carries, DRAFT_MAX, type SavedDraft, type SharedDraft } from "../conversation/draft.ts";
import { draftRead, draftWrite } from "../main.ts";
import { DRAFT_CHANGED } from "../names.ts";
import { DRAFT, type DraftUpdate } from "../topics.ts";

/**
 * This app's windows, named against another app's: window 1 of the plugin host and window 1 of
 * another app are two windows, and each must know the other's writes are not its own.
 */
const APP = Math.random().toString(36).slice(2, 10);

export interface Shared {
  /** The draft another window of the tab wrote last, when this one did not write it. */
  remote?: SavedDraft;
  /** Whether `remote` is there to show: the chat shows it unless this window is writing. */
  adopts: boolean;
  /** A draft written here: kept by the worker, and shown by the tab's other windows. */
  onDraft(saved: SavedDraft | null): void;
}

/**
 * Tab `tab`'s draft, followed from the worker, and the one this window writes (`keep` puts it in
 * the tab's own options too, `kept.ts`, which outlive the app).
 */
export function useSharedDraft(tab: number, keep: (saved: SavedDraft | null) => void): Shared {
  const [state, setState] = useState<SharedDraft>();
  const seen = useRef<SharedDraft | undefined>(undefined);
  // The window's name on the wire: this app's, and which of its windows (`useWindow`).
  const me = `${APP}/${useWindow().id}`;

  /** The draft as it is now, if it is one this window has not shown. */
  const hear = useCallback((next: SharedDraft | undefined) => {
    if (!carries(next, seen.current)) return;
    seen.current = next;
    setState(next);
  }, []);

  // A window that opens the chat (or the chat of another tab) starts from what the tab has written.
  useEffect(() => {
    let live = true;
    seen.current = undefined;
    setState(undefined);
    draftRead(tab).then(
      (found) => live && hear(found),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [tab, hear]);

  // The plugin host's windows: the worker's writes, in process.
  useChannelListener(DRAFT, (data: DraftUpdate) => {
    if (data?.tab === tab) hear(data.state);
  });
  // Any app's: the plugin's event (a write heard on both is applied once, by its `seq`).
  useEvent<DraftUpdate>(DRAFT_CHANGED, (e) => {
    if (e.data?.tab === tab) hear(e.data.state);
  });

  const onDraft = useCallback(
    (saved: SavedDraft | null) => {
      keep(saved);
      // A draft longer than a prompt is the field's own: it stays in the window it is written in.
      if ((saved?.draft.length ?? 0) > DRAFT_MAX) return;
      void draftWrite(tab, me, saved).then(hear, () => {});
    },
    [tab, me, keep, hear],
  );

  const mine = state?.by === me;
  // The same object while the draft is the same one: the field hears about it once, not at each render.
  const remote = useMemo(() => (!mine && state !== undefined ? { draft: state.draft, chips: state.chips } : undefined), [mine, state]);
  return { remote, adopts: remote !== undefined, onDraft };
}
