// What the palette remembers between openings, and between runs: how often each command ran (so a
// command the user reaches for often comes first among equals), the queries that ran (so ↑ can
// bring one back), and the files opened lately (so an empty search leads with them). The core keeps
// them in `~/.config/pumi/palette.json`; a package keeps the same three fields in its own storage,
// which the server holds, so they survive the plugin host moving to another app.
import { storage } from "pumi";

/** How many queries ↑ walks back through. */
export const MAX_HISTORY = 50;
/** How many files an empty search leads with. */
export const MAX_RECENT_FILES = 100;

/** The key it is kept under, which no other package's storage can reach. */
const KEY = "palette";

export interface Store {
  /** How often each command ran, by its name. */
  used: Record<string, number>;
  /** The queries that ran, oldest first. */
  history: string[];
  /** The files opened, most recent first, as paths. */
  files: string[];
}

export const EMPTY: Store = { used: {}, history: [], files: [] };

/** The store as it was kept, or nothing: a field of the wrong shape is left out, as the core leaves
 * out what it cannot read. */
function parse(value: unknown): Store {
  const object = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const used: Record<string, number> = {};
  const raw = object.used;
  if (raw !== null && typeof raw === "object") {
    for (const [name, count] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof count === "number" && Number.isFinite(count)) used[name] = count;
    }
  }
  const strings = (field: unknown) =>
    Array.isArray(field) ? field.filter((each): each is string => typeof each === "string") : [];
  return { used, history: strings(object.history), files: strings(object.files) };
}

/** The store as it stands. */
export async function load(): Promise<Store> {
  try {
    return parse(await storage.get(KEY));
  } catch {
    return { used: {}, history: [], files: [] };
  }
}

/** Keeps the store. A failure to keep it is not one the user has to hear about: the palette works
 * without its history, it just forgets it. */
export async function save(store: Store): Promise<void> {
  try {
    await storage.set(KEY, { used: store.used, history: store.history.slice(-MAX_HISTORY), files: store.files.slice(0, MAX_RECENT_FILES) });
  } catch (err) {
    console.error(`palette: keeping its history failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** How often `name` has run. */
export function used(store: Store, name: string): number {
  return store.used[name] ?? 0;
}

/** A query that ran: it goes last, where ↑ finds it first, and the oldest falls off. */
export function remember(store: Store, query: string): void {
  const at = store.history.indexOf(query);
  if (at >= 0) store.history.splice(at, 1);
  store.history.push(query);
  if (store.history.length > MAX_HISTORY) store.history.splice(0, store.history.length - MAX_HISTORY);
}

/** A file that was opened: it goes first, and the oldest falls off. */
export function recent(store: Store, path: string): void {
  const at = store.files.indexOf(path);
  if (at >= 0) store.files.splice(at, 1);
  store.files.unshift(path);
  if (store.files.length > MAX_RECENT_FILES) store.files.length = MAX_RECENT_FILES;
}
