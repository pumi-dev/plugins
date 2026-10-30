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
  spaceTokens,
  tokenSpans,
  withoutTokens,
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
  entriesFrom,
  activitySummary,
  clipLines,
  diffRows,
  diffStats,
  imagePathsIn,
  applySlash,
  messageParts,
  tabToken,
  skillHints,
  skillToken,
  slashAt,
  shortModel,
  timelineRows,
  tint,
  toolHeadline,
  contextTooltip,
  modelMaker,
  restorable,
  ringArc,
  thinkingOf,
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
  expect(toolOpensByDefault({ ...shell, content: [{ type: "terminal", output: "building…" }] })).toBe(false);
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

test("a chip's mention stands whole between spaces, as the textarea draws it", () => {
  expect(tokenSpans("see @a.ts and @a.ts", ["@a.ts"])).toEqual([
    { token: "@a.ts", start: 4, end: 9 },
    { token: "@a.ts", start: 14, end: 19 },
  ]);
  // Text typed against a mention leaves it a mention, as the field draws it.
  expect(tokenSpans("x@a.ts @a.tsx", ["@a.ts"])).toEqual([
    { token: "@a.ts", start: 1, end: 6 },
    { token: "@a.ts", start: 7, end: 12 },
  ]);
  expect(tokenSpans('@"a b.png" c', ['@"a b.png"', "@a"])).toEqual([{ token: '@"a b.png"', start: 0, end: 10 }]);
});

test("a picture's mention is left out of the text it is sent with", () => {
  const shot = '@"Desktop/Shot 1.png"';
  expect(withoutTokens(`like this ${shot} inline`, [shot])).toBe("like this inline");
  expect(withoutTokens(`${shot} first`, [shot])).toBe("first");
  expect(withoutTokens(`last ${shot}`, [shot])).toBe("last");
  expect(withoutTokens(spaceTokens(`keep ${shot}x`, [shot]), [shot])).toBe("keep x");
});

