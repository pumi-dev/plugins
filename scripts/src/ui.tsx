// What it draws: `script-panel`'s page, in the left sidebar (`package.json`'s `contributes.slots.
// panel`). The scripts are read by the worker (`load`), which reads this package's options, and run
// by it too (`run`). Every option it follows is named here, so a change to any of them reads again.
import { ScriptPage } from "../../lib/script-panel/src/ui.tsx";

import { load, run } from "./main.ts";

/** The `panel` slot's view: the page, its options followed. */
export function Scripts() {
  return (
    <ScriptPage
      load={load}
      run={run}
      options={["npm_scripts", "shell_scripts", "show_command", "sort", "max_depth", "extensions", "shebang"]}
      noun="script"
    />
  );
}
