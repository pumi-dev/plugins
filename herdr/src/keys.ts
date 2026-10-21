// herdr's default keys (`herdr --default-config`'s `[keys]`), in the prefix table (`C-b`, then the
// key) while the package runs, unless `default_keys` is off. Each is a call of the API, so it needs
// no other package; what herdr binds to its own TUI (help, settings, detach, reload, the agent list,
// the sidebar, clear, reopen) has no API function and is left out. They are bound over the host's
// tmux-like defaults where the two share a key.
//
// They are bound here rather than declared in the manifest because a manifest key is mapped in the
// root table, where no key can be `default_keys`' to turn off; these wait for the prefix.
import { key, option, type Disposer } from "pumi";
import { log } from "./log.ts";
import type { Json } from "./types.ts";

/** The option that turns them off. */
export const OPTION = "default_keys";

/** One of herdr's keys: the key after the prefix, what it calls, and what it does. */
export interface Binding {
  key: string;
  call: { call: string; args: Json[] };
  desc: string;
}

function call(name: string, args: Json[]): Binding["call"] {
  return { call: name, args };
}

function split(side: string): Binding["call"] {
  return call("pane.open", ["terminal", {}, { split: side }]);
}

function select(direction: string): Binding["call"] {
  return call("pane.select", [{ direction }]);
}

function resize(direction: string): Binding["call"] {
  return call("pane.resize", [0, { direction, cells: 1 }]);
}

/** Every key, its call and what it does. */
export function bindings(): Binding[] {
  const keys: Binding[] = [
    { key: "N", call: call("session.create", [{}]), desc: "New workspace" },
    { key: "D", call: call("session.close", [0, false]), desc: "Close the workspace" },
    { key: "[", call: call("session.select", [{ offset: -1 }]), desc: "Previous workspace" },
    { key: "]", call: call("session.select", [{ offset: 1 }]), desc: "Next workspace" },
    { key: "c", call: call("pane.open", ["terminal", {}, { kind: "tab" }]), desc: "New tab" },
    { key: "p", call: call("tab.select", [{ offset: -1 }]), desc: "Previous tab" },
    { key: "n", call: call("tab.select", [{ offset: 1 }]), desc: "Next tab" },
    { key: "X", call: call("tab.close", [0, false]), desc: "Close the tab" },
    { key: "h", call: select("L"), desc: "Pane left" },
    { key: "j", call: select("D"), desc: "Pane below" },
    { key: "k", call: select("U"), desc: "Pane above" },
    { key: "l", call: select("R"), desc: "Pane right" },
    { key: "Tab", call: select("next"), desc: "Next pane" },
    { key: "BTab", call: select("previous"), desc: "Previous pane" },
    { key: "v", call: split("right"), desc: "Split right" },
    { key: "-", call: split("down"), desc: "Split down" },
    { key: "x", call: call("pane.close", [0, false]), desc: "Close the pane" },
    { key: "z", call: call("pane.setZoom", [0, "toggle"]), desc: "Zoom the pane" },
    { key: "H", call: resize("L"), desc: "Resize left" },
    { key: "L", call: resize("R"), desc: "Resize right" },
    { key: "K", call: resize("U"), desc: "Resize up" },
    { key: "J", call: resize("D"), desc: "Resize down" },
  ];
  // herdr counts tabs from 1.
  for (let i = 1; i <= 9; i++) keys.push({ key: String(i), call: call("tab.select", [{ index: i - 1 }]), desc: "Tab by number" });
  return keys;
}

/** Binds the keys, unless `default_keys` is off. */
export async function install(): Promise<Disposer[]> {
  const on = await option.get(OPTION);
  if (on === false) return [];
  const bound: Disposer[] = [];
  for (const binding of bindings()) {
    const mapped = key.set("prefix", binding.key, binding.call, { desc: binding.desc, repeat: binding.desc.startsWith("Resize") });
    mapped.ready.catch((err) => log(`key ${binding.key}: ${(err as Error)?.message ?? err}`));
    bound.push(mapped);
  }
  return bound;
}
