// The view the panel's tests open: `script-panel`'s page over the repository the test answers
// `format.eval` with, its finder the `.run` files of `test/runs.ts`, its options read through
// `option.get` the way a package reads its own. Not a test of its own.
import { option, pkg, view } from "pumi";
import { scriptPanel, type Finder } from "../src/index.ts";
import { runs } from "./runs.ts";

/** The finder of each pane: the test's scripts, at the depth and detail its options say. */
async function read(): Promise<Finder> {
  return {
    ...runs(Number((await option.get("depth")) ?? 4)),
    showDetail: (await option.get("commands")) !== false,
    optionMatch: pkg.prefixed("*"),
  };
}

view("scripts", scriptPanel(read, "script"));
