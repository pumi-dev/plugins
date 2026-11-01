// The agents, in the window: the registry (`registry.ts`) filled from the sub-plugins' manifests
// alone (their code is the worker's), loaded once and again when pumi says one changed. A component
// that reads the catalog calls `useAgents`, and draws again when the registry changes.
import { join } from "node:path";
import { useSyncExternalStore } from "react";
import { call, useEvent } from "pumi";

import { PLUGIN_ID } from "../names.ts";
import { onRegistry } from "../registry.ts";
import { loadSubPlugins } from "../subplugins.ts";

/** The plugin's folder: `agents/` in it holds the sub-plugins it ships. */
const DIR = join(import.meta.dir, "..", "..");

let version = 0;
onRegistry(() => version++);

let loading: Promise<void> | undefined;
let again = false;

/** Loads the registry from the sub-plugins' data; a load asked for while one runs follows it, once. */
function load(): void {
  if (loading) {
    again = true;
    return;
  }
  loading = loadSubPlugins(() => call("registry.list", "plugin", { parent: PLUGIN_ID }), DIR, false)
    .then((errors) => errors.forEach((error) => console.error(`agents: ${error}`)))
    .catch((err: unknown) => console.error(`agents: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => {
      loading = undefined;
      if (again) {
        again = false;
        load();
      }
    });
}

load();

/** Draws again as the agents change; answers their version. */
export function useAgents(): number {
  useEvent("registry.changed", (e) => (e.data as { parent?: unknown } | undefined)?.parent === PLUGIN_ID && load(), { match: "plugin" });
  return useSyncExternalStore(onRegistry, () => version);
}
