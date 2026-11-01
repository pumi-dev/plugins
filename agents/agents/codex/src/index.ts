// Codex's format, for the agents plugin: the session files it writes (`parse.ts`, where they are in
// `locate.ts`) and its slash commands. Its model is picked in its own terminal. Its GUI's engine,
// over `codex app-server`, is `engine.ts`, which the plugin's host imports.
import type { FormatDef } from "../../../src/api.ts";
import { codexBuiltins, codexFileCommands } from "./commands.ts";
import { locateCodex } from "./locate.ts";
import { CodexParser } from "./parse.ts";

export const formats: Record<string, FormatDef> = {
  codex: {
    parser: () => new CodexParser(),
    locate: (_spec, session, where) => locateCodex(session, where),
    builtins: codexBuiltins,
    fileCommands: codexFileCommands,
    modelsInTerminal: true,
  },
};
