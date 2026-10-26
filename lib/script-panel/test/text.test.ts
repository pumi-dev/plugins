// How a row words its group and its command.
import { expect, test } from "bun:test";
import { shortDetail, splitLabel } from "../src/text.ts";

test("a package's label says its place loudly and its file quietly", () => {
  expect(splitLabel("runtime/app/package.json")).toEqual({ place: "runtime/app", file: "/package.json" });
  expect(splitLabel("scripts/linux")).toEqual({ place: "scripts/linux", file: "" });
  expect(splitLabel("package.json")).toEqual({ place: "package.json", file: "" });
  expect(splitLabel(".")).toEqual({ place: ".", file: "" });
});

test("a command drops the name its row already shows", () => {
  expect(shortDetail("build.sh", "bash build.sh")).toBe("bash");
  expect(shortDetail("check", "tsc --noEmit")).toBe("tsc --noEmit");
  expect(shortDetail("build.sh", "build.sh")).toBe("build.sh");
});
