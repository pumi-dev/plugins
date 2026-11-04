// The draft every window of a chat shows: which write is newer, and whether two lines say the same.
import { expect, test } from "bun:test";

import { carries, draftParts, sameChips, sameDraft, type SharedDraft } from "../src/conversation/draft.ts";
import type { Chip } from "../src/conversation/ui/composer.tsx";

const chip = (token: string, label = token.slice(1)): Chip => ({ token, label, kind: "file" });

const draft = (seq: number, text: string, chips: Chip[] = [], by = "app/1"): SharedDraft => ({ seq, by, at: 1_700_000_000_000 + seq, draft: text, chips });

test("a draft is shown once: the writes after the one a view has", () => {
  expect(carries(draft(3, "a"), undefined)).toBe(true);
  expect(carries(draft(3, "a"), draft(2, "b"))).toBe(true);
  // The same one, or one it passed in another tab's write (a shared counter), is not shown again.
  expect(carries(draft(2, "b"), draft(2, "b"))).toBe(false);
  expect(carries(draft(1, "b"), draft(2, "b"))).toBe(false);
  expect(carries(undefined, draft(2, "b"))).toBe(false);
});

test("two drafts say the same when the text and every chip do", () => {
  expect(sameDraft(draft(1, "look at @a"), draft(2, "look at @a", [], "app/2"))).toBe(true);
  expect(sameDraft(draft(1, "look at @a"), draft(2, "look at @b"))).toBe(false);
  expect(sameDraft(draft(1, "look at @a"), draft(2, "look at @a", [chip("@a")]))).toBe(false);
  // The same words, another writer: the same draft.
  expect(sameDraft(undefined, undefined)).toBe(true);
  expect(sameDraft(undefined, draft(1, ""))).toBe(false);
});

test("chips are compared as they are drawn: token, label, kind, picture", () => {
  expect(sameChips([chip("@a")], [chip("@a")])).toBe(true);
  expect(sameChips([chip("@a")], [])).toBe(false);
  expect(sameChips([chip("@a", "A")], [chip("@a", "B")])).toBe(false);
  expect(sameChips([{ token: "@a", label: "a", kind: "image", preview: "/tmp/a.png" }], [{ token: "@a", label: "a", kind: "image", preview: "/tmp/b.png" }])).toBe(false);
  expect(sameChips([chip("@a")], [{ ...chip("@a"), kind: "folder" }])).toBe(false);
  // A picture attached in the draft is part of it: one with the file's bytes is not the other's.
  const picture = (uri: string): Chip => ({ token: "@p.png", label: "p.png", kind: "image", image: { mimeType: "image/png", uri } });
  expect(sameChips([picture("/tmp/1.png")], [picture("/tmp/2.png")])).toBe(false);
  expect(sameChips([picture("/tmp/1.png")], [picture("/tmp/1.png")])).toBe(true);
});

test("what a draft holds: its text and chips, and an empty one for nothing", () => {
  expect(draftParts({ draft: "hi @a", chips: [chip("@a")] })).toEqual({ draft: "hi @a", chips: [chip("@a")] });
  expect(draftParts(null)).toEqual({ draft: "", chips: [] });
  expect(draftParts(undefined)).toEqual({ draft: "", chips: [] });
  // An option read back from JSON with no chips (an older draft) is still a draft.
  expect(draftParts({ draft: "loose" } as unknown as { draft: string; chips: Chip[] })).toEqual({ draft: "loose", chips: [] });
});
