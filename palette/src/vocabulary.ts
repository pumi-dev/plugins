// The commands the palette lists, built from what a package can see. The core palette is handed the
// app's every action, with its keys, by the host (`{type:"actions"}`); a package is not, so the list
// is put together from the two places the app publishes its vocabulary:
//
//   menu.list("")  every menu the app and the packages put up — the header's buttons, a pane's strip,
//                  the menu bar's menus — each item with its label, its key and what it runs
//   key.list("")   every key table: the host's prefix keys, the packages' (a manifest's `keys` land
//                  in `root`), each binding with the function it calls and what it is for. The key
//                  tables have no noun in the SDK; it is a call, as a plugin's own keys are.
//
// What is listed is what can be run from here: a menu item is run with `menu.exec`, a binding by
// calling the function it holds. A menu item that opens a block of the app's own (`open`) has no
// way in from a package, and a binding to a command line needs the tmux package to run it, so
// neither is listed — see the report.
import { call, menu, option, pane, type PlaceSpec } from "pumi";
import { humanizeActionName } from "./score.ts";

/** A menu item, as `menu.list` says it (the host's `Menu`). */
interface MenuItem {
  name: string;
  label?: string | null;
  keys?: string | null;
  desc?: string | null;
  enabled?: boolean;
  children?: MenuItem[] | null;
  rhs?: string | null;
  call?: { call: string; args?: unknown } | null;
  callback?: unknown;
  open?: Open | null;
}

/** A block a menu item shows instead of running anything: its id, and how big. */
interface Open {
  view: string;
  args?: unknown;
  width?: number | null;
  height?: number | null;
  kind?: string | null;
}

/** A command the palette can run. */
export interface Action {
  /** What it is called: a menu path, or the name of the function it calls. Stable between runs, so
   * the count of how often it ran and its row's id outlive a restart. */
  name: string;
  /** What the row says. */
  label: string;
  /** The keys it answers to, as the app writes a chord (`cmd+shift+p`). */
  keys: string[];
  /** Where it is bound, when that is not the table with no prefix (`root`). */
  context: string | null;
  run(): Promise<unknown>;
}

/** Every command there is, by name. */
export async function vocabulary(): Promise<Action[]> {
  const actions: Action[] = [];
  const byCall = new Map<string, Action>();
  for (const item of await tree()) collect(item, [], actions, byCall);
  const prefix = await prefixChord();
  for (const binding of await bindings()) {
    const name = binding.call?.call;
    if (name === undefined || name === "") continue;
    // A menu item that runs the same function with the same arguments is the better row: it knows
    // its own label. The key it is also bound to goes on that row.
    const already = byCall.get(signature(name, binding.call?.args));
    if (already !== undefined) {
      const chord = prettyChord(binding.key);
      if (chord !== "" && !already.keys.includes(chord)) already.keys.push(chord);
      continue;
    }
    const chord = prettyChord(binding.key);
    // A key in the prefix table is the prefix and then the key (tmux's `C-b c`).
    const keys = chord === "" ? [] : [binding.table === "prefix" ? `${prefix} ${chord}` : chord];
    const action: Action = {
      name,
      label: binding.desc ?? humanizeActionName(name),
      keys,
      context: binding.table === "root" ? null : binding.table,
      run: () => invoke(name, binding.call?.args),
    };
    actions.push(action);
    byCall.set(signature(name, binding.call?.args), action);
  }
  actions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return actions;
}

/** What a call names, arguments and all: two handlers of one function are two commands. */
function signature(name: string, args: unknown): string {
  return args === undefined || args === null ? name : `${name} ${JSON.stringify(args)}`;
}

/** The prefix key, as a person reads it (`ctrl+b`), which the prefix table's keys follow. */
async function prefixChord(): Promise<string> {
  try {
    const said = await option.get("prefix");
    return typeof said === "string" && said !== "" ? prettyChord(said) : "ctrl+b";
  } catch {
    return "ctrl+b";
  }
}

/** The menu tree, or nothing when the host has none yet. */
async function tree(): Promise<MenuItem[]> {
  try {
    return (await menu.list("")) as MenuItem[];
  } catch {
    return [];
  }
}

/** A key binding, as `key.list` says it (the host's `Binding`): the table and key it is, and what
 * it runs. */
interface Binding {
  table: string;
  key: string;
  desc?: string | null;
  call?: { call: string; args?: unknown } | null;
}

/** The key tables, or nothing. */
async function bindings(): Promise<Binding[]> {
  try {
    return (await call("key.list", "")) as Binding[];
  } catch {
    return [];
  }
}

