import { expect, test } from "bun:test";
import { Names } from "../src/names.ts";

test("the names it gave are kept, and the tabs still open are the ones it knows", () => {
  const names = new Names();
  names.load({ "1": "Key Binding Fix", "4": "Gone" });
  names.seed([
    { id: 1, name: "Key Binding Fix" },
    { id: 2, name: "logs" },
    { id: 3, name: null },
  ]);
  // A tab that closed while the package did not run is not named again.
  expect(names.toJSON()).toEqual({ "1": "Key Binding Fix" });

  names.naming(3, "Theme Cleanup");
  expect(names.toJSON()).toEqual({ "1": "Key Binding Fix", "3": "Theme Cleanup" });
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
