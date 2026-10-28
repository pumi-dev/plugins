// Markdown as the chat reads it: the blocks of a message and the runs of a line.
import { expect, test } from "bun:test";

import { hasMarks, parseBlocks, parseInline, words } from "../../src/conversation/markdown.ts";

test("paragraphs keep their line breaks; a blank line parts them", () => {
  expect(parseBlocks("one\ntwo\n\nthree")).toEqual([
    { type: "paragraph", text: "one\ntwo" },
    { type: "paragraph", text: "three" },
  ]);
});

test("headings, rules and quotes", () => {
  expect(parseBlocks("## Changes ##\n---\n> said\n> more")).toEqual([
    { type: "heading", level: 2, text: "Changes" },
    { type: "rule" },
    { type: "quote", text: "said\nmore" },
  ]);
});

test("a fenced block keeps its text as it is; one not closed yet runs to the end", () => {
  expect(parseBlocks("```ts\nconst a = 1;\n\n**not bold**\n```\nafter")).toEqual([
    { type: "code", lang: "ts", text: "const a = 1;\n\n**not bold**" },
    { type: "paragraph", text: "after" },
  ]);
  expect(parseBlocks("~~~\nstreaming")).toEqual([{ type: "code", lang: "", text: "streaming", open: true }]);
});

test("lists: bullets, numbers, nesting, tasks and a line that goes on the item", () => {
  expect(parseBlocks("- a\n  - b\n- [x] done\n- [ ] todo\n  more of it")).toEqual([
    {
      type: "list",
      ordered: false,
      items: [
        { depth: 0, marker: "•", text: "a" },
        { depth: 1, marker: "•", text: "b" },
        { depth: 0, marker: "•", task: true, text: "done" },
        { depth: 0, marker: "•", task: false, text: "todo\nmore of it" },
      ],
    },
  ]);
  const ordered = parseBlocks("1. one\n2. two\n\n3. three");
  expect(ordered).toEqual([{ type: "list", ordered: true, items: [{ depth: 0, marker: "1.", text: "one" }, { depth: 0, marker: "2.", text: "two" }, { depth: 0, marker: "3.", text: "three" }] }]);
});

test("a number in a paragraph's line does not start a list", () => {
  expect(parseBlocks("It took\n2. tries")).toEqual([{ type: "paragraph", text: "It took\n2. tries" }]);
});

test("tables: the header, the alignment and the rows, an escaped pipe kept", () => {
  expect(parseBlocks("| a | b |\n|:--|--:|\n| 1 | x \\| y |\n| 2 |")).toEqual([
    { type: "table", header: ["a", "b"], align: ["left", "right"], rows: [["1", "x | y"], ["2", ""]] },
  ]);
});

test("inline marks: bold, italic, code, struck, links, bare URLs", () => {
  expect(parseInline("a **b** *c* `d*e` ~~f~~ [g](http://x.y) see https://z.io/p.")).toEqual([
    { text: "a " },
    { text: "b", bold: true },
    { text: " " },
    { text: "c", italic: true },
    { text: " " },
    { text: "d*e", code: true },
    { text: " " },
    { text: "f", strike: true },
    { text: " " },
    { text: "g", href: "http://x.y" },
    { text: " see " },
    { text: "https://z.io/p", href: "https://z.io/p" },
    { text: "." },
  ]);
});

test("marks nest, and snake_case and a lone star stay text", () => {
  expect(parseInline("**`pkg.json`: added**")).toEqual([
    { text: "pkg.json", bold: true, code: true },
    { text: ": added", bold: true },
  ]);
  expect(parseInline("a snake_case_name and 2 * 3 * 4")).toEqual([{ text: "a snake_case_name and 2 * 3 * 4" }]);
  expect(parseInline("_it_ and \\*no\\*")).toEqual([{ text: "it", italic: true }, { text: " and *no*" }]);
});

test("an unclosed mark is its own text", () => {
  expect(parseInline("**streaming")).toEqual([{ text: "**streaming" }]);
  expect(parseInline("`open")).toEqual([{ text: "`open" }]);
});

test("words keep the space after them, and a line break is its own", () => {
  expect(words("one two\nthree")).toEqual(["one ", "two", "\n", "three"]);
  expect(hasMarks("plain words, nothing more.")).toBe(false);
  expect(hasMarks("a `code`")).toBe(true);
});
