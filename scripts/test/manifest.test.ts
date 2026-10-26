// What the package contributes without running, as the app reads it: Settings shows its options,
// and the app knows which page to put in the sidebar.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
const pumi = manifest.pumi;

test("its options are declared for Settings, each with what it says", () => {
  const options = pumi.contributes.options;
  expect(Object.keys(options)).toEqual(["npm_scripts", "shell_scripts", "show_command", "sort", "max_depth", "extensions", "shebang"]);
  for (const [key, spec] of Object.entries<any>(options)) {
    expect({ key, type: spec.type, group: spec.group }).toEqual({
      key,
      type: expect.stringMatching(/^(boolean|number|string|table|secret)$/),
      group: "Scripts",
    });
    expect(spec.desc).toBeTruthy();
    expect(spec.label).toBeTruthy();
  }
});

test("both kinds of script are listed until they are turned off", () => {
  const options = pumi.contributes.options;
  expect(options.npm_scripts.default).toBe(true);
  expect(options.shell_scripts.default).toBe(true);
  expect(options.show_command.default).toBe(true);
  expect(options.shebang.default).toBe(true);
  expect(options.extensions.default).toBe("sh, bash, zsh, ksh, fish");
  expect(options.max_depth).toMatchObject({ default: 4, min: 1, max: 10, step: 1 });
  expect(options.sort).toMatchObject({ default: "path", choices: ["path", "scripts"] });
});

test("it contributes one page to the side bar, and no pane of its own", () => {
  expect(pumi.name).toBe("scripts");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.api).toBe(1);
  expect(pumi.uses).toEqual(["files", "processes"]);
  expect(pumi.contributes.slots).toEqual({ panel: { view: "Scripts", title: "Scripts", icon: "code" } });
  expect(pumi.contributes.points).toBeUndefined();
  // Its page is `script-panel`'s: the library is a dependency, not a copy of it.
  expect(manifest.dependencies).toEqual({ "script-panel": "file:../lib/script-panel" });
});
