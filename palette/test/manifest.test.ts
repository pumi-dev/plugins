// What the package contributes without running, as the app reads it: the palette is a block of its
// own, with the two commands and the two keys that open it.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pumi = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;

test("its two commands and their keys are declared", () => {
  expect(pumi.contributes.commands).toEqual([
    { id: "go_to_file", title: "Go to file" },
    { id: "toggle", title: "Command Palette\u2026" },
  ]);
  expect(pumi.contributes.keys).toEqual([
    { key: "<D-p>", command: "go_to_file" },
    { key: "<D-S-p>", command: "toggle" },
  ]);
});

test("the palette is a block of its own, and it declares no options", () => {
  expect(pumi.name).toBe("palette");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.api).toBe(1);
  expect(pumi.contributes.blocks).toEqual([{ id: "main", title: "Command Palette", icon: "keyboard" }]);
  expect(pumi.contributes.views).toBeUndefined();
  expect(pumi.contributes.options).toBeUndefined();
  expect(pumi.uses).toEqual(["files"]);
});
