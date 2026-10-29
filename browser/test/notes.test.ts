// What `notes` answers about the user's notes.
import { expect, test } from "bun:test";
import { label, listed, type Note } from "../src/notes.ts";

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