test("text typed against a mention is sent apart from it", () => {
  expect(spaceTokens("see@a.tsnow", ["@a.ts"])).toBe("see @a.ts now");
  expect(spaceTokens("@a.ts @b.ts", ["@a.ts", "@b.ts"])).toBe("@a.ts @b.ts");
  expect(spaceTokens("@a.ts@b.ts", ["@a.ts", "@b.ts"])).toBe("@a.ts @b.ts");
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

test("a message's chips: mentions, pictures by their path, and skills, in their places", () => {
  expect(messageParts('see @src/a.ts, @"my dir/" and /tmp/shot.png then /skill:deploy now', "/w")).toEqual([
    { type: "text", text: "see " },
    { type: "chip", kind: "file", text: "@src/a.ts", label: "a.ts", path: "/w/src/a.ts" },
    { type: "text", text: ", " },
    { type: "chip", kind: "folder", text: '@"my dir/"', label: "my dir/", path: "/w/my dir/" },
    { type: "text", text: " and " },
    { type: "chip", kind: "image", text: "/tmp/shot.png", label: "shot.png", path: "/tmp/shot.png" },
    { type: "text", text: " then " },
    { type: "chip", kind: "skill", text: "/skill:deploy", label: "deploy" },
    { type: "text", text: " now" },
  ]);
  expect(messageParts("mail me@example.com about /usr/bin")).toEqual([{ type: "text", text: "mail me@example.com about /usr/bin" }]);
  expect(messageParts("@shots/a.png")).toEqual([{ type: "chip", kind: "image", text: "@shots/a.png", label: "a.png", path: "shots/a.png" }]);
});

test("a skill picked after a `/` anywhere in the draft", () => {
  expect(slashAt("fix it with /dep", 16)).toEqual({ start: 12, end: 16, query: "dep" });
  expect(slashAt("/dep", 4)).toEqual({ start: 0, end: 4, query: "dep" });
  expect(slashAt("see src/dep", 11)).toBeUndefined();
  const commands = [{ name: "review" }, { name: "skill:deploy", skill: "/s/deploy/SKILL.md" }, { name: "skill:redeploy-all", skill: "/s/r/SKILL.md" }];
  expect(skillHints("dep", commands).map((c) => c.name)).toEqual(["skill:deploy", "skill:redeploy-all"]);
  expect(skillHints("skill:re", commands).map((c) => c.name)).toEqual(["skill:redeploy-all"]);
  expect(skillToken({ name: "deploy" })).toBe("/skill:deploy");
  expect(skillToken({ name: "/skill:deploy" })).toBe("/skill:deploy");
  expect(applySlash("fix /dep now", { start: 4, end: 8, query: "dep" }, "/skill:deploy")).toEqual({ draft: "fix /skill:deploy now", caret: 18 });
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

test("Zed's bar: the thinking toggle and its levels, the ring, its tooltip, a model's maker", () => {
  const option = { id: "t", category: "thought_level" as const, name: "Thinking", current: "high", off: "off", default: "medium", choices: [{ id: "off", name: "Off" }, { id: "low", name: "Low" }, { id: "high", name: "High" }] };
  expect(thinkingOf(option)).toEqual({ toggles: true, on: true, level: "high", levels: option.choices.slice(1), fallback: "medium" });
  expect(thinkingOf({ ...option, current: "off" }).on).toBe(false);
  expect(thinkingOf({ ...option, off: undefined }).toggles).toBe(false);
  expect(ringArc(0)).toBeUndefined();
  expect(ringArc(1)).toContain("<circle");
  expect(ringArc(0.25)).toContain('A6 6 0 0 1 14.000 8.000');
  expect(ringArc(0.75)).toContain("A6 6 0 1 1 2.000 8.000");
  expect(contextTooltip({ contextPct: 42, tokens: 84_000, contextSize: 200_000 })).toBe("Context: 42% • 84k/200k");
  expect(modelMaker("anthropic/claude-sonnet-5")).toBe("anthropic");
  expect(modelMaker("claude-opus-5")).toBe("claude");
  expect(modelMaker("gpt-5.5")).toBe("openai");
  expect(modelMaker("~deepseek/deepseek-flash-latest")).toBe("deepseek");
  expect(modelMaker("default", "Claude Code")).toBe("claude");
});

test("a checkpoint is offered once something after its message changed a file", () => {
  const tool = (kind: Tool["kind"]): Entry => ({ id: kind, kind: "tool", at: 0, tool: { id: kind, kind, title: kind, status: "completed", content: [] } });
  const user: Entry = { id: "u", kind: "user", at: 0, text: "hi", checkpoint: true };
  expect(restorable([user, tool("read")], 0)).toBe(false);
  expect(restorable([user, tool("read"), tool("edit")], 0)).toBe(true);
  expect(restorable([{ ...user, checkpoint: undefined }, tool("edit")], 0)).toBe(false);
});

test("a tab named in a message is a chip of it", () => {
  expect(messageParts("look at @tab:%12, then fix it")).toEqual([
    { type: "text", text: "look at " },
    { type: "chip", kind: "tab", text: "@tab:%12", label: "%12", tab: "%12" },
    { type: "text", text: ", then fix it" },
  ]);
  expect(applyMention("see @bu", { start: 4, end: 7, query: "bu" }, { path: tabToken("%3"), tab: { id: "%3", title: "Build" } })).toEqual({ draft: "see @tab:%3 ", caret: 12 });
});

test("a timeline keeps its first row as entries come at its foot", () => {
  const entries = ["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "agent" as const, at: 0, text: id }));
  expect(entriesFrom(entries, undefined, 2)).toEqual({ shown: entries.slice(3), hidden: 3 });
  expect(entriesFrom(entries, "b", 2)).toEqual({ shown: entries.slice(1), hidden: 1 });
  // Gone (a rewind): the last page again.
  expect(entriesFrom(entries, "x", 2)).toEqual({ shown: entries.slice(3), hidden: 3 });
});
