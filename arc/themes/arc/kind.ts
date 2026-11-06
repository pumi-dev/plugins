// What a tab holds, in Arc's words: the site its page is on, the word the address pill says for
// something that is not a page (a terminal, an agent, an editor), the letter and colour a page's
// tile wears, and the rows a view's tabs make in the sidebar. Nothing here draws or calls the
// server: the parts do, and the tests check what these answer.

/** What a tab holds, as this file reads it: its block, its names, and its options. */
export interface Held {
  block: string
  label?: string
  terminal_title?: string | null
  cwd?: string | null
  options?: Record<string, unknown>
}

/** A pane of a view: its tabs in its strip's order, and the one in front. */
export interface Group {
  pane: string
  tabs: string[]
  active?: string | null
}

/** A block's option prefix: `pumi_dev.browser.page` → `pumi_dev.browser.`. */
export function prefixOf(block: string): string {
  const at = block.lastIndexOf(".")
  return at < 0 ? "" : block.slice(0, at + 1)
}

/**
 * The page a tab holds: the `url` option its block keeps (`pumi_dev.browser.url` for the browser's
 * `pumi_dev.browser.page`), whichever plugin draws it. `url` is empty while the tab has yet to say
 * where it is; a block whose name ends in `page` is a page all the same.
 */
export function webOf(tab: Held): { prefix: string; url: string } | undefined {
  const prefix = prefixOf(tab.block)
  const url = tab.options?.[`${prefix}url`]
  if (typeof url === "string") return { prefix, url }
  if (/(^|\.)page$/.test(tab.block)) return { prefix, url: "" }
  return undefined
}

/** `url`'s site, as Arc's address pill says it: no scheme, no `www.`, no path, query or hash. */
export function siteOf(url: string): string {
  const text = url.trim()
  if (!text || /^about:(blank|newtab)$/i.test(text)) return ""
  const at = text.indexOf("://")
  if (at < 0) return ""
  const scheme = text.slice(0, at).toLowerCase()
  if (scheme !== "http" && scheme !== "https") return ""
  const rest = text.slice(at + 3)
  const stop = rest.search(/[/?#]/)
  const host = (stop < 0 ? rest : rest.slice(0, stop)).replace(/^www\./i, "")
  return host
}

/** The words a block's id is drawn as, when it is not a page: its kind, in the address pill. */
const KINDS: readonly (readonly [RegExp, string])[] = [
  [/(^|[^a-z0-9])(terminal|shell|ghostty|zsh|bash)([^a-z0-9]|$)/i, "Terminal"],
  [/(^|[^a-z0-9])(agents?|chat|claude|codex|pi)([^a-z0-9]|$)/i, "Agent"],
  [/(^|[^a-z0-9])(file|files|editor|code|csv|image|pdf|viewer)([^a-z0-9]|$)/i, "Editor"],
  [/(^|[^a-z0-9])git([^a-z0-9]|$)/i, "Git"],
  [/(^|[^a-z0-9])(page|browser|web)([^a-z0-9]|$)/i, "Page"],
]

/** What the address pill says of a tab that is not a page: `Terminal`, `Agent`, or its block's last word. */
export function kindWord(block: string): string {
  const id = block.toLowerCase()
  for (const [pattern, word] of KINDS) if (pattern.test(id)) return word
  const last = id.slice(id.lastIndexOf(".") + 1).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
  const words = last.split(/[_-]+/).filter(Boolean)
  if (!words.length) return "Tab"
  return words.map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ")
}

/** What the address pill reads for a tab not being typed in: its page's site, or what it holds. */
export function addressOf(tab: Held): string {
  const web = webOf(tab)
  if (!web) return kindWord(tab.block)
  if (!web.url || /^about:(blank|newtab)$/i.test(web.url)) return "New Tab"
  return siteOf(web.url) || web.url
}

/** The letter a page's tile wears: its site's or its name's first letter or digit, upper case. */
export function monogram(text: string): string {
  const clean = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "")
  const found = clean.match(/[a-z0-9]/i)
  return (found?.[0] ?? "•").toUpperCase()
}

/** The colours a page's tile is picked from, by its name: Arc's fallback letter tiles. */
export const TINTS = ["#d9694a", "#c99030", "#4a9d63", "#3d86d6", "#7a67e0", "#c4558f", "#2f9a9a", "#b05555"] as const

/** The colour a page's tile wears: always the same one for the same name. */
export function tintFor(name: string): string {
  let hash = 2166136261
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return TINTS[Math.abs(hash) % TINTS.length]!
}

/** Whether `tab` is pinned in `pinned`. */
export function isPinned(pinned: readonly string[], tab: string): boolean {
  return pinned.includes(tab)
}

/** `pinned` with `tab` pinned, or taken out when it already was. */
export function togglePinned(pinned: readonly string[], tab: string): string[] {
  return pinned.includes(tab) ? pinned.filter((id) => id !== tab) : [...pinned, tab]
}

/** `pinned` without the tabs that closed: a tile stands for a tab that is still there. */
export function prunePinned(pinned: readonly string[], known: ReadonlySet<string>): string[] {
  return pinned.filter((id) => known.has(id))
}

/**
 * The rows a view's tabs make in the side bar: one per pane, in the layout's order, a pane's tabs
 * together (Arc's split pair is one row of two chips); then, last, the tabs no pane holds (its
 * floating ones). A row's `pane` is empty when it is that last one.
 */
export function groupsOf(leaves: readonly Group[], loose: readonly string[] = []): Group[] {
  const out: Group[] = leaves
    .filter((leaf) => leaf.tabs.length > 0)
    .map((leaf) => ({ pane: leaf.pane, tabs: [...leaf.tabs], active: leaf.active ?? leaf.tabs[0] ?? null }))
  const held = new Set(out.flatMap((leaf) => leaf.tabs))
  const rest = loose.filter((tab) => !held.has(tab))
  if (rest.length) out.push({ pane: "", tabs: rest, active: rest[0] ?? null })
  return out
}

/** A tab as a row shows it: its name, its title, its folder, its type. */
export function rowName(tab: Held): string {
  const dir = tab.cwd ? tab.cwd.slice(tab.cwd.lastIndexOf("/") + 1) : ""
  return tab.label || tab.terminal_title || dir || kindWord(tab.block)
}

/** `a` mixed toward `b` by `amount` (0 keeps `a`, 1 is `b`), both `#rgb` or `#rrggbb`: a site's
 * colour, paled into a tile's. */
export function mix(a: string, b: string, amount: number): string {
  const rgb = (hex: string): [number, number, number] => {
    const text = hex.replace("#", "").slice(0, 6)
    const full = text.length === 3 ? text.split("").map((c) => c + c).join("") : text
    const n = Number.parseInt(full, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  const k = Math.min(1, Math.max(0, amount))
  const part = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, "0")
  return `#${part(r1, r2)}${part(g1, g2)}${part(b1, b2)}`
}