/** Walks a menu, adding a leaf an action and descending into anything else. A separator (`-name-`)
 * and an item that is greyed out are not commands. */
function collect(item: MenuItem, above: string[], into: Action[], byCall: Map<string, Action>): void {
  if (item.children !== null && item.children !== undefined && item.children.length > 0) {
    const path = [...above, item.name];
    for (const child of item.children) collect(child, path, into, byCall);
    return;
  }
  const name = item.name ?? "";
  if (name === "" || isSeparator(name) || item.enabled === false) return;
  // A menu this package put up, a pane's strip button, the menu bar's: the same tree from here up.
  const path = [...above, name];
  const open = item.open ?? null;
  const action: Action = {
    name: path.join("."),
    label: item.label ?? name,
    keys: item.keys === null || item.keys === undefined || item.keys === "" ? [] : [item.keys],
    context: above[0] ?? null,
    // An item that opens a block is not `menu.exec`'s to run ("the app shows it where it was
    // chosen"), so the block is opened here instead: as a float over the tab, which is as close to
    // the app's popover as a package gets.
    run: () => (open === null ? menu.exec(escapePath(path)) : shown(open)),
  };
  into.push(action);
  if (item.call?.call !== undefined) byCall.set(signature(item.call.call, item.call.args), action);
}

/** Opens the block a menu item shows, over the tab, at about the size the item asked for. */
async function shown(open: Open): Promise<unknown> {
  const place: PlaceSpec = { kind: "float" };
  if (typeof open.width === "number") place.width = `${open.width}px`;
  if (typeof open.height === "number") place.height = `${open.height}px`;
  return pane.open(open.view, open.args ?? {}, place);
}

/** A menu's separator: `-name-`. */
function isSeparator(name: string): boolean {
  return name.length > 2 && name.startsWith("-") && name.endsWith("-");
}

/** A menu path as `menu.exec` takes it: a dot in a name is escaped, a dot is a step down. */
function escapePath(path: string[]): string {
  return path.map((part) => part.replace(/\./g, "\\.")).join(".");
}

/** Calls a function a binding holds, with the arguments it was given: a list of them in order, or
 * one object, as the binding wrote them. */
function invoke(name: string, args: unknown): Promise<unknown> {
  if (Array.isArray(args)) return call(name, ...args);
  if (args === undefined || args === null) return call(name);
  return call(name, args);
}

/** The names of keys in the tables' notation, and how the app writes the same key. */
const NAMES: Record<string, string> = {
  enter: "enter",
  cr: "enter",
  return: "enter",
  escape: "escape",
  esc: "escape",
  tab: "tab",
  btab: "shift+tab",
  space: "space",
  bspace: "backspace",
  bs: "backspace",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  home: "home",
  end: "end",
  ppage: "pageup",
  npage: "pagedown",
  dc: "delete",
  ic: "insert",
  bar: "|",
  bslash: "\\",
};

/** A binding's key as the app writes a chord: `<D-S-p>` is `cmd+shift+p`, and a sequence keeps its
 * space (`<C-b> c` is `ctrl+b c`). */
export function prettyChord(key: string): string {
  return key
    .split(/\s+/)
    .filter((chord) => chord !== "")
    .map(one)
    .join(" ");
}

function one(chord: string): string {
  let rest = chord.length > 2 && chord.startsWith("<") && chord.endsWith(">") ? chord.slice(1, -1) : chord;
  const mods = new Set<string>();
  while (rest.length > 2 && rest[1] === "-") {
    const tag = rest[0]!.toUpperCase();
    if (tag === "C") mods.add("ctrl");
    else if (tag === "M" || tag === "A") mods.add("alt");
    else if (tag === "S") mods.add("shift");
    else if (tag === "D") mods.add("cmd");
    else break;
    rest = rest.slice(2);
  }
  let name = NAMES[rest.toLowerCase()] ?? rest;
  // The tables write a shifted letter as a capital (`<D-S-p>` is `D-P`); the app spells out the
  // shift, so `<D-P>` reads as `cmd+shift+p` and `<D-p>` as `cmd+p`, as the keymap page has them.
  if (Array.from(name).length === 1 && /[A-Z]/.test(name)) {
    mods.add("shift");
    name = name.toLowerCase();
  }
  const parts = ["ctrl", "alt", "shift", "cmd"].filter((mod) => mods.has(mod));
  parts.push(name.toLowerCase());
  return parts.join("+");
}
