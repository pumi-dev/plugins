// The chat's keys: what a keystroke does, and the prompts Up brings back.
import { expect, test } from "bun:test";

import { answerHint, chatKey, keystrokeOf, recallTakes, sentPrompts, stepRecall, type Keystroke } from "../src/conversation/keys.ts";
import type { Entry } from "../src/conversation/model.ts";

const k = (key: string, more: Partial<Keystroke> = {}): Keystroke => ({ key, ctrl: false, alt: false, shift: false, cmd: false, held: false, ...more });
const working = { working: true, answers: 0 };
const idle = { working: false, answers: 0 };

test("a KeyEvent as a keystroke", () => {
  expect(keystrokeOf({ key: "Escape", modifiers: { ctrl: false, alt: false, shift: true, cmd: false }, isHeld: true })).toEqual(k("escape", { shift: true, held: true }));
  expect(keystrokeOf({ key: "a", keyChar: "a" })).toEqual(k("a", { keyChar: "a" }));
  expect(keystrokeOf(undefined)).toEqual(k(""));
});

test("Esc stops the agent while it works, and does nothing while it does not", () => {
  expect(chatKey(k("escape"), working)).toEqual({ type: "stop" });
  expect(chatKey(k("escape"), idle)).toBeUndefined();
  // Shift+Escape is the window's (zoom), ⌘Esc and the rest are not the chat's.
  expect(chatKey(k("escape", { shift: true }), working)).toBeUndefined();
  expect(chatKey(k("escape", { cmd: true }), working)).toBeUndefined();
});

test("⌃1 … ⌃9 answer with the request's answers it has", () => {
  const asked = { working: true, answers: 3 };
  expect(chatKey(k("1", { ctrl: true }), asked)).toEqual({ type: "answer", index: 0 });
  expect(chatKey(k("3", { ctrl: true }), asked)).toEqual({ type: "answer", index: 2 });
  expect(chatKey(k("4", { ctrl: true }), asked)).toBeUndefined();
  expect(chatKey(k("0", { ctrl: true }), asked)).toBeUndefined();
  expect(chatKey(k("1", { ctrl: true }), working)).toBeUndefined();
  // ⌘1 switches views, ⌃⇧1 is not it.
  expect(chatKey(k("1", { cmd: true }), asked)).toBeUndefined();
  expect(chatKey(k("1", { ctrl: true, shift: true }), asked)).toBeUndefined();
  expect(answerHint(0)).toBe("⌃1");
  expect(answerHint(9)).toBeUndefined();
});

test("text typed outside a field goes to the prompt; chords and named keys do not", () => {
  expect(chatKey(k("a", { keyChar: "a" }), idle)).toEqual({ type: "type", text: "a" });
  expect(chatKey(k("a", { keyChar: "A", shift: true }), idle)).toEqual({ type: "type", text: "A" });
  expect(chatKey(k("space", { keyChar: " " }), idle)).toEqual({ type: "type", text: " " });
  // Option types a character on a Mac.
  expect(chatKey(k("s", { keyChar: "ß", alt: true }), idle)).toEqual({ type: "type", text: "ß" });
  expect(chatKey(k("c", { keyChar: "c", cmd: true }), idle)).toBeUndefined();
  expect(chatKey(k("c", { keyChar: "c", ctrl: true }), idle)).toBeUndefined();
  expect(chatKey(k("tab"), idle)).toBeUndefined();
  expect(chatKey(k("enter", { keyChar: "\r" }), idle)).toBeUndefined();
});

const user = (text: string, id = text): Entry => ({ id, kind: "user", at: 0, text });

test("the prompts sent, oldest first, one for the same sent twice in a row", () => {
  const entries: Entry[] = [user("one"), { id: "a", kind: "agent", at: 0, text: "answer" }, user("two"), user("two", "two again"), user("  "), user("three")];
  expect(sentPrompts(entries)).toEqual(["one", "two", "three"]);
});

test("Up from an empty draft goes back through the prompts sent, Down comes forward to an empty draft", () => {
  const sent = ["one", "two", "three"];
  let at = stepRecall(sent, null, "", "up")!;
  expect(at).toEqual({ at: 2, draft: "three" });
  at = stepRecall(sent, at.at, at.draft, "up")!;
  expect(at).toEqual({ at: 1, draft: "two" });
  at = stepRecall(sent, at.at, at.draft, "up")!;
  expect(at).toEqual({ at: 0, draft: "one" });
  expect(stepRecall(sent, at.at, at.draft, "up")).toBeUndefined();
  at = stepRecall(sent, at.at, at.draft, "down")!;
  expect(at).toEqual({ at: 1, draft: "two" });
  at = stepRecall(sent, 2, "three", "down")!;
  expect(at).toEqual({ at: null, draft: "" });
});

test("a draft of one's own is never replaced: Up and Down move its caret", () => {
  const sent = ["one", "two"];
  expect(recallTakes("up", sent, null, "hello")).toBe(false);
  expect(stepRecall(sent, null, "hello", "up")).toBeUndefined();
  // A prompt brought back and then changed is the user's draft now.
  expect(recallTakes("up", sent, 1, "two!")).toBe(false);
  expect(recallTakes("down", sent, 1, "two!")).toBe(false);
  expect(recallTakes("down", sent, null, "")).toBe(false);
  expect(recallTakes("up", sent, null, "")).toBe(true);
  expect(recallTakes("up", [], null, "")).toBe(false);
  expect(recallTakes("down", sent, 1, "two")).toBe(true);
});
