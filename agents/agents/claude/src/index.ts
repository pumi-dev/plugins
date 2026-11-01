// Claude Code's format, for the agents plugin: the session files it writes (`parse.ts`, where they
// are in `locate.ts`), the models its `/model` takes and its slash commands. Its GUI's engine,
// over the Claude Agent SDK, is `engine.ts`, which the plugin's host imports.
import type { FormatDef } from "../../../src/api.ts";
import { claudeBuiltins, claudeFileCommands } from "./commands.ts";
import { locateClaude } from "./locate.ts";
import { claudeModels } from "./models.ts";
import { ClaudeParser } from "./parse.ts";

export const formats: Record<string, FormatDef> = {
  claude: {
    parser: () => new ClaudeParser(),
    locate: (_spec, session, where) => locateClaude(session, where),
    models: (_spec, cwd, env) => claudeModels(cwd, env),
    builtins: claudeBuiltins,
    fileCommands: claudeFileCommands,
  },
};
