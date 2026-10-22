// The fuzzy scoring the core palette gets from the `nucleo` crate, written out here: a package
// cannot have a Rust dependency, so nucleo's constants, its bonuses and its arithmetic live in this
// file instead. The same matcher means `sv` still finds `split vertical`, `zoom` still beats
// `zoom_in`, and a file's name still counts for more than its directory.
//
// nucleo reads a haystack into characters with a class, gives each a bonus for where it is (the
// start of a word, a camel hump, a number after a letter), scores a match 16 a character, and takes
// back 3 for opening a gap and 1 for each further character in it. Two alignments are possible in
// general; `optimal` finds the best one with a table, and `aligned` is the linear one that answers
// for a haystack too wide for a table. The palette's own part is at the bottom: what a search of the
// query does to the answer (SMART_CASE_PENALTY, LENGTH_PENALTY) and how an action's name reads.
//
// What is not ported, and cannot be: nucleo's unicode tables. A needle and a haystack are compared
// character by character after `toLowerCase`, so a label matches across case but not across
// accents. Labels, actions and paths are ASCII in practice.

/** nucleo's `score.rs`: a match is worth this, and a gap costs that. */
const SCORE_MATCH = 16;
const PENALTY_GAP_START = 3;
const PENALTY_GAP_EXTENSION = 1;
/** The bonus for matching at the start of a word, and the two flavours of it. */
const BONUS_BOUNDARY = SCORE_MATCH / 2;
const BONUS_BOUNDARY_WHITE = BONUS_BOUNDARY + 2;
const BONUS_BOUNDARY_DELIMITER = BONUS_BOUNDARY + 1;
/** `fooBar`, `foo2`: a hump, or a number after something that is not one. */
const BONUS_CAMEL123 = BONUS_BOUNDARY - PENALTY_GAP_START;
const BONUS_NON_WORD = BONUS_BOUNDARY;
/** Every character but the first of a run earns at least this. */
const BONUS_CONSECUTIVE = PENALTY_GAP_START + PENALTY_GAP_EXTENSION;
/** The needle's first character counts double where it lands, so `to-go` beats `ongoing` on `og`. */
const BONUS_FIRST_CHAR_MULTIPLIER = 2;

/** The most rows a search shows (the core's `MAX_ROWS`). */
export const MAX_ROWS = 200;
/** A label keeps a little of its length against it, so the short name wins. */
export const LENGTH_PENALTY = 0.01;
/** And a match that ignored a capital the query typed keeps a little less of its score. */
export const SMART_CASE_PENALTY = 0.9;

/** A character's class, as nucleo's `CharClass`. The order matters: `delimiter` and above are word
 * characters, so a match there is a match at a word's start. */
const CLASS = { whitespace: 0, nonWord: 1, delimiter: 2, lower: 3, upper: 4, letter: 5, number: 6 } as const;
type CharClass = (typeof CLASS)[keyof typeof CLASS];

/** How a haystack is read: nucleo's `Config`. */
export interface Config {
  /** The characters a word's start can follow (`/,:;|` for a label). */
  readonly delimiters: string;
  /** What a word's start after whitespace earns. */
  readonly bonusWhitespace: number;
  /** What the first character follows: whitespace, so the string's own start is a word's. */
  readonly initial: CharClass;
}

/** nucleo's `Config::DEFAULT`: an action's label, or a line of text. */
export const DEFAULT: Config = { delimiters: "/,:;|", bonusWhitespace: BONUS_BOUNDARY_WHITE, initial: CLASS.whitespace };
/** nucleo's `Config::match_paths()`: a file's path, where `/` is the only word break. */
export const PATHS: Config = { delimiters: "/", bonusWhitespace: BONUS_BOUNDARY, initial: CLASS.delimiter };

/** What a match found: what it is worth, and where it matched (character indices into the haystack). */
export interface Match {
  readonly score: number;
  readonly marks: number[];
}

/** A character's class. */
function klass(char: string, config: Config): CharClass {
  const code = char.charCodeAt(0);
  if (char.length === 1 && code < 128) {
    if (code >= 97 && code <= 122) return CLASS.lower;
    if (code >= 65 && code <= 90) return CLASS.upper;
    if (code >= 48 && code <= 57) return CLASS.number;
    if (char === " " || (code >= 9 && code <= 13)) return CLASS.whitespace;
    return config.delimiters.includes(char) ? CLASS.delimiter : CLASS.nonWord;
  }
  const lower = char.toLowerCase();
  const upper = char.toUpperCase();
  if (lower === char && upper !== char) return CLASS.lower;
  if (upper === char && lower !== char) return CLASS.upper;
  if (/\p{N}/u.test(char)) return CLASS.number;
  if (/\p{L}/u.test(char)) return CLASS.letter;
  if (/\s/u.test(char)) return CLASS.whitespace;
  return CLASS.nonWord;
}

