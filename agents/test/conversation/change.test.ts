// The reducer, the merging, the bounds, the stream and its cursor: what keeps a producer and its
// views on the same transcript.
import { describe, expect, test } from "bun:test";

import {
  apply,
  applyAll,
  bound,
  ChangeError,
  clip,
  clipEntry,
  coalesce,
  CommandLedger,
  endTurnChanges,
  follow,
  noticeChange,
  Producer,
  promptChanges,
  textChange,
  type Batch,
  type Change,
  type TimerHandle,
  type Update,
} from "../../src/conversation/change.ts";
import { emptyTranscript, entryTextLength, type Entry, type Tool, type Transcript } from "../../src/conversation/model.ts";

const stamp = (() => {
  let n = 0;
  return { id: () => `s.${n++}`, now: () => 42 };
})();

function entry(id: string, kind: Entry["kind"], text?: string): Entry {
  return { id, kind, at: 0, ...(text !== undefined ? { text } : {}) };
}

function tool(id: string, patch: Partial<Tool> = {}): Entry {
  return { id, kind: "tool", at: 0, tool: { id: `call-${id}`, kind: "shell", title: "ls", status: "pending", content: [], ...patch } };
}

/** A transcript with `entries` in it. */
function withEntries(...entries: Entry[]): Transcript {
  return { ...emptyTranscript("e"), entries };
}

