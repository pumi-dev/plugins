// What an agent tab's chat keeps in the tab's own options, which outlive the window and the app:
// the draft not sent yet, and the prompts sent. A tab whose session never started (the app quit
// before its first answer) still has them: the draft comes back, and Up brings the prompts back.
import { useEffect, useRef } from "react";
import { call } from "pumi";

import type { SavedDraft } from "../conversation/ui.tsx";
import { KEPT_DRAFT, KEPT_PROMPTS } from "../names.ts";

/** How many prompts a tab keeps, the newest. */
const KEPT_PROMPTS_MAX = 50;
/** The longest draft kept. */
const KEPT_DRAFT_MAX = 64 * 1024;
/**
 * How long the typing rests before the draft is written to the tab. The field hands each change out
 * at once (`composer.tsx` `DRAFT_SAVE_MS`, for the tab's other windows), and the option is written
 * behind it: it is the server's, kept with the tab and the app, so it is written once the words settle.
 */
const KEPT_AFTER_MS = 600;

export interface Kept {
  savedDraft?: SavedDraft;
  onDraft(saved: SavedDraft | null): void;
  pastPrompts: string[];
  /** A prompt sent: kept with the others. */
  remember(text: string): void;
}

/** The draft as the option holds it, when it is one. */
function draftOf(value: unknown): SavedDraft | undefined {
  const v = value as Partial<SavedDraft> | null | undefined;
  return v && typeof v.draft === "string" && v.draft !== "" ? { draft: v.draft, chips: Array.isArray(v.chips) ? v.chips : [] } : undefined;
}

/** The prompts as the option holds them. */
function promptsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === "string" && each.trim() !== "") : [];
}

/** Tab `tab`'s kept draft and prompts, read from its options (`options`, as the window has them now). */
export function useKept(tab: string, options: Record<string, unknown>): Kept {
  const prompts = promptsOf(options[KEPT_PROMPTS]);
  // What was last written, so two prompts sent before the option comes back both stay.
  const written = useRef<string[] | null>(null);
  const set = (name: string, value: unknown) => void call("option.set", name, value, { scope: "tab", id: tab }).catch(() => {});

  // The draft waiting to be written, and the writing of it: the last one only, as a keystroke after
  // a keystroke leaves one draft, and a draft emptied or sent goes at once (the other windows have it).
  const pending = useRef<SavedDraft | null | undefined>(undefined);
  const writing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = () => {
    if (writing.current !== undefined) clearTimeout(writing.current);
    writing.current = undefined;
    if (pending.current === undefined) return;
    const value = pending.current;
    pending.current = undefined;
    set(KEPT_DRAFT, value && value.draft.length <= KEPT_DRAFT_MAX ? value : null);
  };
  // A chat that goes (its tab flipped to the terminal, the window closing) writes what it has.
  useEffect(() => flush, []);

  return {
    savedDraft: draftOf(options[KEPT_DRAFT]),
    onDraft: (saved) => {
      const value = saved && saved.draft !== "" ? saved : null;
      if (value === null) {
        pending.current = null;
        flush();
        return;
      }
      pending.current = value;
      if (writing.current !== undefined) clearTimeout(writing.current);
      writing.current = setTimeout(flush, KEPT_AFTER_MS);
    },
    pastPrompts: prompts,
    remember: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return;
      const was = written.current && written.current.length >= prompts.length ? written.current : prompts;
      const next = [...was.filter((each) => each !== trimmed), trimmed].slice(-KEPT_PROMPTS_MAX);
      written.current = next;
      set(KEPT_PROMPTS, next);
    },
  };
}
