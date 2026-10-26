import { expect, test } from "bun:test";
import { Names } from "../src/names.ts";

test("a tab it named stays its own; a tab you named is left alone", () => {
  const names = new Names();
  names.load({ "1": "Key Binding Fix" });
  names.seed([
    { id: 1, name: "Key Binding Fix" },
    { id: 2, name: "logs" },
    { id: 3, name: null },
  ]);
  expect([names.mine(1), names.mine(2), names.mine(3)]).toEqual([true, false, true]);

  // Its own rename comes back as `tab.renamed` and changes nothing.
  names.naming(3, "Theme Cleanup");
  names.renamed(3, "Theme Cleanup");
  expect(names.mine(3)).toBe(true);

  // You rename it: it is yours, until you give it back its automatic name.
  names.renamed(3, "mine");
  expect(names.mine(3)).toBe(false);
  names.renamed(3, null);
  expect(names.mine(3)).toBe(true);

  // The command takes a tab back.
  names.claim(2);
  expect(names.mine(2)).toBe(true);
});

test("closed tabs are forgotten, and only its names are kept", () => {
  const names = new Names();
  names.load({ "9": "Gone" });
  names.seed([{ id: 1, name: null }]);
  names.naming(1, "Screenshot UI");
  expect(names.toJSON()).toEqual({ "1": "Screenshot UI" });
  names.closed(1);
  expect(names.toJSON()).toEqual({});
});