describe("apply", () => {
  test("push, append, replace and patch an entry; the old transcript stays as it was", () => {
    const t0 = emptyTranscript("e");
    const t1 = apply(t0, { type: "push", entry: entry("a", "agent", "Hel") });
    const t2 = apply(t1, { type: "append", id: "a", text: "lo" });
    expect(t0.entries).toEqual([]);
    expect(t1.entries[0]!.text).toBe("Hel");
    expect(t2.entries[0]!.text).toBe("Hello");
    const t3 = apply(t2, { type: "push", entry: tool("b") });
    const t4 = apply(t3, { type: "tool", id: "b", patch: { status: "completed", content: [{ type: "terminal", output: "x" }] } });
    expect(t4.entries[1]!.tool).toMatchObject({ id: "call-b", title: "ls", status: "completed", content: [{ type: "terminal", output: "x" }] });
    const t5 = apply(t4, { type: "replace", entry: entry("a", "agent", "Bye") });
    expect(t5.entries.map((each) => each.text)).toEqual(["Bye", undefined]);
    expect(t5.entries[1]).toBe(t4.entries[1]!);
  });

  test("an append that says the rest was cut marks the entry", () => {
    const t = apply(withEntries(entry("a", "agent", "x")), { type: "append", id: "a", text: "y", clipped: true });
    expect(t.entries[0]).toMatchObject({ text: "xy", clipped: true });
  });

  test("a change that does not fit throws ChangeError", () => {
    const t = withEntries(entry("a", "agent", "x"), tool("b"));
    const bad: Change[] = [
      { type: "push", entry: entry("a", "user", "again") },
      { type: "append", id: "zz", text: "x" },
      { type: "append", id: "b", text: "x" },
      { type: "replace", entry: entry("zz", "agent") },
      { type: "tool", id: "a", patch: {} },
      { type: "tool", id: "zz", patch: {} },
      { type: "truncate", before: "zz" },
      { type: "permissionResolved", id: "nope" },
    ];
    for (const change of bad) expect(() => apply(t, change)).toThrow(ChangeError);
    const asked = apply(t, { type: "permissionAsked", permission: { id: "p", title: "?", options: [] } });
    expect(() => apply(asked, { type: "permissionAsked", permission: { id: "p", title: "?", options: [] } })).toThrow(ChangeError);
  });

  test("truncate drops the entries before one, and says so", () => {
    const t = withEntries(entry("a", "user", "1"), entry("b", "agent", "2"), entry("c", "user", "3"));
    const cut = apply(t, { type: "truncate", before: "c" });
    expect(cut.entries.map((each) => each.id)).toEqual(["c"]);
    expect(cut.truncated).toBe(true);
    expect(apply(t, { type: "truncate", before: "a" })).toBe(t);
  });

  test("a request blocks the agent; the last one answered lets it work again", () => {
    let t: Transcript = { ...emptyTranscript("e"), status: "working" };
    t = apply(t, { type: "permissionAsked", permission: { id: "1", title: "Run?", options: [{ id: "y", label: "Yes", kind: "allow_once" }] } });
    t = apply(t, { type: "permissionAsked", permission: { id: "2", title: "Edit?", options: [] } });
    expect(t.status).toBe("blocked");
    t = apply(t, { type: "permissionResolved", id: "1" });
    expect(t.status).toBe("blocked");
    t = apply(t, { type: "permissionResolved", id: "2" });
    expect(t.status).toBe("working");
    expect(t.permissions).toEqual([]);
    // Resolved after the turn ended: the status it ended with stays.
    t = apply(apply({ ...t, status: "working" }, { type: "permissionAsked", permission: { id: "3", title: "?", options: [] } }), { type: "status", status: "done" });
    expect(apply(t, { type: "permissionResolved", id: "3" }).status).toBe("done");
  });

  test("the whole-value changes replace their field", () => {
    const changes: Change[] = [
      { type: "status", status: "working" },
      { type: "plan", plan: [{ content: "a", status: "pending" }] },
      { type: "options", options: [{ id: "m", category: "model", name: "Model", current: "x", choices: [{ id: "x", name: "X" }] }] },
      { type: "commands", commands: [{ name: "review" }] },
      { type: "usage", usage: { contextPct: 5 } },
      { type: "session", session: { id: "s", cwd: "/w" } },
      { type: "queue", queue: [{ id: "q", text: "next" }] },
    ];
    const t = applyAll(emptyTranscript("e"), changes);
    expect(t).toMatchObject({ status: "working", plan: [{ content: "a" }], options: [{ id: "m" }], commands: [{ name: "review" }], usage: { contextPct: 5 }, session: { id: "s" }, queue: [{ id: "q" }] });
    expect(apply(t, { type: "session" }).session).toBeUndefined();
  });

  test("a transcript survives JSON as it is", () => {
    const t = applyAll(emptyTranscript("e"), [{ type: "push", entry: tool("a", { input: { command: "ls" }, content: [{ type: "diff", path: "p", new: "x" }] }) }, { type: "status", status: "working" }]);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
});

describe("coalesce", () => {
  test("joins appends, folds them into the push before, merges patches, keeps the last whole value", () => {
    const changes: Change[] = [
      { type: "push", entry: entry("a", "agent", "") },
      { type: "append", id: "a", text: "x" },
      { type: "append", id: "a", text: "y" },
      { type: "push", entry: entry("b", "thought", "t") },
      { type: "append", id: "b", text: "1", clipped: true },
      { type: "append", id: "a", text: "z" },
      { type: "append", id: "a", text: "w" },
      { type: "tool", id: "c", patch: { status: "running" } },
      { type: "tool", id: "c", patch: { title: "T" } },
      { type: "status", status: "working" },
      { type: "status", status: "blocked" },
    ];
    expect(coalesce(changes)).toEqual([
      { type: "push", entry: entry("a", "agent", "xy") },
      { type: "push", entry: { ...entry("b", "thought", "t1"), clipped: true } },
      { type: "append", id: "a", text: "zw" },
      { type: "tool", id: "c", patch: { status: "running", title: "T" } },
      { type: "status", status: "blocked" },
    ]);
  });

  test("applying the coalesced changes gives the same transcript, whatever the changes", () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      let t = withEntries(entry("a", "agent", ""), tool("t"));
      const changes: Change[] = [];
      for (let i = 0; i < 30; i++) {
        const ids = t.entries.map((each) => each.id);
        const pick = random(7);
        let change: Change;
        if (pick === 0) change = { type: "push", entry: random(2) ? entry(`n${round}.${i}`, "agent", "p") : tool(`n${round}.${i}`) };
        else if (pick === 1) change = { type: "tool", id: t.entries.find((each) => each.tool)!.id, patch: random(2) ? { status: "running" } : { title: `t${i}` } };
        else if (pick === 2) change = { type: "status", status: random(2) ? "working" : "idle" };
        else if (pick === 3) change = { type: "replace", entry: entry("a", "agent", `r${i}`) };
        else {
          const texts = t.entries.filter((each) => each.kind === "agent");
          change = { type: "append", id: texts[random(texts.length)]!.id, text: String(i) };
        }
        expect(ids.length).toBeGreaterThan(0);
        t = apply(t, change);
        changes.push(change);
      }
      const start = withEntries(entry("a", "agent", ""), tool("t"));
      expect(applyAll(start, coalesce(changes))).toEqual(t);
    }
  });
});

