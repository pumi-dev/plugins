// The keys the switcher answers: a press as the app's chord, what it does about it, and the chord
// its trigger is bound to.
import { expect, test } from "bun:test";

import { chord, digit, fromTrigger, keyed } from "../src/keys.ts";

const held = { ctrl: false, alt: false, shift: false, cmd: false };

test("a press is the app's chord: its key, and the modifiers held with it", () => {
  expect(chord("tab", held)).toBe("tab");
  expect(chord("tab", { ...held, alt: true })).toBe("alt+tab");
  expect(chord("Right", { ...held, ctrl: true })).toBe("ctrl+right");
  // The modifiers come in the app's order, whatever order they are held in.
  expect(chord("tab", { ...held, shift: true, alt: true })).toBe("alt+shift+tab");
  expect(chord("p", { ...held, shift: true, cmd: true, ctrl: true })).toBe("ctrl+shift+cmd+p");
  expect(chord(undefined)).toBe("");
});

test("a key moves the highlight about the row, and a digit picks its card", () => {
  expect(keyed("right")).toBe("next");
  expect(keyed("ctrl+n")).toBe("next");
  expect(keyed("alt+tab")).toBe("next");
  expect(keyed("left")).toBe("previous");
  expect(keyed("ctrl+shift+tab")).toBe("previous");
  expect(keyed("home")).toBe("first");
  expect(keyed("end")).toBe("last");
  expect(keyed("enter")).toBe("pick");
  expect(keyed("x")).toBe("close");
  expect(keyed("3")).toEqual({ go: 2 });
  expect(keyed("0")).toBeUndefined();
  expect(keyed("q")).toBeUndefined();
});

test("the trigger pressed again moves it on, whichever chord it is bound to", () => {
  expect(keyed("ctrl+space", "ctrl+space")).toBe("next");
  expect(keyed("ctrl+space")).toBeUndefined();
  // The default trigger is a chord the switcher already answers.
  expect(keyed("alt+tab", fromTrigger("<M-Tab>"))).toBe("next");
});

test("a binding's key is the chord a press of it makes", () => {
  expect(fromTrigger("<M-Tab>")).toBe("alt+tab");
  expect(fromTrigger("<C-Space>")).toBe("ctrl+space");
  expect(fromTrigger("<S-Tab>")).toBe("shift+tab");
  expect(fromTrigger("<C-S-r>")).toBe("ctrl+shift+r");
  expect(fromTrigger("<D-S-q>")).toBe("shift+cmd+q");
  expect(fromTrigger("x")).toBe("x");
  // A sequence is no one press to watch for.
  expect(fromTrigger("<C-x> <C-f>")).toBeUndefined();
  expect(fromTrigger("")).toBeUndefined();
});

test("a digit chord picks its card, and nothing else does", () => {
  expect(digit("1")).toBe(0);
  expect(digit("9")).toBe(8);
  expect(digit("0")).toBeUndefined();
  expect(digit("10")).toBeUndefined();
  expect(digit("alt+1")).toBeUndefined();
  expect(digit("escape")).toBeUndefined();
});
