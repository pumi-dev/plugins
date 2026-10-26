// Every plan the panel can show, in the order it lists them. Adding one is a module beside this and
// a line here, plus its option in the manifest.

import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { copilot } from "./copilot.ts";
import { openrouter } from "./openrouter.ts";
import type { Provider } from "./types.ts";

export const PROVIDERS: Provider[] = [claude, codex, copilot, openrouter];

export type { Env, Provider, ProviderId } from "./types.ts";
