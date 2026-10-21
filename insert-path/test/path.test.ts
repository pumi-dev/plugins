// A path into the shell, and a path in the header.
import { expect, test } from "bun:test";
import { quote, tilde } from "../src/path.ts";

test("paths are quoted only when a shell would split them", () => {
  expect(quote("src/main.rs")).toBe("src/main.rs");
  expect(quote("src/my file.rs")).toBe("'src/my file.rs'");
  expect(quote("it's.rs")).toBe("'it'\\''s.rs'");
  expect(quote("a$b")).toBe("'a$b'");
  expect(quote("")).toBe("''");
});

test("a home path is shown with a tilde", () => {
  expect(tilde("/Users/me/src", "/Users/me")).toBe("~/src");
  expect(tilde("/tmp/x", "/Users/me")).toBe("/tmp/x");
  expect(tilde("/tmp/x", "")).toBe("/tmp/x");
});
