// What the package contributes without running, as the app reads it: Settings shows the three
// options, and the app knows the page and starts the package to put it in the sidebar.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pumi = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;

test("its three options are declared for Settings, each with what it says", () => {
  const options = pumi.contributes.options;
  expect(Object.keys(options)).toEqual(["show_command", "sort", "max_depth"]);
  for (const [key, spec] of Object.entries<any>(options)) {
    expect({ key, type: spec.type }).toEqual({ key, type: expect.stringMatching(/^(boolean|number|string|table|secret)$/) });
    expect(spec.desc).toBeTruthy();
    expect(spec.group).toBe("NPM Scripts");
  }
  expect(options.show_command.default).toBe(true);
  expect(options.sort.default).toBe("path");
  expect(options.sort.choices).toEqual(["path", "scripts"]);
  expect(options.max_depth).toEqual(expect.objectContaining({ default: 4, min: 1, max: 10, step: 1 }));
});

test("it contributes its page to the side bar, and no pane of its own", () => {
  expect(pumi.name).toBe("npm-scripts");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.api).toBe(1);
  expect(pumi.uses).toEqual(["files", "processes"]);
  expect(pumi.contributes.points).toEqual({ panel: { view: "Scripts", title: "NPM Scripts", icon: "package" } });
  expect(pumi.contributes.views).toBeUndefined();
});
