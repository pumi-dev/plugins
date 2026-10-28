// What an agent is told of the user's notes, and what `notes` answers.
import { expect, test } from "bun:test";
import { hint, label, listed, type Note } from "../src/notes.ts";

const note = (id: number, tab: string, read = false): Note => ({
  id,
  tab,
  url: "http://localhost:3000/",
  title: "App",
  note: id === 1 ? "make it blue" : "",
  at: "2026-10-28T00:00:00.000Z",
  read,
  element: {
    ref: "e4",
    selector: "button.save",
    tag: "button",
    role: "button",
    name: "Save",
    box: { x: 10, y: 20, width: 80, height: 24 },
    html: '<button class="save">Save</button>',
    source: { file: "src/App.tsx", line: 12, components: ["SaveButton", "App"] },
  },
});

test("the hint says where the notes are and how to read them", () => {
  const one = hint([note(1, "%3")], "pumi_dev.browser");
  expect(one).toContain("a note on an element");
  expect(one).toContain("browser tab %3 (http://localhost:3000/)");
  expect(one).toContain("`pumi call pumi_dev.browser.notes %3`");
  const two = hint([note(1, "%3"), note(2, "%5")], "pumi_dev.browser");
  expect(two).toContain("2 notes on elements");
  expect(two).toContain("`pumi call pumi_dev.browser.notes %3`, `pumi call pumi_dev.browser.notes %5`");
});

test("notes lists each note with its element", () => {
  const out = listed("%3", [note(1, "%3"), note(2, "%3", true)], 2);
  expect(out).toContain("## Note 1: button \"Save\"\nThe user says: make it blue");
  expect(out).toContain("## Note 2: button \"Save\" (read before)\nThe user says: (nothing written: they pointed at it)");
  expect(out).toContain("selector: button.save");
  expect(out).toContain("source: src/App.tsx:12, components SaveButton < App");
  expect(out).toContain('```html\n<button class="save">Save</button>\n```');
  expect(listed("%3", [], 0)).toBe("No notes in %3.");
  expect(listed("%3", [], 2)).toContain("2 read");
  expect(label({ ...note(1, "%3").element, role: undefined, name: undefined })).toBe("button");
});