/** What matching a character of kind `kind` after one of kind `prev` earns. */
function bonusFor(prev: CharClass, kind: CharClass, config: Config): number {
  if (kind > CLASS.delimiter) {
    if (prev === CLASS.whitespace) return config.bonusWhitespace;
    if (prev === CLASS.delimiter) return BONUS_BOUNDARY_DELIMITER;
    if (prev === CLASS.nonWord) return BONUS_BOUNDARY;
  }
  if ((prev === CLASS.lower && kind === CLASS.upper) || (prev !== CLASS.number && kind === CLASS.number)) {
    return BONUS_CAMEL123;
  }
  if (kind === CLASS.whitespace) return config.bonusWhitespace;
  if (kind === CLASS.nonWord) return BONUS_NON_WORD;
  return 0;
}

/** `text` read the way the matcher reads it: its characters as they compare, and the bonus each
 * earns where it is. */
interface Hay {
  readonly folded: readonly string[];
  readonly bonus: readonly number[];
}

/** A character as it compares: lower case, and still one character. */
function fold(char: string): string {
  const lower = char.toLowerCase();
  return lower.length === char.length ? lower : char;
}

function read(text: string, config: Config): Hay {
  const chars = Array.from(text);
  const bonus: number[] = [];
  let prev = config.initial;
  for (const char of chars) {
    const kind = klass(char, config);
    bonus.push(bonusFor(prev, kind, config));
    prev = kind;
  }
  return { folded: chars.map(fold), bonus };
}

/** Where `needle`'s characters can be, as nucleo's prefilter finds them: the first occurrence of
 * its first character, the end of the leftmost match, and the last place its last character can
 * be — the window every alignment lives in. `null` when the characters are not all there. */
function windowOf(hay: Hay, needle: readonly string[]): { start: number; greedyEnd: number; end: number } | null {
  const chars = hay.folded;
  let start = -1;
  for (let at = 0; at <= chars.length - needle.length; at++) {
    if (chars[at] === needle[0]) {
      start = at;
      break;
    }
  }
  if (start < 0) return null;
  let greedyEnd = start + 1;
  for (let i = 1; i < needle.length; i++) {
    let at = greedyEnd;
    while (at < chars.length && chars[at] !== needle[i]) at++;
    if (at === chars.length) return null;
    greedyEnd = at + 1;
  }
  let end = greedyEnd;
  for (let at = chars.length - 1; at >= greedyEnd; at--) {
    if (chars[at] === needle[needle.length - 1]) {
      end = at + 1;
      break;
    }
  }
  return { start, greedyEnd, end };
}

/** nucleo's `calculate_score`: what one alignment of `needle` in `hay[start, end)` is worth, taking
 * the characters in the order it meets them. `marks` collects them if it is given. */
function aligned(hay: Hay, needle: readonly string[], start: number, end: number, marks: number[] = []): number {
  let at = start;
  marks.push(at);
  let firstBonus = hay.bonus[at]!;
  let score = SCORE_MATCH + firstBonus * BONUS_FIRST_CHAR_MULTIPLIER;
  for (let i = 1; i < needle.length; i++) {
    let found = at + 1;
    while (found < end && hay.folded[found] !== needle[i]) found++;
    if (found === end) break;
    // What the gap to it costs: opening one, then a little for each character in it.
    if (found > at + 1) score -= PENALTY_GAP_START + PENALTY_GAP_EXTENSION * (found - at - 2);
    let bonus = hay.bonus[found]!;
    if (found === at + 1) {
      if (bonus >= BONUS_BOUNDARY && bonus > firstBonus) firstBonus = bonus;
      bonus = Math.max(Math.max(bonus, firstBonus), BONUS_CONSECUTIVE);
    } else {
      firstBonus = bonus;
    }
    score += SCORE_MATCH + bonus;
    marks.push(found);
    at = found;
  }
  return score;
}

/** The widest table `optimal` builds: past this the linear alignment answers instead, as nucleo
 * falls back when its slab is full. */
const WIDEST = 4096;

