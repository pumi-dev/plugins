import { expect, test } from "bun:test";
import { byLetter, kinds, type SlotAction } from "../src/kinds.ts";

const action = (plugin: string, id: string, ran: unknown[]): SlotAction => ({ id, title: id, plugin, run: (args) => void ran.push(args) });

test("a file comes first, then each plugin's actions, numbered in order", () => {
  const list = kinds([action("pumi_dev/terminal", "open", []), action("pumi_dev/browser", "open", [])], () => {});
  expect(list.map((k) => [k.id, k.letter, k.group])).toEqual([
    ["file", "F", "pumi"],
    ["pumi_dev/terminal/open", "1", "pumi_dev/terminal"],
    ["pumi_dev/browser/open", "2", "pumi_dev/browser"],
  ]);
});

test("past nine actions a row has no key", () => {
  const list = kinds(Array.from({ length: 10 }, (_, i) => action("p", `a${i}`, [])), () => {});
  expect(list.at(-1)!.letter).toBe("");
  expect(byLetter(list, "")).toBeUndefined();
});

test("a key picks its row, any case, and an action runs with the tab and the list's place", () => {
  const ran: unknown[] = [];
  const list = kinds([action("pumi_dev/terminal", "open", ran)], () => {});
  expect(byLetter(list, "f")?.id).toBe("file");
  byLetter(list, "1")!.open("%4", { kind: "tiled", replace: "%4" });
  expect(ran).toEqual([{ tab: "%4", place: { kind: "tiled", replace: "%4" } }]);
});
