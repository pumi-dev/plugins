// What the chat says in words: the page of entries, the slash hints, the lines for a turn, a tool
// and the context.
import { expect, test } from "bun:test";

import { emptyTranscript, type Entry, type Tool } from "../../src/conversation/model.ts";
import {
  applyHint,
  applyMention,
  baseName,
  caretAfterEdit,
  imageTypeOf,
  insertMentions,
  mentionAt,
  mentionText,
  conversationTitle,
  currentName,
  formatCount,
  formatDuration,
  headerOptions,
  imageSource,
  outputShown,
  patchOf,
  slashHints,
  toolLine,
  toolOpensByDefault,
  turnLine,
  usageLine,
  visibleEntries,
  activitySummary,
  clipLines,
  diffRows,
  diffStats,
  imagePathsIn,
  shortModel,
  timelineRows,
  tint,
  toolHeadline,
} from "../../src/conversation/view.ts";

const entries: Entry[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), kind: "agent", at: 0, text: String(i) }));

test("the newest entries show, and how many are left before them", () => {
  expect(visibleEntries(entries, 2)).toEqual({ shown: entries.slice(3), hidden: 3 });
  expect(visibleEntries(entries, 10)).toEqual({ shown: entries, hidden: 0 });
  expect(visibleEntries(entries, 0)).toEqual({ shown: [], hidden: 5 });
});

test("slash hints: while a name is typed, starts-with first, then contains", () => {
  const commands = [{ name: "review" }, { name: "compact", hint: "what to keep" }, { name: "/preview" }, { name: "clear" }];
  expect(slashHints("/", commands).map((each) => each.name)).toEqual(["review", "compact", "/preview", "clear"]);
  expect(slashHints("/c", commands).map((each) => each.name)).toEqual(["compact", "clear"]);
  expect(slashHints("/view", commands).map((each) => each.name)).toEqual(["review", "/preview"]);
  expect(slashHints("/PRE", commands).map((each) => each.name)).toEqual(["/preview"]);
  expect(slashHints("/compact now", commands)).toEqual([]);
  expect(slashHints("hello /c", commands)).toEqual([]);
  expect(slashHints("/", commands, 1).length).toBe(1);
  expect(applyHint({ name: "/preview" })).toBe("/preview ");
  expect(applyHint({ name: "review" })).toBe("/review ");
});

test("counts and durations as people read them", () => {
  expect([950, 1000, 12_340, 123_456, 1_250_000].map(formatCount)).toEqual(["950", "1k", "12.3k", "123k", "1.3M"]);
  expect([800, 12_000, 184_000, 3_720_000].map(formatDuration)).toEqual(["800ms", "12s", "3m 4s", "1h 2m"]);
});

test("a turn's line", () => {
  expect(turnLine({ stop: "end_turn", durationMs: 12_000, tokens: { total: 3400 } })).toBe("Done in 12s · 3.4k tokens");
  expect(turnLine({ stop: "cancelled" })).toBe("Stopped");
});

test("the context's line", () => {
  expect(usageLine({ contextPct: 42, tokens: 84_000, contextSize: 200_000, cost: { amount: 0.5, currency: "USD" } })).toBe("42% · 84k of 200k · 0.50 USD");
  expect(usageLine({ tokens: 900 })).toBe("900 tokens");
  expect(usageLine({})).toBe("");
});

test("a tool's line says its input only when the title does not", () => {
  const shell: Tool = { id: "1", kind: "shell", title: "Terminal", status: "running", content: [], input: { command: "ls -la" } };
  expect(toolLine(shell)).toEqual({ title: "Terminal", detail: "ls -la" });
  expect(toolLine({ ...shell, title: "`ls -la`" })).toEqual({ title: "`ls -la`" });
  expect(toolLine({ ...shell, input: undefined, locations: [{ path: "/a/b.ts" }] })).toEqual({ title: "Terminal", detail: "/a/b.ts" });
  expect(toolOpensByDefault(shell)).toBe(false);
  expect(toolOpensByDefault({ ...shell, content: [{ type: "terminal", output: "building…" }] })).toBe(true);
  expect(toolOpensByDefault({ ...shell, status: "completed", content: [{ type: "terminal", output: "built" }] })).toBe(false);
  expect(toolOpensByDefault({ ...shell, status: "failed" })).toBe(true);
  expect(toolOpensByDefault({ ...shell, content: [{ type: "diff", path: "p", new: "x" }] })).toBe(true);
});

