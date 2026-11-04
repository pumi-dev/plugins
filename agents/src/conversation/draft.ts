// A chat's draft as every window of it sees it: the words typed in one window show in the others
// while they are written, as a terminal's screen does. The worker keeps it per tab (`drafts.ts`),
// each window shows it (`ui/shared.ts` `useSharedDraft`), and this is what both sides say it is.
// No `import … from "pumi"` here: the worker, the window and the tests all read it.
import type { Chip, SavedDraft } from "./ui/composer.tsx";

export type { SavedDraft };

/**
 * One tab's draft, as written last: the text and the chips in it, and which view wrote it. A view
 * applies what it has not seen (`carries`) and tells its own writes by `by`.
 */
export interface SharedDraft {
  /** Moves by one with each write, across tabs: a view knows whether it has this one already. */
  seq: number;
  /** The view that wrote it, `<app>/<window>` (`ui/shared.ts`): another app's window 1 is not this one's. */
  by: string;
  /** When it was written, in ms since the epoch. */
  at: number;
  /** The text, as the field has it (no chips folded in: they are `chips`). */
  draft: string;
  /** The files, folders, skills and pictures written in it, drawn in the line. */
  chips: Chip[];
}

/** Whether `next` is a draft `seen` has not had yet: it is the one to show. */
export function carries(next: SharedDraft | undefined, seen: SharedDraft | undefined): boolean {
  if (!next) return false;
  return seen === undefined || next.seq > seen.seq;
}

/** Whether two drafts say the same thing: nothing to show again. */
export function sameDraft(a: SharedDraft | undefined, b: SharedDraft | undefined): boolean {
  if (!a || !b) return a === b;
  return a.draft === b.draft && sameChips(a.chips, b.chips);
}

/** Whether two lines carry the same chips, as they draw them. */
export function sameChips(a: Chip[], b: Chip[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((chip, at) => {
    const other = b[at]!;
    return chip.token === other.token && chip.label === other.label && chip.kind === other.kind && chip.preview === other.preview && chip.image?.uri === other.image?.uri && chip.image?.mimeType === other.image?.mimeType;
  });
}

/** The text and chips a draft holds, `null` (emptied, or sent) being an empty one. */
export function draftParts(saved: SavedDraft | null | undefined): SavedDraft {
  const chips = saved?.chips;
  return { draft: typeof saved?.draft === "string" ? saved.draft : "", chips: Array.isArray(chips) ? chips : [] };
}

/**
 * The longest draft that goes to a tab's other windows: a prompt that long is not one, and a field
 * that holds one keeps it to itself (the tab's option, `kept.ts`, has the same bound).
 */
export const DRAFT_MAX = 64 * 1024;