/** nucleo's `fuzzy_match_optimal`: the best alignment there is, by a table over the window. */
function optimal(hay: Hay, needle: readonly string[]): Match | null {
  const found = windowOf(hay, needle);
  if (found === null) return null;
  const { start, greedyEnd, end } = found;
  if (needle.length === end - start) {
    // Nothing to choose: the window is the match.
    const marks: number[] = [];
    return { score: aligned(hay, needle, start, end, marks), marks };
  }
  if ((end - start) * needle.length > WIDEST) {
    const marks: number[] = [];
    return { score: aligned(hay, needle, start, greedyEnd, marks), marks };
  }
  const width = end - start;
  const rows = needle.length;
  // matched[i][j]: the best score of needle[0..=i] with needle[i] at column j; past[i][j]: the
  // same with needle[i] anywhere at or before j, the gap to j paid for; run[i][j]: the consecutive
  // bonus the run ending at (i, j) carries; from[i][j]: the column needle[i-1] took to make it,
  // and at[i][j]: the column that made past[i][j].
  const matched: number[][] = [];
  const past: number[][] = [];
  const run: number[][] = [];
  const from: number[][] = [];
  const at: number[][] = [];
  for (let i = 0; i < rows; i++) {
    matched.push(new Array<number>(width).fill(NaN));
    past.push(new Array<number>(width).fill(0));
    run.push(new Array<number>(width).fill(0));
    from.push(new Array<number>(width).fill(-1));
    at.push(new Array<number>(width).fill(-1));
  }
  for (let j = 0; j < width; j++) {
    if (hay.folded[start + j] === needle[0]) {
      const bonus = hay.bonus[start + j]!;
      matched[0]![j] = SCORE_MATCH + bonus * BONUS_FIRST_CHAR_MULTIPLIER;
      run[0]![j] = bonus;
      from[0]![j] = j;
    }
    const carried = j === 0 ? 0 : past[0]![j - 1]! - PENALTY_GAP_EXTENSION;
    const here = Number.isNaN(matched[0]![j]!) ? -Infinity : matched[0]![j]!;
    if (here >= carried) {
      past[0]![j] = here === -Infinity ? carried : here;
      at[0]![j] = here === -Infinity ? -1 : j;
    } else {
      past[0]![j] = carried;
      at[0]![j] = at[0]![j - 1]!;
    }
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < width; j++) {
      const bonus = hay.bonus[start + j]!;
      const crossed = matched[i - 1]![j - 1]!;
      // The gap into column j: from the row above's best, an opening or an extension.
      const gap = Math.max(
        (Number.isNaN(crossed) ? 0 : crossed) - PENALTY_GAP_START,
        past[i - 1]![j - 1]! - PENALTY_GAP_EXTENSION,
      );
      if (hay.folded[start + j] === needle[i]) {
        if (Number.isNaN(crossed)) {
          matched[i]![j] = gap + bonus + SCORE_MATCH;
          run[i]![j] = bonus;
          from[i]![j] = at[i - 1]![j - 1]!;
        } else {
          let consecutive = Math.max(run[i - 1]![j - 1]!, BONUS_CONSECUTIVE);
          if (bonus >= BONUS_BOUNDARY && bonus > consecutive) consecutive = bonus;
          const keep = crossed + Math.max(consecutive, bonus);
          const skip = gap + bonus;
          if (keep > skip) {
            matched[i]![j] = keep + SCORE_MATCH;
            run[i]![j] = consecutive;
            from[i]![j] = j - 1;
          } else {
            matched[i]![j] = skip + SCORE_MATCH;
            run[i]![j] = bonus;
            from[i]![j] = at[i - 1]![j - 1]!;
          }
        }
      }
      const carried = past[i]![j - 1]! - PENALTY_GAP_EXTENSION;
      const here = Number.isNaN(matched[i]![j]!) ? -Infinity : matched[i]![j]!;
      if (here >= carried) {
        past[i]![j] = here === -Infinity ? carried : here;
        at[i]![j] = here === -Infinity ? at[i]![j - 1]! : j;
      } else {
        past[i]![j] = carried;
        at[i]![j] = at[i]![j - 1]!;
      }
    }
  }
  let best = -1;
  let score = -Infinity;
  for (let j = 0; j < width; j++) {
    const value = matched[rows - 1]![j]!;
    if (!Number.isNaN(value) && value > score) {
      score = value;
      best = j;
    }
  }
  if (best < 0) return null;
  const marks: number[] = [];
  for (let i = rows - 1, j = best; i >= 0 && j >= 0; i--) {
    marks.push(start + j);
    j = from[i]![j]!;
  }
  marks.reverse();
  return { score, marks };
}

/** The words a query is made of: nucleo's `Pattern` matches each one on its own, in any order, and
 * all of them have to be there. */
function atoms(query: string): string[] {
  return query
    .split(/\s+/)
    .filter((atom) => atom !== "")
    .map((atom) => Array.from(atom, fold).join(""));
}

/** Whether every word's characters are in `text`, in order: what `optimal` would find, asked
 * cheaply. A search asks it of every candidate, and the reading and the table are the cost. */
function couldMatch(text: string, words: readonly string[]): boolean {
  const folded = text.toLowerCase();
  for (const word of words) {
    let at = 0;
    for (const char of word) {
      at = folded.indexOf(char, at);
      if (at < 0) return false;
      at += 1;
    }
  }
  return true;
}

