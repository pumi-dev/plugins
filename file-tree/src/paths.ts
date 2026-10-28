// How entries sort in the tree. Two names compare naturally (a digit
// run is a number, so `file2.rs` comes before `file10.rs`), and two paths compare component by
// component with directories first — the project panel's order, the only one it asks for.
import * as rel from "./relpath.ts";

/** Which comes first among a directory and a file. */
export type SortMode = "directoriesFirst" | "mixed" | "filesFirst";
/** How names of different case and script order. */
export type SortOrder = "default" | "upper" | "lower" | "unicode";

/** The project panel's own: directories first, names naturally. */
export const PANEL_MODE: SortMode = "directoriesFirst";
export const PANEL_ORDER: SortOrder = "default";

/** Compares two runs of digits the way a person does: `2` before `10`, `1` before `01`. */
function compareNumericSegments(a: string[], ai: number, b: string[], bi: number): [number, number, number] {
  let aNum = "";
  let bNum = "";
  while (ai < a.length && a[ai]! >= "0" && a[ai]! <= "9") aNum += a[ai++];
  while (bi < b.length && b[bi]! >= "0" && b[bi]! <= "9") bNum += b[bi++];
  if (aNum.length !== bNum.length) {
    const av = Number(aNum);
    const bv = Number(bNum);
    if (!Number.isNaN(av) && !Number.isNaN(bv) && av !== bv) return [Math.sign(av - bv), ai, bi];
    return [aNum.length - bNum.length, ai, bi];
  }
  return [aNum < bNum ? -1 : aNum > bNum ? 1 : 0, ai, bi];
}

/** A name compared naturally; names that are the same but for case fall back the other way round. */
export function naturalSort(a: string, b: string): number {
  const as = [...a];
  const bs = [...b];
  let ai = 0;
  let bi = 0;
  for (;;) {
    const ca = as[ai];
    const cb = bs[bi];
    if (ca === undefined && cb === undefined) return b < a ? -1 : b > a ? 1 : 0;
    if (ca === undefined) return -1;
    if (cb === undefined) return 1;
    if (ca >= "0" && ca <= "9" && cb >= "0" && cb <= "9") {
      const [order, nextA, nextB] = compareNumericSegments(as, ai, bs, bi);
      if (order !== 0) return order;
      ai = nextA;
      bi = nextB;
      continue;
    }
    const lower = (c: string) => c.toLowerCase();
    const la = lower(ca);
    const lb = lower(cb);
    if (la === lb) {
      ai++;
      bi++;
      continue;
    }
    return la < lb ? -1 : 1;
  }
}

function naturalSortNoTiebreak(a: string, b: string): number {
  return a.toLowerCase() === b.toLowerCase() ? 0 : naturalSort(a, b);
}

/** A file name split at its last dot: `main.rs` is `main` and `rs`. */
function stemAndExtension(name: string): [string | null, string | null] {
  if (name === "") return [null, null];
  const at = name.lastIndexOf(".");
  if (at < 0) return [name, null];
  return name.slice(0, at) === "" ? [name, null] : [name.slice(0, at), name.slice(at + 1)];
}

function caseGroupKey(name: string, order: SortOrder): number {
  const first = [...name][0];
  if (first === undefined) return 0;
  const lower = first !== first.toUpperCase();
  const upper = first !== first.toLowerCase();
  if (order === "upper") return lower ? 1 : 0;
  if (order === "lower" && upper) return 1;
  return 0;
}

function compareStrings(a: string, b: string, order: SortOrder): number {
  if (order === "unicode") return a < b ? -1 : a > b ? 1 : 0;
  return naturalSort(a, b);
}

function compareStringsNoTiebreak(a: string, b: string, order: SortOrder): number {
  if (order === "unicode") return a < b ? -1 : a > b ? 1 : 0;
  return naturalSortNoTiebreak(a, b);
}

/** Two paths, each with whether its own last component is a file: the order the panel lists them. */
export function compareRelPaths(
  a: { rel: string; isFile: boolean },
  b: { rel: string; isFile: boolean },
  mode: SortMode = PANEL_MODE,
  order: SortOrder = PANEL_ORDER,
): number {
  const needsFinalTiebreak = mode !== "directoriesFirst" && !(a.rel === b.rel);
  const as = rel.components(a.rel);
  const bs = rel.components(b.rel);
  let ai = 0;
  let bi = 0;
  for (;;) {
    const ca = as[ai];
    const cb = bs[bi];
    if (ca !== undefined && cb !== undefined) {
      const aLeafFile = a.isFile && ai === as.length - 1;
      const bLeafFile = b.isFile && bi === bs.length - 1;
      const fileDir =
        mode === "directoriesFirst" ? Number(aLeafFile) - Number(bLeafFile) : mode === "filesFirst" ? Number(bLeafFile) - Number(aLeafFile) : 0;
      if (fileDir !== 0) return fileDir;
      const [aStem, aExt] = aLeafFile ? stemAndExtension(ca) : [null, null];
      const [bStem, bExt] = bLeafFile ? stemAndExtension(cb) : [null, null];
      const aName = aLeafFile ? aStem : ca;
      const bName = bLeafFile ? bStem : cb;
      let nameCmp = caseGroupKey(aName!, order) - caseGroupKey(bName!, order);
      if (nameCmp === 0) {
        nameCmp = mode === "directoriesFirst" ? compareStrings(aName!, bName!, order) : compareStringsNoTiebreak(aName!, bName!, order);
      }
      if (nameCmp === 0 && mode === "mixed" && aLeafFile !== bLeafFile && aName!.toLowerCase() === bName!.toLowerCase()) {
        nameCmp = aLeafFile ? 1 : -1;
      }
      if (nameCmp === 0 && aLeafFile && bLeafFile) {
        const aExtText = order === "unicode" ? (aExt ?? "") : (aExt ?? "").toLowerCase();
        const bExtText = order === "unicode" ? (bExt ?? "") : (bExt ?? "").toLowerCase();
        nameCmp = aExtText < bExtText ? -1 : aExtText > bExtText ? 1 : 0;
      }
      if (nameCmp !== 0) return nameCmp;
      ai++;
      bi++;
      continue;
    }
    if (ca !== undefined) return 1;
    if (cb !== undefined) return -1;
    return needsFinalTiebreak ? compareStrings(a.rel, b.rel, order) : 0;
  }
}
