// The kit is one script for any page: it parses, and a call to it is a function body.
import { expect, test } from "bun:test";
import { KIT, kitCall } from "../src/kit.ts";

test("the kit parses as a script and its calls as async bodies", () => {
  expect(() => new Function(KIT)).not.toThrow();
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const method of ["snapshot", "click", "pick", "mark"]) expect(() => new AsyncFunction(kitCall(method, { target: "e1" }))).not.toThrow();
  expect(kitCall("fill", { value: "a\"b" })).toContain('window.__pumiKit["fill"]({"value":"a\\"b"})');
});
