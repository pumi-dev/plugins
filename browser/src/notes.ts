// The user's notes on a page's elements, and what `notes` answers about them: the words, no I/O,
// so both halves and the tests share them.

/** An element as the kit's `find` and `pick` describe it. */
export interface Described {
  ref: string;
  selector: string;
  tag: string;
  role?: string;
  name?: string;
  box: { x: number; y: number; width: number; height: number };
  attributes?: Record<string, string>;
  text?: string;
  html?: string;
  ancestors?: string;
  style?: Record<string, string>;
  source?: { file?: string; line?: number; column?: number; components?: string[] };
}

/** What the user wrote about an element of the page in `tab`. */
export interface Note {
  id: number;
  tab: string;
  url: string;
  title: string;
  note: string;
  at: string;
  /** Whether an agent has read it (`notes`). */
  read: boolean;
  element: Described;
}

/** A short name for an element: `button "Sign in"`. */
export function label(e: Described): string {
  const name = e.name ? ` "${e.name.length > 60 ? `${e.name.slice(0, 60)}…` : e.name}"` : "";
  return `${e.role ?? e.tag}${name}`;
}

/** Where an element comes from in the site's source, when its dev build says. */
function source(e: Described): string | null {
  const s = e.source;
  if (!s) return null;
  const at = s.file ? `${s.file}${s.line ? `:${s.line}${s.column ? `:${s.column}` : ""}` : ""}` : "";
  const comps = s.components?.length ? `components ${s.components.join(" < ")}` : "";
  return [at, comps].filter(Boolean).join(", ") || null;
}

/** What `notes` answers: each note, and its element. */
export function listed(tab: string, shown: Note[], total: number): string {
  if (!shown.length) return total ? `No unread notes in ${tab} (${total} read: \`{"all": true}\` lists them).` : `No notes in ${tab}.`;
  const out = [`${shown.length} note${shown.length === 1 ? "" : "s"} the user left on the page in ${tab}:`];
  for (const n of shown) {
    const e = n.element;
    out.push("");
    out.push(`## Note ${n.id}: ${label(e)}${n.read ? " (read before)" : ""}`);
    out.push(`The user says: ${n.note || "(nothing written: they pointed at it)"}`);
    out.push(`page: ${n.url}${n.title ? ` (${n.title})` : ""}`);
    out.push(`selector: ${e.selector}`);
    out.push(`ref: ${e.ref} (works with click, find… while the page has not reloaded)`);
    const src = source(e);
    if (src) out.push(`source: ${src}`);
    if (e.ancestors) out.push(`inside: ${e.ancestors}`);
    out.push(`box: ${e.box.width}x${e.box.height} at ${e.box.x},${e.box.y} of the page`);
    if (e.text) out.push(`text: ${e.text}`);
    if (e.style) out.push(`style: ${Object.entries(e.style).map(([k, v]) => `${k} ${v}`).join("; ")}`);
    if (e.html) out.push("html:", "```html", e.html, "```");
  }
  return out.join("\n");
}