test("a running command shows the end of its output, an ended one all of it", () => {
  const output = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\n";
  expect(outputShown(output, false)).toBe(output);
  const live = outputShown(output, true).split("\n");
  expect(live).toHaveLength(16);
  expect(live.at(-1)).toBe("line 39");
  expect(outputShown("one\ntwo\n", true)).toBe("one\ntwo");
});

test("a diff part's patch is its own, or made from its texts", () => {
  expect(patchOf({ path: "p", new: "x", unified: "PATCH" })).toBe("PATCH");
  expect(patchOf({ path: "p", old: "a\n", new: "b\n" })).toContain("-a\n+b\n");
});

test("images draw from their bytes, else their uri", () => {
  expect(imageSource({ mimeType: "image/png", data: "AA" })).toBe("data:image/png;base64,AA");
  expect(imageSource({ mimeType: "image/png", uri: "/tmp/a.png" })).toBe("/tmp/a.png");
  expect(imageSource({ mimeType: "image/png" })).toBeUndefined();
});

test("the header's options, in order, and their current names", () => {
  const t = {
    ...emptyTranscript("e"),
    session: { id: "s", agent: "Claude" },
    options: [
      { id: "x", category: "other" as const, name: "X", current: true },
      { id: "m", category: "model" as const, name: "Model", current: "b", choices: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
      { id: "empty", category: "other" as const, name: "Nothing", current: "z", choices: [] },
      { id: "mode", category: "mode" as const, name: "Mode", current: "unknown", choices: [{ id: "a", name: "A" }] },
    ],
  };
  expect(headerOptions(t).map((option) => option.id)).toEqual(["mode", "m", "x"]);
  expect(headerOptions(t).map(currentName)).toEqual(["unknown", "B", "On"]);
  expect(conversationTitle(t)).toBe("Claude");
  expect(conversationTitle({ ...t, session: { id: "s", agent: "Claude", title: "Fix it" } })).toBe("Fix it");
  expect(conversationTitle(emptyTranscript("e"))).toBe("Agent");
});

test("the caret, from an edit: the end of what was typed, or where something was deleted", () => {
  expect(caretAfterEdit("", "a")).toBe(1);
  expect(caretAfterEdit("hello", "hello!")).toBe(6);
  expect(caretAfterEdit("hello world", "hello, world")).toBe(6);
  expect(caretAfterEdit("hello world", "hello")).toBe(5);
  expect(caretAfterEdit("ab", "aXYb")).toBe(3);
  // A repeated letter: the edit is taken at the latest place it fits.
  expect(caretAfterEdit("aa", "aaa")).toBe(3);
});

test("a mention is typed at the caret, after a space or at the start", () => {
  expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  expect(mentionAt("look at @src/ma", 15)).toEqual({ start: 8, end: 15, query: "src/ma" });
  expect(mentionAt("look at @src/ma and", 15)).toEqual({ start: 8, end: 15, query: "src/ma" });
  expect(mentionAt('see @"my fi', 11)).toEqual({ start: 4, end: 11, query: "my fi" });
  expect(mentionAt("mail me@host", 12)).toBeUndefined();
  expect(mentionAt("@src done", 9)).toBeUndefined();
  expect(mentionAt("line\n@x", 7)).toEqual({ start: 5, end: 7, query: "x" });
});

test("picking a mention: the path and a space, a directory left open, quotes for spaces", () => {
  expect(mentionText("a b/c.ts")).toBe('@"a b/c.ts"');
  const draft = "look at @sr please";
  const at = mentionAt(draft, 11)!;
  expect(applyMention(draft, at, { path: "src/main.ts" })).toEqual({ draft: "look at @src/main.ts please", caret: 21 });
  expect(applyMention("@sr", mentionAt("@sr", 3)!, { path: "src", dir: true })).toEqual({ draft: "@src/", caret: 5 });
  // The rest of the word under the caret goes with what is replaced.
  expect(applyMention("@srxx end", { start: 0, end: 3, query: "sr" }, { path: "src/a.ts" }).draft).toBe("@src/a.ts end");
});

test("dropped files are mentioned where the caret is, spaced from the words around", () => {
  expect(insertMentions("", 0, ["a.ts", "b c.ts"])).toEqual({ draft: '@a.ts @"b c.ts" ', caret: 16 });
  expect(insertMentions("look", 4, ["a.ts"]).draft).toBe("look @a.ts ");
  expect(insertMentions("look  here", 5, ["a.ts"]).draft).toBe("look @a.ts here");
  expect(insertMentions("x", 1, []).draft).toBe("x");
});

test("an image, by its extension", () => {
  expect(imageTypeOf("/tmp/Shot 1.PNG")).toBe("image/png");
  expect(imageTypeOf("a.jpeg")).toBe("image/jpeg");
  expect(imageTypeOf("a.svg")).toBeUndefined();
  expect(imageTypeOf("README")).toBeUndefined();
  expect(baseName("/a/b/c.png")).toBe("c.png");
  expect(baseName("src/")).toBe("src");
});

test("a patch's rows are numbered from its hunks, its headers left off", () => {
  const patch = "--- a.ts\n+++ a.ts\n@@ -3,2 +3,3 @@ fn\n keep\n-old\n+new\n+more";
  expect(diffRows(patch)).toEqual([
    { kind: "hunk", text: "fn" },
    { kind: "context", text: "keep", old: 3, new: 3 },
    { kind: "del", text: "old", old: 4 },
    { kind: "add", text: "new", new: 4 },
    { kind: "add", text: "more", new: 5 },
  ]);
  expect(diffStats(patch)).toEqual({ added: 2, removed: 1 });
});

test("a run of calls and thoughts is one activity; the last is live while the agent works", () => {
  const at = 0;
  const tool = (id: string, kind: Tool["kind"] = "shell", title = "bash"): Entry => ({ id, kind: "tool", at, tool: { id, kind, title, status: "completed", content: [] } });
  const entries: Entry[] = [
    { id: "u", kind: "user", at, text: "go" },
    { id: "th", kind: "thought", at, text: "hm" },
    tool("t1"),
    tool("t2", "read", "read"),
    { id: "a", kind: "agent", at, text: "done" },
    tool("t3"),
    tool("q", "other", "AskUserQuestion"),
    tool("t4"),
    tool("t5", "edit", "edit"),
  ];
  const rows = timelineRows(entries, true, (t) => t.title === "AskUserQuestion");
  expect(rows.map((row) => (row.type === "entry" ? row.entry.id : `[${row.entries.map((e) => e.id).join(",")}${row.live ? " live" : ""}]`))).toEqual(["u", "[th,t1,t2]", "a", "t3", "q", "[t4,t5 live]"]);
  expect(activitySummary(entries.slice(1, 4))).toBe("Ran 1 command, read 1 file");
  expect(activitySummary([entries[1]!])).toBe("Thought");
});

test("pictures named by their path in a prompt", () => {
  expect(imagePathsIn('look at /tmp/a.png and "/Users/me/my shot.jpg", not b.png')).toEqual(["/Users/me/my shot.jpg", "/tmp/a.png"]);
  expect(imagePathsIn("/Users/me/x\\ y.webp")).toEqual(["/Users/me/x y.webp"]);
});

test("small words: a wash of a colour, a clipped text, a model's short name", () => {
  expect(tint("#a6e3a1", 0.5)).toBe("#a6e3a180");
  expect(tint("#fff", 1)).toBe("#ffffffff");
  expect(tint("#11223380", 0.5)).toBe("#11223340");
  expect(clipLines("a\nb\nc", 2)).toEqual({ text: "a\nb", more: 1 });
  expect(shortModel("kiro/claude-opus-5.5")).toBe("claude-opus-5.5");
  expect(imageSource({ mimeType: "image/png", uri: "file:///tmp/a%20b.png" })).toBe("/tmp/a b.png");
});

test("a call's headline: its verb in the tense it is in, and what it acted on", () => {
  const tool = (over: Partial<Tool>): Tool => ({ id: "t", kind: "shell", title: "bash", status: "completed", content: [], ...over });
  expect(toolHeadline(tool({ input: { command: "cargo test\nmore" } }))).toEqual({ verb: "Ran", target: "cargo test", mono: true });
  expect(toolHeadline(tool({ kind: "read", title: "read", status: "running", locations: [{ path: "src/a.ts" }] }))).toEqual({ verb: "Reading", target: "src/a.ts", mono: false });
  expect(toolHeadline(tool({ kind: "mcp", title: "blender: run", input: { query: "q" } }))).toEqual({ verb: "blender: run", target: "q", mono: false });
});