describe("bounds", () => {
  const bounds = { entries: 10, text: 100, entryText: 10 };

  test("an append past an entry's limit is cut and marks it; after that, appends are dropped", () => {
    const t = withEntries(entry("a", "agent", "12345678"));
    expect(clip(t, { type: "append", id: "a", text: "ab" }, bounds)).toEqual({ type: "append", id: "a", text: "ab" });
    expect(clip(t, { type: "append", id: "a", text: "abcd" }, bounds)).toEqual({ type: "append", id: "a", text: "ab", clipped: true });
    const clipped = withEntries({ ...entry("a", "agent", "1234567890"), clipped: true });
    expect(clip(clipped, { type: "append", id: "a", text: "more" }, bounds)).toBeUndefined();
  });

  test("a pushed entry is cut: text first, a terminal keeps its tail, a big diff is said in words", () => {
    const big = tool("t", { content: [{ type: "text", text: "abcdef" }, { type: "terminal", output: "0123456789" }] });
    const cut = clip(withEntries(), { type: "push", entry: big }, bounds) as { entry: Entry };
    expect(cut.entry.clipped).toBe(true);
    expect(cut.entry.tool!.content).toEqual([{ type: "text", text: "abcdef" }, { type: "terminal", output: "6789" }]);
    expect(entryTextLength(cut.entry)).toBe(10);
    const diff = clipEntry(tool("d", { content: [{ type: "diff", path: "f", new: "x".repeat(50) }] }), 40);
    expect(diff.tool!.content[0]).toEqual({ type: "text", text: "The change to f is too large to show." });
  });

  test("a tool patch that would overflow becomes a replace of the cut entry", () => {
    const t = withEntries(tool("t"));
    const change = clip(t, { type: "tool", id: "t", patch: { status: "completed", content: [{ type: "terminal", output: "x".repeat(30) }] } }, bounds)!;
    expect(change.type).toBe("replace");
    expect((change as { entry: Entry }).entry.tool).toMatchObject({ status: "completed", content: [{ type: "terminal", output: "x".repeat(10) }] });
    expect(clip(t, { type: "tool", id: "t", patch: { status: "running" } }, bounds)).toEqual({ type: "tool", id: "t", patch: { status: "running" } });
  });

  test("a transcript over its bounds is truncated to 80% of them, the newest entry kept", () => {
    const many = withEntries(...Array.from({ length: 12 }, (_, i) => entry(`e${i}`, "agent", "x")));
    expect(bound(many, bounds)).toEqual({ type: "truncate", before: "e4" });
    const heavy = withEntries(...Array.from({ length: 5 }, (_, i) => entry(`e${i}`, "agent", "x".repeat(30))));
    expect(bound(heavy, bounds)).toEqual({ type: "truncate", before: "e3" });
    const one = withEntries(entry("only", "agent", "x".repeat(500)));
    expect(bound(one, bounds)).toBeUndefined();
    expect(bound(withEntries(entry("a", "agent", "x")), bounds)).toBeUndefined();
  });
});

