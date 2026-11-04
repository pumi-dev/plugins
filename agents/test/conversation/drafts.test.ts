// The drafts every window of a chat reads: a write goes out once for all the keystrokes that
// settled, each with its own number.
import { expect, test } from "bun:test";

import type { SharedDraft } from "../../src/conversation/draft.ts";
import { Drafts } from "../../src/conversation/drafts.ts";

/** The timer a test runs by hand: `run` is what the interval would have done. */
function clock() {
  let waiting: (() => void) | undefined;
  let cleared = 0;
  return {
    timers: {
      set(fn: () => void) {
        waiting = fn;
        return 1;
      },
      clear() {
        cleared++;
        waiting = undefined;
      },
    },
    get pending() {
      return waiting !== undefined;
    },
    get cleared() {
      return cleared;
    },
    run() {
      const fn = waiting;
      waiting = undefined;
      fn?.();
    },
  };
}

function herd() {
  const sent: { tab: number; draft: SharedDraft }[] = [];
  const c = clock();
  const drafts = new Drafts({ publish: (tab, draft) => sent.push({ tab, draft }), timers: c.timers, now: () => 1_700_000_000_000 });
  return { drafts, sent, clock: c };
}

test("the keystrokes that settle go out as one, the last of them", () => {
  const { drafts, sent, clock } = herd();
  drafts.set(7, "app/1", { draft: "h", chips: [] });
  drafts.set(7, "app/1", { draft: "he", chips: [] });
  drafts.set(7, "app/1", { draft: "hel", chips: [] });
  expect(sent).toEqual([]);
  expect(clock.pending).toBe(true);
  clock.run();
  expect(sent.length).toBe(1);
  expect(sent[0]!.tab).toBe(7);
  expect(sent[0]!.draft.draft).toBe("hel");
  expect(sent[0]!.draft.by).toBe("app/1");
});

test("each write has its own number, across tabs, and a tab sends once a settle", () => {
  const { drafts, sent, clock } = herd();
  const first = drafts.set(7, "app/1", { draft: "a", chips: [] });
  const second = drafts.set(8, "app/2", null);
  expect(second.seq).toBe(first.seq + 1);
  expect(second.draft).toBe("");
  expect(drafts.get(7)!.draft).toBe("a");
  // Two tabs written before they settle go out as one message each, the tabs in the order written.
  clock.run();
  expect(sent.map((each) => each.tab)).toEqual([7, 8]);
  expect(sent[1]!.draft.draft).toBe("");
});

test("a draft written again after it settled goes out again", () => {
  const { drafts, sent, clock } = herd();
  drafts.set(7, "app/1", { draft: "a", chips: [] });
  clock.run();
  drafts.set(7, "app/1", { draft: "ab", chips: [{ token: "@a", label: "a", kind: "file" }] });
  clock.run();
  expect(sent.length).toBe(2);
  expect(sent[1]!.draft.draft).toBe("ab");
  expect(sent[1]!.draft.chips.length).toBe(1);
});

test("a tab that closes takes its draft with it", () => {
  const { drafts, sent, clock } = herd();
  drafts.set(7, "app/1", { draft: "a", chips: [] });
  drafts.forget(7);
  clock.run();
  expect(drafts.get(7)).toBeUndefined();
  expect(sent).toEqual([]);
});

test("a flush sends at once, and stops the timer it would have waited on", () => {
  const { drafts, sent, clock } = herd();
  drafts.set(7, "app/1", { draft: "now", chips: [] });
  drafts.flush();
  expect(sent.length).toBe(1);
  expect(clock.pending).toBe(false);
  // Nothing waiting: a second flush sends nothing.
  drafts.flush();
  expect(sent.length).toBe(1);
  // A disposed one keeps what is waiting for a flush (`drafts.ts` when the worker stops).
  drafts.set(7, "app/1", { draft: "later", chips: [] });
  drafts.dispose();
  expect(clock.pending).toBe(false);
  drafts.flush();
  expect(sent.length).toBe(2);
});
