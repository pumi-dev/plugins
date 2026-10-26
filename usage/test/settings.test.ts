// The options, as the worker and the window read them: defaults where nothing is set, a refusal
// of what the manifest's bounds do not allow, and the option names the manifest declares.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { coerce, DEFAULT_SETTINGS, OPTION_OF, OPTIONS } from "../src/settings.ts";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).pumi;

test("nothing set is every default", () => {
  expect(coerce(() => undefined)).toEqual(DEFAULT_SETTINGS);
  expect(coerce(() => null)).toEqual(DEFAULT_SETTINGS);
});

test("what the manifest declares is what is read, by the manifest's name", () => {
  // The two secrets are the providers' keys, which a provider reads rather than a setting.
  const declared = Object.entries<any>(manifest.contributes.options)
    .filter(([, spec]) => spec.type !== "secret")
    .map(([key]) => key)
    .sort();
  expect([...OPTIONS].sort()).toEqual(declared);
  expect(OPTION_OF.warnAt).toBe("warn_at");
  expect(OPTION_OF.critAt).toBe("crit_at");
  for (const [key, option] of Object.entries(OPTION_OF)) {
    expect(declared).toContain(option);
    expect(DEFAULT_SETTINGS).toHaveProperty(key);
  }
});

test("a value of the wrong kind falls back instead of drawing something else", () => {
  const settings = coerce((option) => (option === "resets" ? "diagonal" : option === "every" ? "soon" : option === "tint" ? "yes" : undefined));
  expect(settings.resets).toBe("countdown");
  expect(settings.every).toBe(DEFAULT_SETTINGS.every);
  expect(settings.tint).toBe(true);
});

test("numbers are kept inside the manifest's bounds, and whole where they count things", () => {
  const settings = coerce((option) => ({ every: 0, warn_at: -20, crit_at: 1000 })[option]);
  expect(settings.every).toBe(1);
  expect(settings.warnAt).toBe(1);
  expect(settings.critAt).toBe(99);
  expect(coerce((option) => ({ every: 2.6 })[option])).toMatchObject({ every: 3 });
});

test("the choices are the ones the manifest offers", () => {
  expect(manifest.contributes.options.resets.choices).toEqual(["countdown", "clock", "off"]);
  expect(coerce((option) => ({ resets: "clock" })[option])).toMatchObject({ resets: "clock" });
  expect(coerce((option) => ({ resets: "off" })[option]).resets).toBe("off");
});
