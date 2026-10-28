// The user's notes on a page's elements, and what an agent is told of them: the words, no I/O, so
// both halves and the tests share them.

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

/** The hidden line an agent gets at its next prompt: there are notes, and how to read them.
 * `fns` is the package's prefix as its functions are called (`pumi_dev.browser`). */
export function hint(unread: Note[], fns: string): string {
  const tabs = [...new Set(unread.map((n) => n.tab))];
  const where = tabs
    .map((tab) => {
      const mine = unread.filter((n) => n.tab === tab);
      return `${mine.length} in browser tab ${tab} (${mine[mine.length - 1]!.url})`;
    })
    .join(", ");
  const read = tabs.map((tab) => `\`pumi call ${fns}.notes ${tab}\``).join(", ");
  const one = unread.length === 1;
  const tab = tabs[0]!;
  return (
    `The user left ${one ? "a note on an element" : `${unread.length} notes on elements`} of a web page in pumi's browser: ${where}. ` +
    `They picked ${one ? "the element" : "each element"} and wrote what they want changed. Read ${one ? "it" : "them"} with ${read} before you answer, ` +
    `and take what ${one ? "it asks" : "they ask"} as part of their message. A note names its element by CSS selector and HTML and, where the site's dev build says, its source file. ` +
    `The page's other tools take the tab and a JSON object: \`pumi call ${fns}.snapshot ${tab}\`, \`find\`, \`click\`, \`fill\`, \`eval\`, \`console\`, \`screenshot\` ` +
    `(\`pumi help ${fns}.click\` says what each takes); \`pumi call ${fns}.clearNotes ${tab}\` takes the notes off once they are done.`
  );
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
