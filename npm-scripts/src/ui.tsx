// What it draws: `script-panel`'s page, in the left sidebar (`package.json`'s `contributes.points.
// panel`). The scripts are read by the worker (`load`), which reads this package's options.
import { ScriptPage } from "../../lib/script-panel/src/ui.tsx";

import { load } from "./main.ts";

/** The `panel` point's view: the page, its options followed. */
export function Scripts() {
  return <ScriptPage load={load} options={["show_command", "sort", "max_depth"]} noun="script" />;
}
