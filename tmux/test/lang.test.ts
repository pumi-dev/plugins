// tmux's flag templates read over a command's arguments, and the text a format is made of.
import { expect, test } from "bun:test";
import { all, COMMON_LONGS, get, has, hasLong, parse, toValue, words } from "../src/lang/args.ts";
import { basename, dirname, padAfter, padBefore, quoteArguments, quoteShell, trimLeft, trimRight, width } from "../src/lang/text.ts";

test("tmux's templates", () => {
  const p = parse("bc:de:hl:t:D::", 0, -1, COMMON_LONGS, [
    "-dh",
    "-tfoo",
    "-e",
    "A=1",
    "-eB=2",
    "-D",
    "-l",
    "30%",
    "top",
    "-x",
  ]);
  expect(has(p, "d") && has(p, "h") && has(p, "D")).toBe(true);
  expect(get(p, "t")).toBe("foo");
  expect(all(p, "e")).toEqual(["A=1", "B=2"]);
  expect(get(p, "D")).toBeUndefined();
  expect(words(p)).toEqual(["top", "-x"]);

  const long = parse("t:", 0, 0, COMMON_LONGS, ["--target=%3", "--json"]);
  expect(get(long, "t")).toBe("%3");
  expect(hasLong(long, "json")).toBe(true);
  expect(() => parse("t:", 0, 0, COMMON_LONGS, ["-x"])).toThrow("unknown flag -x");
  expect(() => parse("t:", 1, 1, COMMON_LONGS, [])).toThrow("needs 1 argument");
  expect(() => parse("t:", 0, 0, COMMON_LONGS, ["--nope"])).toThrow("unknown option --nope");
});

test("a flag given twice is a list of values, or a count", () => {
  const p = parse("ab:e:", 0, -1, [], ["-aa", "-e", "x", "-e", "y"]);
  expect(toValue(p)).toEqual({ flags: { a: 2, e: ["x", "y"] }, long: {}, args: [] });
});

test("widths skip styles", () => {
  expect(width("#[fg=red]abc#[default]")).toBe(3);
  expect(width("a##b")).toBe(3);
  expect(width("日本")).toBe(4);
});

test("trims", () => {
  expect(trimLeft("#[fg=red]abcdef", 3)).toBe("#[fg=red]abc");
  expect(trimRight("abcdef", 2)).toBe("ef");
  expect(trimLeft("日本語", 3)).toBe("日");
  expect(padAfter("42", 8)).toBe("42      ");
  expect(padBefore("42", 8)).toBe("      42");
});

test("a path's parts", () => {
  expect(basename("/usr/lib/")).toBe("lib");
  expect(dirname("/usr/lib/")).toBe("/usr");
  expect(dirname("file")).toBe(".");
  expect(dirname("/file")).toBe("/");
  expect(basename("/")).toBe("/");
});

test("text as a shell reads it", () => {
  expect(quoteShell("a b")).toBe("a\\ b");
  expect(quoteArguments("a b")).toBe('"a b"');
  expect(quoteArguments("")).toBe("''");
});
