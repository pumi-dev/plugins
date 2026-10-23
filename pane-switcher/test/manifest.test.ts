// What the package contributes without running, as the app reads it: Settings shows its eight
// options, and the window knows which export draws the switcher it opens.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pumi = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;

test("its options are declared for Settings, each with what it says", () => {
  const options = pumi.contributes.options;
  expect(Object.keys(options)).toEqual([
    "trigger",
    "scope",
    "order",
    "width",
    "backdrop",
    "height",
    "card_width",
    "preview",
    "preview_rows",
  ]);
  for (const [key, spec] of Object.entries<any>(options)) {
    expect({ key, type: spec.type, group: spec.group }).toEqual({
      key,
      type: expect.stringMatching(/^(boolean|number|string)$/),
      group: "Pane switcher",
    });
    expect(spec.desc).toBeTruthy();
  }
  expect(options.trigger.default).toBe("<M-Tab>");
  expect(options.scope.choices).toEqual(["tab", "session", "all"]);
  expect(options.order.choices).toEqual(["recent", "layout"]);
});

test("the switcher is a block of its own, opened by a command", () => {
  expect(pumi.name).toBe("pane-switcher");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.api).toBe(1);
  expect(pumi.contributes.blocks).toEqual([{ id: "switcher", title: "Pane switcher", icon: "blocks" }]);
  expect(pumi.contributes.views).toBeUndefined();
  expect(pumi.contributes.commands).toEqual([{ id: "switch", title: "Switch pane" }]);
});
