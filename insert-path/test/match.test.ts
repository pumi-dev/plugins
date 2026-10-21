// The fuzzy matching under the picker: the score, and the entries a query keeps.
import { expect, test } from "bun:test";
import { Entry } from "../src/entries.ts";
import { hits, score } from "../src/match.ts";

test("a query is a fuzzy subsequence with word starts", () => {
  expect(score("main.rs", "")).toBe(0);
  expect(score("main.rs", "mr")).not.toBeNull();
  expect(score("main.rs", "xyz")).toBeNull();
  expect(score("src/main.rs", "sm")).not.toBeNull();
  expect(hits([], "x")).toEqual([]);
  const entries = [new Entry("src/module_maths.rs", false), new Entry("src/main.rs", false)];
  const found = hits(entries, "src/m").map((hit) => entries[hit.index]!.rel);
  // Equal scores fall back to the shorter path.
  expect(found).toEqual(["src/main.rs", "src/module_maths.rs"]);
});

test("a query with a slash matches the path", () => {
  const entries = [
    new Entry("Cargo.toml", false),
    new Entry("src/main.rs", false),
    new Entry("src/list.rs", false),
  ];
  const found = hits(entries, "src/ma").map((hit) => entries[hit.index]!.rel);
  expect(found).toEqual(["src/main.rs"]);
  const names = hits(entries, "li").map((hit) => entries[hit.index]!.rel);
  expect(names).toEqual(["src/list.rs"]);
});

test("a run, a word start and lowercase letters score higher", () => {
  expect(score("main.rs", "mai")!).toBeGreaterThan(score("main.rs", "min")!);
  expect(score("src/main.rs", "main")!).toBeGreaterThan(score("src/xmain.rs", "main")!);
  expect(score("main.rs", "m")!).toBeGreaterThan(score("MAIN.RS", "m")!);
  expect(score("Main.rs", "m")).toBe(score("Main.rs", "M"));
});
