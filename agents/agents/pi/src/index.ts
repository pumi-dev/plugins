// pi's format, for the agents plugin (omp writes it too): the session files it writes (`parse.ts`,
// where they are in `locate.ts`), the live file the plugin's hook writes while it works, the
// models its `/model` takes, its slash commands, and the extension that takes it back to an exact
// message (`pumi-chat.ts`). Its GUI's engine, over `pi --mode rpc`, is `engine.ts`, which the
// plugin's host imports.
import { join } from "node:path";

import type { FormatDef } from "../../../src/api.ts";
import { piBuiltins, piFileCommands } from "./commands.ts";
import { locatePi } from "./locate.ts";
import { piModels } from "./models.ts";
import { PiParser } from "./parse.ts";

export const formats: Record<string, FormatDef> = {
  pi: {
    parser: () => new PiParser(),
    locate: locatePi,
    models: (spec) => piModels(spec),
    builtins: piBuiltins,
    fileCommands: piFileCommands,
    live: true,
    extension: join(import.meta.dir, "..", "pumi-chat.ts"),
  },
};