/** What `query` finds in `text`, or `null`. Each of its words is matched on its own; the score is
 * their sum and the marks are theirs together. */
export function match(text: string, query: string, config: Config = DEFAULT): Match | null {
  const words = atoms(query);
  if (words.length === 0) return { score: 0, marks: [] };
  if (!couldMatch(text, words)) return null;
  const hay = read(text, config);
  let score = 0;
  const marks: number[] = [];
  for (const word of words) {
    const found = optimal(hay, Array.from(word));
    if (found === null) return null;
    score += found.score;
    marks.push(...found.marks);
  }
  return { score, marks };
}

/** What `query` finds in `text`: its score, or `null`. */
export function score(text: string, query: string, config: Config = DEFAULT): number | null {
  return match(text, query, config)?.score ?? null;
}

/** How many of the query's capitals a match ignored: `Zoom` matched by `zoom` is one. Counted only
 * when the query types any capital, and only when one character of the labels answers each. */
export function caseMismatches(query: string, marks: readonly number[], label: string): number {
  const typed = Array.from(query).filter((char) => !/\s/.test(char));
  if (!typed.some((char) => char !== char.toLowerCase())) return 0;
  if (typed.length !== marks.length) return 0;
  const chars = Array.from(label);
  let mismatches = 0;
  for (let i = 0; i < typed.length; i++) {
    const matched = chars[marks[i]!];
    const want = typed[i]!;
    if (matched === undefined || matched === want) continue;
    if (matched.toLowerCase() === want.toLowerCase()) mismatches++;
  }
  return mismatches;
}

/** What `mismatches` case mismatches take off a score. */
export function casePenalty(mismatches: number): number {
  return SMART_CASE_PENALTY ** mismatches;
}

/** What a query finds in an action's label, as the palette ranks it: the match's score, the case
 * penalty, and the label's own length against it. */
export function matchLabel(label: string, query: string): Match | null {
  const found = match(label, query);
  if (found === null) return null;
  return {
    score: found.score * casePenalty(caseMismatches(query, found.marks, label)) - Array.from(label).length * LENGTH_PENALTY,
    marks: found.marks,
  };
}

/** The spans of `text` a query matched, in order, so a row can draw them bold: `[text, marked]`. */
export function segments(text: string, marks: readonly number[]): [string, boolean][] {
  const chars = Array.from(text);
  const marked = new Set(marks);
  const out: [string, boolean][] = [];
  for (const [at, char] of chars.entries()) {
    const bold = marked.has(at);
    const last = out[out.length - 1];
    if (last !== undefined && last[1] === bold) last[0] += char;
    else out.push([char, bold]);
  }
  return out;
}

/** A query with the spelling taken out of it, as the core normalises it: `_` is a space (an action
 * is `split_vertical`), `::` is one `:` (`palette::Toggle`), and the spaces are run together. */
export function normalizeActionQuery(input: string): string {
  let out = "";
  for (const char of input.trim()) {
    if (char === "_") out += " ";
    else if (char === ":" && out.endsWith(":")) continue;
    else if (/\s/.test(char) && out.endsWith(" ")) continue;
    else out += char;
  }
  return out;
}

/** An action's name as a person reads it: `split_vertical` is `split vertical`, `palette::Toggle` is
 * `palette: toggle`, `editor::GoToDefinition` is `editor: go to definition`. Ported from the core's
 * `humanize_action_name`, which descends from Zed's. */
export function humanizeActionName(name: string): string {
  const chars = Array.from(name);
  let out = "";
  let at = 0;
  while (at < chars.length) {
    const char = chars[at]!;
    if (char === ":") {
      out += ":";
      while (chars[at] === ":") at++;
      continue;
    }
    if (char === "_") {
      out += " ";
      at++;
      continue;
    }
    if (char !== char.toUpperCase() || char.toLowerCase() === char) {
      out += char;
      at++;
      continue;
    }
    // A capital: the run of them, less the one that opens the word after it.
    let length = 0;
    while (at + length < chars.length && isUpper(chars[at + length]!)) length++;
    const opensNext = isLower(chars[at + length] ?? "");
    const acronym = length - (opensNext ? 1 : 0);
    out = spaced(out);
    out += chars.slice(at, at + acronym).join("");
    if (opensNext) {
      out = spaced(out);
      out += chars[at + acronym]!.toLowerCase();
    }
    at += length;
  }
  return out;
}

function isUpper(char: string): boolean {
  return char === char.toUpperCase() && char !== char.toLowerCase();
}
function isLower(char: string): boolean {
  return char === char.toLowerCase() && char !== char.toUpperCase();
}
function spaced(out: string): string {
  return out !== "" && !out.endsWith(" ") ? `${out} ` : out;
}
