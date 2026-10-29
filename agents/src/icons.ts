// The agents' marks (`icons/`, see `icons/LICENSES`), as a tab's `@icon` takes them: a `data:` URI,
// since a `plugin:` path names a file of the plugin whose block the tab holds, and the chat draws
// the `terminal` block, which it does not define. No `import … from "pumi"` here.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A tab's own icon. */
export const ICON = "@icon";

/** The marks one agent shares with another. */
const ALIASES: Record<string, string> = { omp: "pi" };

const DIR = join(import.meta.dir, "..", "icons");

const read = new Map<string, string | undefined>();

/** Agent `agent`'s mark as an `@icon` value, if the plugin has one. */
export function agentIcon(agent: string): string | undefined {
  const name = ALIASES[agent] ?? agent;
  if (!/^[a-z0-9_-]+$/.test(name)) return undefined;
  if (!read.has(name)) {
    let icon: string | undefined;
    try {
      icon = `data:image/svg+xml;base64,${readFileSync(join(DIR, `${name}.svg`)).toString("base64")}`;
    } catch {
      icon = undefined;
    }
    read.set(name, icon);
  }
  return read.get(name);
}
