// herdr's public ids against the numbers pumi gives: the alphabet bijective base 32, the ids
// `w5`, `w5:t7`, `w5:p9` and `term_9`, and what each id reads back.
import { describe, expect, test } from "bun:test";
import { decode, encode, pane, splitPane, splitTab, tab, terminal, workspace, workspaceNumber } from "../src/ids.ts";

describe("the alphabet", () => {
  test("counts from 1 in 32 symbols, without I, L, O and U", () => {
    expect(encode(0)).toBe("0");
    expect(encode(1)).toBe("1");
    expect(encode(9)).toBe("9");
    expect(encode(10)).toBe("A");
    expect(encode(31)).toBe("Z");
    expect(encode(32)).toBe("0");
    expect(encode(33)).toBe("11");
    expect(encode(64)).toBe("10");
    expect(encode(100)).toBe("34");
    expect(encode(1000)).toBe("Z8");
    expect(encode(1024)).toBe("Z0");
    expect(encode(65535)).toBe("1ZZZ");
  });

  test("decodes what it encodes", () => {
    // herdr's own hole: 0 is written `0`, which reads back as `0`'s symbol, the 32nd.
    expect(decode(encode(0))).toBe(32);
    for (const n of [1, 9, 10, 31, 32, 33, 64, 100, 1000, 65535]) expect(decode(encode(n))).toBe(n);
    expect(decode("I")).toBeUndefined();
    expect(decode("L")).toBeUndefined();
    expect(decode("O")).toBeUndefined();
    expect(decode("U")).toBeUndefined();
    expect(decode("")).toBeUndefined();
  });
});

test("a session, its tab, its pane and its terminal", () => {
  expect(workspace(5)).toBe("w5");
  expect(tab("w5", 7)).toBe("w5:t7");
  expect(pane("w5", 9)).toBe("w5:p9");
  expect(terminal(9)).toBe("term_9");
  // pumi's own ids read back to the same numbers.
  expect(workspaceNumber("w5")).toBe(5);
  expect(workspaceNumber("$5")).toBeUndefined();
  expect(splitTab("w5:t7")).toEqual(["w5", 7]);
  expect(splitTab("@7")).toBeUndefined();
  expect(splitPane("w5:p9")).toEqual(["w5", 9]);
  expect(splitPane("term_9")).toBeUndefined();
  // A session whose own number is two symbols long.
  expect(pane(workspace(33), 33)).toBe("w11:p11");
});
