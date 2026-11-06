// The block types an agent can open, as the registry has them installed: a block is the one thing
// `tab.open` takes, so the guide lists them, a line each.
//
// What each one is for is the plugin's own words — the first sentence of its manifest's
// description, or the title it gives the block — and nothing here invents them. A block the plugin
// says nothing about (`core`'s own, `provider: "core"`, has no manifest) is its id and no more,
// which is the hole a plugin that writes its own line is meant to fill.
//
// No `import … from "pumi"` here: what the registry answers (`registry.list block`,
// `registry.list plugin`) is given to `listed` as it came.

/** One block type: what `tab.open` names, and what it is for. */
export interface Block {
  /** The id `tab.open` takes: `file`, `pumi_dev.browser.page`. */
  id: string;
  /** Its provider: `core`, or a plugin's id (`pumi_dev/terminal`). */
  provider: string;
  /** What the plugin says it is for, in a few words; the id alone when it says nothing. */
  desc: string;
}

/** A string from a value that may be anything, or `""`. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A record from a value that may be anything, or `{}`. */
function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The list a value holds, or none. */
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The first sentence of what a plugin says of itself, short enough for one line. */
function words(said: string): string {
  const sentence = said.split(/(?<=\.)\s/)[0] ?? "";
  const text = sentence.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  return text.length > 96 ? `${text.slice(0, 93).trimEnd()}…` : text;
}

/** What each plugin calls its blocks, and what it says it is. */
function pluginsOf(value: unknown): Map<string, { titles: Map<string, string>; said: string }> {
  const out = new Map<string, { titles: Map<string, string>; said: string }>();
  for (const one of array(value)) {
    const row = rec(one);
    const id = str(row.id);
    if (id === "") continue;
    const titles = new Map<string, string>();
    for (const block of array(rec(rec(row.manifest).contributes).blocks)) {
      const name = str(rec(block).id);
      const title = str(rec(block).title);
      if (name !== "" && title !== "") titles.set(name, title);
    }
    const meta = rec(row.meta);
    out.set(id, { titles, said: words(str(meta.description)) || str(meta.displayName) });
  }
  return out;
}

/**
 * The block types the registry has installed, in the order the guide lists them: the core's first,
 * then each plugin's by id. A registry that answered nothing leaves the one block pumi always has.
 */
export function listed(blocks: unknown, plugins: unknown): Block[] {
  const known = pluginsOf(plugins);
  const out: Block[] = [];
  for (const one of array(blocks)) {
    const row = rec(one);
    const id = str(row.id);
    if (id === "") continue;
    const provider = str(row.provider);
    const named = known.get(provider);
    const short = provider !== "" && id.startsWith(`${provider}.`) ? id.slice(provider.length + 1) : id;
    const desc = named?.said || named?.titles.get(short) || id;
    out.push({ id, provider, desc });
  }
  out.sort((a, b) => (a.provider === "core" ? -1 : b.provider === "core" ? 1 : a.id.localeCompare(b.id)));
  if (out.length === 0) out.push({ id: "file", provider: "core", desc: "file" });
  return out;
}

/** The block types as the guide lists them: `- pumi_dev.terminal.shell: Terminal`, a line each. */
export function blockLines(blocks: Block[]): string {
  if (blocks.length === 0) return "";
  return `${blocks.map((block) => `- ${block.id}: ${block.desc}`).join("\n")}\n`;
}
