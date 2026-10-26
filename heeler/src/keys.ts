// herdr's default keys (`herdr --default-config`'s `[keys]`), in the prefix table (`C-b`, then the
// key) while the package runs, unless `default_keys` is off. Each is a call of the API, so it needs
// no other package; what herdr binds to its own TUI (help, settings, detach, reload, the agent list,
// the sidebar, clear, reopen) has no API function and is left out. They are bound over the host's
// tmux-like defaults where the two share a key.
//
// They are computed here rather than declared in the manifest because a manifest key is mapped in
// the root table, where no key can be `default_keys`' to turn off; these wait for the prefix. So
// they go on the wire, as `key.set` (which the SDK does not carry): it has no disposer, and the app
// takes them back when the package stops.
import { call, option } from "pumi";
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

/** What a key runs: a call of the API, as the host makes it. */
function runs(name: string, args: Json[]): Binding["call"] {
  return { call: name, args };
}

function split(side: string): Binding["call"] {
  return runs("pane.open", ["terminal", {}, { split: side }]);
}

function select(direction: string): Binding["call"] {
  return runs("pane.select", [{ direction }]);
}

function resize(direction: string): Binding["call"] {
  return runs("pane.resize", [0, { direction, cells: 1 }]);
}

/** Every key, its call and what it does. */
export function bindings(): Binding[] {
  const keys: Binding[] = [
    { key: "N", call: runs("session.create", [{}]), desc: "New workspace" },
    { key: "D", call: runs("session.close", [0]), desc: "Close the workspace" },
    { key: "[", call: runs("session.select", [{ offset: -1 }]), desc: "Previous workspace" },
    { key: "]", call: runs("session.select", [{ offset: 1 }]), desc: "Next workspace" },
    { key: "c", call: runs("pane.open", ["terminal", {}, { kind: "tab" }]), desc: "New tab" },
    { key: "p", call: runs("tab.select", [{ offset: -1 }]), desc: "Previous tab" },
    { key: "n", call: runs("tab.select", [{ offset: 1 }]), desc: "Next tab" },
    { key: "X", call: runs("tab.close", [0]), desc: "Close the tab" },
    { key: "h", call: select("L"), desc: "Pane left" },
    { key: "j", call: select("D"), desc: "Pane below" },
    { key: "k", call: select("U"), desc: "Pane above" },
    { key: "l", call: select("R"), desc: "Pane right" },
    { key: "Tab", call: runs("pane.select", [{ offset: 1 }]), desc: "Next pane" },
    { key: "BTab", call: runs("pane.select", [{ offset: -1 }]), desc: "Previous pane" },
    { key: "v", call: split("right"), desc: "Split right" },
    { key: "-", call: split("down"), desc: "Split down" },
    { key: "x", call: runs("pane.close", [0]), desc: "Close the pane" },
    { key: "z", call: runs("pane.resize", [0, { zoom: "toggle" }]), desc: "Zoom the pane" },
    { key: "H", call: resize("L"), desc: "Resize left" },
    { key: "L", call: resize("R"), desc: "Resize right" },
    { key: "K", call: resize("U"), desc: "Resize up" },
    { key: "J", call: resize("D"), desc: "Resize down" },
  ];
  // herdr counts tabs from 1.
  for (let i = 1; i <= 9; i++) keys.push({ key: String(i), call: runs("tab.select", [{ index: i - 1 }]), desc: "Tab by number" });
  return keys;
}

/** Binds the keys, unless `default_keys` is off. */
export async function install(): Promise<void> {
  if ((await option.get(OPTION)) === false) return;
  for (const binding of bindings()) {
    const opts = { desc: binding.desc, repeat: binding.desc.startsWith("Resize") };
    try {
      await call("key.set", "prefix", binding.key, binding.call, opts);
    } catch (err) {
      log(`key ${binding.key}: ${(err as Error)?.message ?? err}`);
    }
  }
}
