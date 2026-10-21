// What the package contributes without running, as the app reads it: Settings shows its options,
// and the app knows the view its page is.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
const pumi = manifest.pumi;

test("its options are declared for Settings, each with what it says", () => {
  expect(Object.keys(pumi.contributes.options)).toEqual(["show_command", "max_depth", "extensions", "shebang"]);
  for (const [key, spec] of Object.entries<any>(pumi.contributes.options)) {
    expect({ key, type: spec.type, group: spec.group }).toEqual({
      key,
      type: expect.stringMatching(/^(boolean|number|string|table|secret)$/),
      group: "Shell Scripts",
    });
    expect(spec.desc).toBeTruthy();
  }
  expect(pumi.contributes.options.max_depth).toMatchObject({ default: 4, min: 1, max: 10, step: 1 });
  expect(pumi.contributes.options.extensions.default).toBe("sh, bash, zsh, ksh, fish");
  expect(pumi.contributes.options.shebang.default).toBe(true);
});

test("it contributes its view, finds the files, runs in a terminal, and starts with the app", () => {
  expect(pumi.name).toBe("shell-scripts");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.contributes.views).toEqual([{ id: "scripts", title: "Shell Scripts", icon: "terminal" }]);
  expect(pumi.uses).toEqual(["files", "processes"]);
  expect(pumi.activation).toEqual(["onStartup"]);
  // Its finder is `script-panel`'s page: the library is a dependency, not a copy of it.
  expect(manifest.dependencies).toEqual({ "script-panel": "file:../lib/script-panel" });
});
