// The agents' marks, as a tab's `@icon` takes them: each a file of its sub-plugin (`icon` in its
// manifest), read as a `data:` URI, since a `plugin:` path names a file of the plugin whose block
// the tab holds, and the chat draws the `terminal` block, which it does not define. No `import …
// from "pumi"` here.
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { agentDef } from "./registry.ts";

/** A tab's own icon. */
export const ICON = "@icon";

/** The kinds of picture a mark may be, by extension. */
const TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** The most an `@icon` holds (`pumi_api::icon::MAX_ICON`). */
const MAX_ICON = 16 * 1024;

const read = new Map<string, string | undefined>();

/** The mark in `file` as an `@icon` value, if it is a picture small enough. */
export function iconOf(file: string): string | undefined {
  if (!read.has(file)) {
    let icon: string | undefined;
    try {
      const type = TYPES[extname(file).toLowerCase()];
      const uri = type ? `data:${type};base64,${readFileSync(file).toString("base64")}` : undefined;
      icon = uri && uri.length <= MAX_ICON ? uri : undefined;
    } catch {
      icon = undefined;
    }
    read.set(file, icon);
  }
  return read.get(file);
}

/** Agent `agent`'s mark as an `@icon` value, if its sub-plugin has one. */
export function agentIcon(agent: string): string | undefined {
  const file = agentDef(agent)?.icon;
  return file ? iconOf(file) : undefined;
}
