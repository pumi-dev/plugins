// What the package named each tab, kept across a restart. The core keeps one title per tab, the
// program's or whoever set it last, so the name this package gave is remembered here rather than
// read back off the tab. Pure: the bookkeeping, without the API.

export class Names {
  /** The name the package last gave each tab. */
  readonly ours = new Map<number, string>();

  /** The names the option kept (`toJSON`). */
  load(stored: Record<string, string>): void {
    for (const [id, name] of Object.entries(stored)) this.ours.set(Number(id), name);
  }

  /** The tabs as they are now (`id` and title, as `tab.get` answers): a tab that is gone is forgotten. */
  seed(tabs: { id: number; name?: string | null }[]): void {
    const alive = new Set(tabs.map((t) => t.id));
    for (const id of [...this.ours.keys()]) if (!alive.has(id)) this.ours.delete(id);
  }

  /** The package names `tab` `name`. */
  naming(tab: number, name: string): void {
    this.ours.set(tab, name);
  }

  closed(tab: number): void {
    this.ours.delete(tab);
  }

  /** What the option keeps: the names the package gave, by tab. */
  toJSON(): Record<string, string> {
    return Object.fromEntries(this.ours);
  }
}
