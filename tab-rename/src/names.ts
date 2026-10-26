// Which tabs are the package's to name. A tab it named keeps being renamed as its agents' titles
// change; a tab someone else named (you, from the tab bar or `rename-window`) is left alone until
// its name is given back (`tab.rename(tab, null)`) or `amresyd.tab_rename.rename` is run on it.
// Pure: the bookkeeping, without the API.

export class Names {
  /** The name the package last gave each tab. */
  readonly ours = new Map<number, string>();
  /** The tabs someone else named. */
  readonly manual = new Set<number>();

  /** The names `storage` kept (`toJSON`). */
  load(stored: Record<string, string>): void {
    for (const [id, name] of Object.entries(stored)) this.ours.set(Number(id), name);
  }

  /** The tabs as they are now (`id` and name, as `tab.get` answers): a name that is not ours is someone's. */
  seed(tabs: { id: number; name?: string | null }[]): void {
    const alive = new Set(tabs.map((t) => t.id));
    for (const id of [...this.ours.keys()]) if (!alive.has(id)) this.ours.delete(id);
    for (const t of tabs) this.renamed(t.id, t.name ?? null);
  }

  /** A tab was named `name` (`null`: given back its automatic name). */
  renamed(tab: number, name: string | null): void {
    if (name === null || name === "") {
      this.manual.delete(tab);
      this.ours.delete(tab);
    } else if (this.ours.get(tab) !== name) {
      this.manual.add(tab);
      this.ours.delete(tab);
    }
  }

  /** Whether the package may name `tab`. */
  mine(tab: number): boolean {
    return !this.manual.has(tab);
  }

  /** The package names `tab` `name`: said before the call, so its own `tab.renamed` is known. */
  naming(tab: number, name: string): void {
    this.manual.delete(tab);
    this.ours.set(tab, name);
  }

  /** `tab` is to be the package's again (the command). */
  claim(tab: number): void {
    this.manual.delete(tab);
  }

  closed(tab: number): void {
    this.manual.delete(tab);
    this.ours.delete(tab);
  }

  /** What `storage` keeps: the names that are ours, by tab. */
  toJSON(): Record<string, string> {
    return Object.fromEntries(this.ours);
  }
}
