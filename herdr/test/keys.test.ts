// herdr's default keys against pumi/testing: each one bound in the prefix table, each calling the
// API, once per key — and none of them when `default_keys` is off.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";
import { bindings, install } from "../src/keys.ts";

const dir = join(import.meta.dir, "..");
let app: FakeApp;
afterEach(() => app?.stop());

/** The API functions herdr's keys may call: the ones the package serves its methods with. */
const CALLS = new Set([
  "session.create",
  "session.close",
  "session.select",
  "pane.open",
  "pane.select",
  "pane.close",
  "pane.setZoom",
  "pane.resize",
  "tab.select",
  "tab.close",
]);

test("every key is bound once and calls the API", async () => {
  app = await FakeApp.start({ dir });
  await install();
  const keys = bindings();
  expect(new Set(keys.map((binding) => binding.key)).size).toBe(keys.length);
  for (const binding of keys) {
    expect(CALLS.has(binding.call.call)).toBe(true);
    expect(app.keys.get(`prefix ${binding.key}`)).toEqual(binding.call);
    expect(binding.desc.length).toBeGreaterThan(0);
  }
  // herdr counts tabs from 1, and only the resizes repeat.
  expect(app.keys.get("prefix 1")).toEqual({ call: "tab.select", args: [{ index: 0 }] });
  expect(app.keys.get("prefix 9")).toEqual({ call: "tab.select", args: [{ index: 8 }] });
  const repeated = keys.filter((binding) => binding.desc.startsWith("Resize")).map((binding) => binding.key);
  expect(repeated).toEqual(["H", "L", "K", "J"]);
});

test("the keys herdr's own TUI owns are not bound, and neither is the prefix", async () => {
  app = await FakeApp.start({ dir });
  await install();
  const bound = new Set(bindings().map((binding) => binding.key));
  for (const key of ["?", "s", "d", "r", "a", "C-b"]) expect(bound.has(key)).toBe(false);
  expect(app.keys.size).toBe(bindings().length);
});

test("default_keys off leaves the prefix table alone", async () => {
  app = await FakeApp.start({ dir, options: { default_keys: false } });
  expect(await install()).toEqual([]);
  expect(app.keys.size).toBe(0);
});
