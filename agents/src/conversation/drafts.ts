// A chat's draft, kept where every window of the tab reads it: the words typed in one window go
// out as one message after they settle (60 ms, as `Producer`'s batches wait), and each write has
// its own number, so a window applies the writes after the one it shows and no others. No
// `import … from "pumi"` here: `drafts.ts` sends what this hands it, and the tests run it alone.
import type { TimerHandle, Timers } from "./change.ts";
import { draftParts, type SavedDraft, type SharedDraft } from "./draft.ts";

export interface DraftsOptions {
  /** Where a tab's draft goes, once per tab for all the writes that settled (`drafts.ts`: the channel, and the plugin's event). */
  publish(tab: number, draft: SharedDraft): void;
  /** How long the writes of a tab rest before they go out. 60 ms by default, `Producer`'s interval. */
  interval?: number;
  /** The clock a draft's `at` reads. `Date.now` by default. */
  now?(): number;
  /** What keeps the time, for a test. `setTimeout` and `clearTimeout` by default. */
  timers?: Timers;
}

/**
 * Each tab's draft, as written last, and the writes waiting to be sent. A write applies at once (so
 * the writer's own next write reads it), and goes out as one message a moment after.
 */
export class Drafts {
  readonly #drafts = new Map<number, SharedDraft>();
  /** The tabs whose draft changed since it was last sent. */
  readonly #unsent = new Set<number>();
  #timer: TimerHandle | undefined;
  /** Moves by one with each write, across tabs: a window applies a draft newer than the one it has. */
  #seq = 0;
  readonly #options: DraftsOptions;

  constructor(options: DraftsOptions) {
    this.#options = options;
  }

  /** Tab `tab`'s draft as it is now, if a window wrote one. */
  get(tab: number): SharedDraft | undefined {
    return this.#drafts.get(tab);
  }

  /**
   * Tab `tab`'s draft as the window `by` has it: the text and chips, or `null` for one emptied or
   * sent. Answers it as it is kept, so the writer shows it at once; the other windows hear it when
   * the writes settle.
   */
  set(tab: number, by: string, saved: SavedDraft | null): SharedDraft {
    const next: SharedDraft = { seq: ++this.#seq, by, at: this.#now(), ...draftParts(saved) };
    this.#drafts.set(tab, next);
    this.#unsent.add(tab);
    this.#schedule();
    return next;
  }

  /** A tab closed: its draft goes with it (one reopened has another id). */
  forget(tab: number): void {
    this.#drafts.delete(tab);
    this.#unsent.delete(tab);
  }

  /** Sends what changed now, rather than when the writes would have settled. */
  flush(): void {
    this.#cancel();
    const tabs = [...this.#unsent];
    this.#unsent.clear();
    for (const tab of tabs) {
      const draft = this.#drafts.get(tab);
      if (draft) this.#options.publish(tab, draft);
    }
  }

  /** Stops the timer; what is waiting stays until the next `flush` (a window that goes, `drafts.ts`). */
  dispose(): void {
    this.#cancel();
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  #schedule(): void {
    if (this.#timer !== undefined) return;
    const set = this.#options.timers?.set ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.#timer = set(() => {
      this.#timer = undefined;
      this.flush();
    }, this.#options.interval ?? 60);
  }

  #cancel(): void {
    if (this.#timer === undefined) return;
    const clear = this.#options.timers?.clear ?? ((handle: TimerHandle) => clearTimeout(handle));
    clear(this.#timer);
    this.#timer = undefined;
  }
}
