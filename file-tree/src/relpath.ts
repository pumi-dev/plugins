// A path inside the project: `a/b/c`, `/`-separated, never absolute. Every module here speaks this one spelling of a path, and only the filesystem calls in
// `tree.ts` and `ops.ts` turn one into a path on disk.

/** The project's own row: the root, which has no components. */
export const ROOT = "";

/** Whether `rel` is one: `/etc` and `../x` are not. */
export function isRel(rel: string): boolean {
  return !rel.startsWith("/") && !rel.split("/").includes("..");
}

/** `rel`'s last component, the file's name. */
export function fileName(rel: string): string {
  const at = rel.lastIndexOf("/");
  return at < 0 ? rel : rel.slice(at + 1);
}

/** Where `rel` is, without its own name; `""` for the root's children. */
export function parent(rel: string): string {
  const at = rel.lastIndexOf("/");
  return at < 0 ? ROOT : rel.slice(0, at);
}

/** `name` inside `rel`. */
export function join(rel: string, name: string): string {
  return rel === ROOT ? name : `${rel}/${name}`;
}

/** The components of `rel`, outermost first. */
export function components(rel: string): string[] {
  return rel === ROOT ? [] : rel.split("/");
}

/** How many components `rel` has: `a/b/c` is 3. */
export function componentCount(rel: string): number {
  return components(rel).length;
}

/** `rel` itself, its parent, its grandparent, … ending with the root. */
export function ancestors(rel: string): string[] {
  const out = [rel];
  let at = rel;
  while (at !== ROOT) {
    at = parent(at);
    out.push(at);
  }
  return out;
}

/** The deepest `count` components of `rel`: `lastComponents("a/b/c", 2)` is `b/c`. */
export function lastComponents(rel: string, count: number): string | null {
  const parts = components(rel);
  return parts.length >= count ? parts.slice(parts.length - count).join("/") : null;
}

/** `main.rs` without its extension: `main`. A name with no dot, or one that is all dot and no stem
 * (`.gitignore`), is itself. */
export function fileStem(name: string): string {
  const at = name.lastIndexOf(".");
  return at > 0 ? name.slice(0, at) : name;
}

/** The extension after the last dot, or `null` (`main.rs` is `rs`; `.gitignore` has none). */
export function extension(name: string): string | null {
  const at = name.lastIndexOf(".");
  return at > 0 ? name.slice(at + 1) : null;
}

/** `auth.module.js`'s `module.js`: every part after the first dot, when there are two or more. */
export function multipleExtensions(name: string): string | null {
  const parts = name.split(".").slice(1);
  return parts.length < 2 ? null : parts.join(".");
}

/** What names a file's icon when it has no extension, or is a dotfile: `js`, `gitignore`, `LICENSE`. */
export function extensionOrHiddenFileName(name: string): string | null {
  if (name.startsWith(".")) return name.slice(1);
  return extension(name) ?? (fileStem(name) === name ? name : null);
}