/** A producer on a hand-turned clock, and what it published. */
function rig(options: { keep?: number; bounds?: { entries: number; text: number; entryText: number } } = {}) {
  let now = 0;
  const timers: { fn: () => void; at: number; handle: number }[] = [];
  let handles = 0;
  const published: Update[] = [];
  const producer = new Producer({
    transcript: emptyTranscript("epoch-1"),
    publish: (update) => published.push(update),
    now: () => now,
    keep: options.keep,
    bounds: options.bounds,
    timers: {
      set: (fn, ms) => {
        timers.push({ fn, at: now + ms, handle: ++handles });
        return handles;
      },
      clear: (handle: TimerHandle) => {
        const at = timers.findIndex((each) => each.handle === handle);
        if (at >= 0) timers.splice(at, 1);
      },
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const due of timers.filter((each) => each.at <= now)) {
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  return { producer, published, advance, pending: () => timers.length };
}

describe("Producer", () => {
  test("changes apply at once and go out together, at most one batch per interval", () => {
    const { producer, published, advance } = rig();
    producer.push({ type: "push", entry: entry("a", "agent", "") });
    for (const piece of ["a", "b", "c"]) producer.push({ type: "append", id: "a", text: piece });
    expect(producer.transcript.entries[0]!.text).toBe("abc");
    expect(published).toEqual([]);
    advance(60);
    expect(published).toEqual([{ type: "changes", from: { epoch: "epoch-1", seq: 0 }, to: { epoch: "epoch-1", seq: 1 }, changes: [{ type: "push", entry: entry("a", "agent", "abc") }] }]);
    expect(producer.transcript.seq).toBe(1);
    // Right after a batch, the next waits out the interval.
    advance(10);
    producer.push({ type: "append", id: "a", text: "d" });
    advance(49);
    expect(published.length).toBe(1);
    advance(1);
    expect(published.length).toBe(2);
    expect((published[1] as Batch).changes).toEqual([{ type: "append", id: "a", text: "d" }]);
  });

  test("a view following the batches has the producer's transcript", () => {
    const { producer, published, advance } = rig();
    let view: Transcript | undefined = emptyTranscript("epoch-1");
    producer.push(...promptChanges("hi", [], producer));
    advance(60);
    producer.push(textChange(producer.transcript, "agent", "Hel", producer));
    producer.push(textChange(producer.transcript, "agent", "lo", producer));
    advance(60);
    producer.push(...endTurnChanges(producer.transcript, { stop: "end_turn", durationMs: 5 }, producer));
    producer.flush();
    for (const update of published) view = follow(view, update);
    expect(view).toEqual(producer.transcript);
    expect(view!.entries.map((each) => [each.kind, each.text])).toEqual([
      ["user", "hi"],
      ["agent", "Hello"],
      ["turn", undefined],
    ]);
  });

  test("read answers the batches a view missed, merged, or a snapshot when it cannot", () => {
    const { producer } = rig({ keep: 2 });
    producer.push({ type: "push", entry: entry("a", "agent", "1") });
    producer.flush();
    const one = { epoch: "epoch-1", seq: 1 };
    producer.push({ type: "append", id: "a", text: "2" });
    producer.flush();
    producer.push({ type: "append", id: "a", text: "3" });
    // read flushes what is pending first.
    expect(producer.read(one)).toEqual({ type: "changes", from: one, to: { epoch: "epoch-1", seq: 3 }, changes: [{ type: "append", id: "a", text: "23" }] });
    expect(producer.read({ epoch: "epoch-1", seq: 3 })).toEqual({ type: "changes", from: { epoch: "epoch-1", seq: 3 }, to: { epoch: "epoch-1", seq: 3 }, changes: [] });
    // Older than the log keeps, another epoch, ahead of it, or none: a snapshot.
    expect(producer.read({ epoch: "epoch-1", seq: 0 }).type).toBe("snapshot");
    expect(producer.read({ epoch: "other", seq: 3 }).type).toBe("snapshot");
    expect(producer.read({ epoch: "epoch-1", seq: 9 }).type).toBe("snapshot");
    const snapshot = producer.read();
    expect(snapshot).toEqual({ type: "snapshot", transcript: producer.transcript });
  });

  test("a snapshot includes what was pending, published first, so no change is applied twice", () => {
    const { producer, published } = rig();
    producer.push({ type: "push", entry: entry("a", "agent", "x") });
    const snapshot = producer.snapshot();
    expect(snapshot.transcript.seq).toBe(1);
    // The batch that went out before it is one the snapshot already has.
    expect(follow(snapshot.transcript, published[0]!)).toBe(snapshot.transcript);
  });

  test("the bounds hold: an entry is cut as it grows and old entries go at the next batch", () => {
    const { producer, published } = rig({ bounds: { entries: 5, text: 1000, entryText: 8 } });
    for (let i = 0; i < 7; i++) producer.push({ type: "push", entry: entry(`e${i}`, "agent", "") });
    producer.push({ type: "append", id: "e6", text: "0123456789" });
    producer.push({ type: "append", id: "e6", text: "more" });
    producer.flush();
    const t = producer.transcript;
    expect(t.entries.map((each) => each.id)).toEqual(["e3", "e4", "e5", "e6"]);
    expect(t.entries[3]).toMatchObject({ text: "01234567", clipped: true });
    expect(t.truncated).toBe(true);
    expect(follow(emptyTranscript("epoch-1"), published[0]!)).toEqual(t);
  });

  test("ids are unique, and go on past the ones a transcript it continues already has", () => {
    const first = new Producer({ transcript: emptyTranscript("abcdefgh-1234"), publish: () => {}, timers: { set: () => 0, clear: () => {} } });
    expect([first.id(), first.id()]).toEqual(["abcdefgh.0", "abcdefgh.1"]);
    const again = new Producer({ transcript: { ...emptyTranscript("abcdefgh-1234"), entries: [entry("abcdefgh.7", "agent", "x")] }, publish: () => {} });
    expect(again.id()).toBe("abcdefgh.8");
  });

  test("reset starts a new epoch a following view takes as a snapshot", () => {
    const { producer, published } = rig();
    producer.push({ type: "push", entry: entry("a", "agent", "x") });
    producer.flush();
    let view = follow(emptyTranscript("epoch-1"), published[0]!);
    const snapshot = producer.reset({ ...emptyTranscript("epoch-2"), status: "working" });
    expect(published[published.length - 1]).toEqual(snapshot);
    view = follow(view, snapshot);
    expect(view).toEqual(producer.transcript);
    expect(producer.read({ epoch: "epoch-1", seq: 1 }).type).toBe("snapshot");
  });

  test("dispose stops the timer", () => {
    const { producer, published, advance, pending } = rig();
    producer.push({ type: "status", status: "working" });
    expect(pending()).toBe(1);
    producer.dispose();
    expect(pending()).toBe(0);
    advance(100);
    expect(published).toEqual([]);
  });
});

describe("follow", () => {
  const base = { ...emptyTranscript("e"), seq: 2, entries: [entry("a", "agent", "x")] };
  const batch = (from: number, changes: Change[]): Batch => ({ type: "changes", from: { epoch: "e", seq: from }, to: { epoch: "e", seq: from + 1 }, changes });

  test("applies the next batch and moves to its cursor", () => {
    const next = follow(base, batch(2, [{ type: "append", id: "a", text: "y" }]))!;
    expect(next.seq).toBe(3);
    expect(next.entries[0]!.text).toBe("xy");
  });

  test("a batch it has already is a no-op; one past a gap, of another epoch, or that does not fit asks for a snapshot", () => {
    expect(follow(base, batch(1, [{ type: "append", id: "a", text: "y" }]))).toBe(base);
    expect(follow(base, batch(3, []))).toBeUndefined();
    expect(follow(base, { ...batch(2, []), to: { epoch: "f", seq: 3 } })).toBeUndefined();
    expect(follow(base, batch(2, [{ type: "append", id: "zz", text: "y" }]))).toBeUndefined();
    expect(follow(undefined, batch(0, []))).toBeUndefined();
  });

  test("a snapshot replaces what it had, unless it is older in the same epoch", () => {
    const fresh = { ...emptyTranscript("e"), seq: 5 };
    expect(follow(base, { type: "snapshot", transcript: fresh })).toBe(fresh);
    const stale = { ...emptyTranscript("e"), seq: 1 };
    expect(follow(base, { type: "snapshot", transcript: stale })).toBe(base);
    const other = { ...emptyTranscript("f"), seq: 0 };
    expect(follow(base, { type: "snapshot", transcript: other })).toBe(other);
    expect(follow(undefined, { type: "snapshot", transcript: stale })).toBe(stale);
  });
});

describe("what every producer says", () => {
  test("a prompt is its entry, one per image, and the turn starting", () => {
    expect(promptChanges("look", [{ mimeType: "image/png", data: "AA" }], stamp)).toEqual([
      { type: "push", entry: { id: "s.0", kind: "user", at: 42, text: "look" } },
      { type: "push", entry: { id: "s.1", kind: "image", at: 42, image: { mimeType: "image/png", data: "AA" }, from: "user" } },
      { type: "status", status: "working" },
    ]);
  });

  test("a failed turn cancels the open calls and withdraws the requests", () => {
    const t: Transcript = {
      ...withEntries(tool("r", { status: "running" }), tool("d", { status: "completed" })),
      permissions: [{ id: "p", title: "?", options: [] }],
    };
    const changes = endTurnChanges(t, { stop: "error" }, stamp);
    expect(changes.filter((change) => change.type !== "push")).toEqual([
      { type: "tool", id: "r", patch: { status: "canceled" } },
      { type: "permissionResolved", id: "p" },
      { type: "status", status: "error" },
    ]);
    expect(applyAll(t, changes).status).toBe("error");
  });

  test("text appends to the newest entry of its kind, else starts one", () => {
    const t = withEntries(entry("a", "agent", "x"));
    expect(textChange(t, "agent", "y", stamp)).toEqual({ type: "append", id: "a", text: "y" });
    expect(textChange(t, "thought", "z", stamp)).toMatchObject({ type: "push", entry: { kind: "thought", text: "z" } });
    expect(noticeChange("Reconnected", "warning", stamp)).toMatchObject({ type: "push", entry: { kind: "notice", level: "warning", text: "Reconnected" } });
  });

  test("the ledger acts on a command once", () => {
    const ledger = new CommandLedger(2);
    expect(ledger.first("a")).toBe(true);
    expect(ledger.first("a")).toBe(false);
    ledger.first("b");
    ledger.first("c");
    // The oldest is forgotten past what it keeps.
    expect(ledger.first("a")).toBe(true);
  });
});
