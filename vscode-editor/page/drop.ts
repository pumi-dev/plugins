// What a drop onto the editor carries, as paths: the app's own drag (`application/x-pumi+json`, the
// project tree's `{ path }`, a list of them, a bare path) or a `text/uri-list` of `file://` URLs.
// Pure, so the tests read it without a page.

/** The paths in a drag's data, by its type: `get("text/uri-list")`, as a `DataTransfer` answers. */
export function droppedPaths(get: (type: string) => string): string[] {
  const own = fromPumi(get(PUMI));
  if (own.length) return own;
  return fromUriList(get(URIS));
}

/**
 * Whether the editor takes a drag passing over it (`dragover`): one of the app's that carries a
 * path (not a tab being moved, whose drop is a split), or a list of URLs with a file in
 * it. The system's own drags can't be read until they drop, so one with a URL list is taken.
 */
export function takesDrag(types: readonly string[], get: (type: string) => string): boolean {
  const own = types.includes(PUMI) ? get(PUMI) : "";
  if (own !== "") return fromPumi(own).length > 0;
  if (!types.includes(URIS)) return false;
  const list = get(URIS);
  return list === "" || fromUriList(list).length > 0;
}

const PUMI = "application/x-pumi+json";
const URIS = "text/uri-list";

function fromPumi(text: string): string[] {
  if (!text) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const each = (value: unknown): string[] => {
    if (typeof value === "string") return value.startsWith("/") ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(each);
    if (value === null || typeof value !== "object") return [];
    const at = value as { path?: unknown; paths?: unknown; file?: unknown };
    return [...each(at.path ?? at.file), ...each(at.paths)];
  };
  return each(data);
}

function fromUriList(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("file://"))
    .flatMap((line) => {
      try {
        const url = new URL(line);
        return url.host === "" || url.host === "localhost" ? [decodeURIComponent(url.pathname)] : [];
      } catch {
        return [];
      }
    });
}
