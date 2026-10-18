// A finder the tests share: each `*.run` file in a directory is a script it runs with `sh`, the
// way the scripts plugin reads a directory. Not a test of its own (`bun test` runs `*.test.ts`).
import { readdirSync } from "node:fs";
import { label, quote, type Finder, type Group } from "../src/finder.ts";

/** The scripts in `dir`: its `*.run` files, by name. */
export function runs(depth = 4, sort?: (groups: Group[]) => void): Finder {
  return {
    depth,
    showDetail: true,
    empty: "No .run files found",
    groups(dir: string, root: string): Group[] {
      const names = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".run"))
        .map((entry) => entry.name)
        .sort();
      if (names.length === 0) return [];
      return [
        {
          label: label(dir, root),
          dir,
          items: names.map((name) => ({ name, detail: `sh ${name}`, command: `sh ${quote(name)}` })),
        },
      ];
    },
    ...(sort ? { sort } : {}),
  };
}
