// What the list offers, apart from drawing it, so a test reads it without the app: a file always,
// then what the plugins add to the `tab.new` slot (the `+` menu's), each plugin's a group of its
// own, numbered 1 to 9 in order.

/** One of the `tab.new` slot's actions, as the window gives it. */
export interface SlotAction {
  id: string;
  title: string;
  icon?: string;
  plugin: string;
  keys?: string;
  run(args?: unknown): void;
}

/** Where what is picked goes: in the list's place, the same tab. */
export interface Place {
  kind: "tiled";
  replace: string;
}

/** One row of the list. */
export interface Kind {
  id: string;
  title: string;
  icon: string;
  /** The key that picks it while the list is focused (`F`, `1`…`9`), or none. */
  letter: string;
  /** The keys that open one elsewhere, when they are bound. */
  keys?: string;
  /** A rule is drawn between groups. */
  group: string;
  /** Opens it, from tab `at`, at `place`. */
  open(at: string, place: Place): Promise<unknown> | void;
}

/** The rows: `file` first (it is the core's), then each action in the slot's order. */
export function kinds(actions: SlotAction[], file: Kind["open"]): Kind[] {
  const out: Kind[] = [{ id: "file", title: "File…", icon: "file", letter: "F", group: "pumi", open: file }];
  actions.forEach((a, i) => {
    out.push({
      id: `${a.plugin}/${a.id}`,
      title: a.title,
      icon: a.icon ?? "plus",
      letter: i < 9 ? String(i + 1) : "",
      keys: a.keys,
      group: a.plugin,
      open: (tab, place) => a.run({ tab, place }),
    });
  });
  return out;
}

/** The row a key picks: its letter, any case. */
export function byLetter(list: Kind[], key: string): Kind | undefined {
  const k = key.toLowerCase();
  return list.find((row) => row.letter !== "" && row.letter.toLowerCase() === k);
}
