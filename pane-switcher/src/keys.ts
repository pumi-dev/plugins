// The keys the switcher answers: what the window says was pressed, as the app's chord (`alt+tab`,
// `ctrl+n`), and what the switcher does about it. A chord is a string and what it means is the
// package's, so this is read without the app.

/** What a key does: move the highlight, take the card, close it, or pick card `go`. */
export type Action = "previous" | "next" | "first" | "last" | "pick" | "close" | { go: number };

/** The chords that move the highlight back, and on, as a task switcher's do. */
const PREVIOUS = new Set(["left", "up", "ctrl+p", "ctrl+k", "shift+tab", "alt+shift+tab", "ctrl+shift+tab"]);
const NEXT = new Set(["right", "down", "tab", "alt+tab", "ctrl+tab", "ctrl+n", "ctrl+j"]);

/** The names a key binding gives the keys that are not a letter, as the chords have them. */
const NAMED: Record<string, string> = {
  enter: "enter",
  return: "enter",
  escape: "escape",
  esc: "escape",
  tab: "tab",
  space: "space",
  bspace: "backspace",
  backspace: "backspace",
  dc: "delete",
  delete: "delete",
  ic: "insert",
  insert: "insert",
  home: "home",
  end: "end",
  ppage: "pageup",
  pageup: "pageup",
  npage: "pagedown",
  pagedown: "pagedown",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  minus: "minus",
  equal: "equal",
  plus: "plus",
  slash: "slash",
};

/** The modifiers a key binding writes, in the order a chord puts them. */
const MODIFIERS: [string, string][] = [
  ["C", "ctrl"],
  ["M", "alt"],
  ["A", "alt"],
  ["S", "shift"],
  ["D", "cmd"],
];

/** The modifiers a chord puts them in. */
const ORDER = ["ctrl", "alt", "shift", "cmd"];

/** A key and the modifiers held with it as the app's chord: `alt+tab`, `shift+tab`, `ctrl+n`. */
export function chord(
  key: string | undefined,
  modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean; cmd?: boolean } | null,
): string {
  const name = (key ?? "").toLowerCase();
  const held = [modifiers?.ctrl && "ctrl", modifiers?.alt && "alt", modifiers?.shift && "shift", modifiers?.cmd && "cmd"];
  const mods = held.filter((mod): mod is string => !!mod);
  return mods.length ? `${mods.join("+")}+${name}` : name;
}

/** A key binding's key (`<M-Tab>`, `<C-Space>`) as a chord (`alt+tab`), or `undefined` when it is
 * a sequence of them, which is no one press to watch for. */
export function fromTrigger(spec: string): string | undefined {
  let rest = spec.trim().replace(/^</, "").replace(/>$/, "");
  if (rest === "" || /\s/.test(rest)) return undefined;
  const mods = new Set<string>();
  while (rest.length > 2 && rest[1] === "-") {
    const mod = MODIFIERS.find(([letter]) => letter === rest[0]!.toUpperCase())?.[1];
    if (!mod) break;
    mods.add(mod);
    rest = rest.slice(2);
  }
  let name = NAMED[rest.toLowerCase()] ?? rest.toLowerCase();
  // A capital says the shift, as a binding writes a shifted letter (`<C-S-r>`).
  if (name.length === 1 && /[A-Z]/.test(rest)) {
    mods.add("shift");
    name = name.toLowerCase();
  }
  const order = ORDER.filter((mod) => mods.has(mod));
  return order.length ? `${order.join("+")}+${name}` : name;
}

/** A digit chord as the card it picks (`1` is the first), for a quick pick. */
export function digit(typed: string): number | undefined {
  if (typed.length !== 1) return undefined;
  const n = Number(typed);
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : undefined;
}

/** What the switcher does with `typed`: `undefined` for a key it does not take. `trigger` is the
 * chord that opens it, which moves the highlight on when it is already up. */
export function keyed(typed: string, trigger?: string): Action | undefined {
  if (typed === "enter" || typed === "return") return "pick";
  if (PREVIOUS.has(typed)) return "previous";
  if (NEXT.has(typed) || typed === trigger) return "next";
  if (typed === "home") return "first";
  if (typed === "end") return "last";
  if (typed === "x") return "close";
  const picked = digit(typed);
  return picked === undefined ? undefined : { go: picked };
}
