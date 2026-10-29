// Every terminal's last checks, and the tabs whose foreground job was suspended: what measuring
// finds, and what being heavy does to a tab.
import { call, option, workspace } from "pumi";
import { flag, number } from "./options.ts";
import { usage, type Procs } from "./procs.ts";

/** What the last checks found of a tab. */
interface Watch {
  /** How many checks in a row it was heavy, and whether that has been said. */
  strikes: number;
  alerted: boolean;
}

/** What makes a terminal heavy, read from the options once a round. */
interface Bars {
  /** Cores × 100. */
  cpu: number;
  /** Bytes. */
  memory: number;
  /** How many checks in a row count. */
  sustain: number;
  autoSleep: boolean;
}

/**
 * The terminals, measured round after round: a heavy one is marked `@heavy` and said in a notice,
 * and its foreground job can be suspended as ctrl+z would suspend it, and woken with `fg`.
 */
export class Watches {
  /** Each terminal's last checks, by tab. */
  private readonly watched = new Map<string, Watch>();
  /** The tabs whose foreground job was suspended. */
  private readonly sleeping = new Set<string>();

  /** Measures every terminal once, against `procs`; a heavy one is marked, and slept when asked. */
  async check(procs: Procs): Promise<void> {
    const bars: Bars = {
      cpu: await number("cpu", 150),
      memory: (await number("memory", 4096)) * 1_048_576,
      sustain: Math.max(Math.trunc(await number("sustain", 3)), 1),
      autoSleep: await flag("auto_sleep", false),
    };
    // The terminals are the tabs on the core's terminal engine: a tab whose `tab_pid` is a number.
    // An answer with no list of tabs (`null`) is no tabs: this round measures nothing.
    const terminals = (await workspace.tabs()).filter((tab) => typeof tab.options?.tab_pid === "number");
    const seen = new Set<string>();
    for (const { id } of terminals) {
      seen.add(id);
      try {
        await this.measure(id, procs, bars);
      } catch (err) {
        console.error(`heavy-terminals: tab ${id}:`, err);
      }
    }
    // A tab that closed is forgotten: what was found of it, and that it was asleep.
    for (const id of [...this.watched.keys()]) if (!seen.has(id)) this.watched.delete(id);
    for (const id of [...this.sleeping]) if (!seen.has(id)) this.sleeping.delete(id);
  }

  /** Suspend a tab's foreground job: ctrl+z, as a person would type it. */
  async sleep(id: string): Promise<void> {
    await call("tab.call", id, "input", { keys: ["ctrl+z"] });
    this.sleeping.add(id);
    await option.set("@heavy", "asleep", { scope: "tab", id });
  }

  /** Wake it: `fg` and Enter. */
  async wake(id: string): Promise<void> {
    await call("tab.call", id, "input", { text: "fg\r" });
    this.sleeping.delete(id);
    await option.set("@heavy", null, { scope: "tab", id });
  }

  /** One terminal: its tree's cost, whether that is heavy, and what being heavy does. */
  private async measure(id: string, procs: Procs, bars: Bars): Promise<void> {
    const tab = await workspace.getTab(id)?.ready.catch(() => null);
    const pid = tab?.process?.pid;
    if (typeof pid !== "number") return;
    const { cpu, rss } = usage(procs, pid);
    let watch = this.watched.get(id);
    if (!watch) {
      watch = { strikes: 0, alerted: false };
      this.watched.set(id, watch);
    }
    const heavy = cpu > bars.cpu || rss > bars.memory;
    if (heavy && !this.sleeping.has(id)) {
      watch.strikes += 1;
      if (watch.strikes >= bars.sustain && !watch.alerted) {
        watch.alerted = true;
        const cost = `${Math.round(cpu)}% cpu, ${Math.round(rss / 1_048_576)} MB`;
        await option.set("@heavy", cost, { scope: "tab", id });
        await workspace.openRequest({ kind: "notification", title: `${id} is heavy: ${cost}`, level: "warn" });
        if (bars.autoSleep) await this.sleep(id);
      }
    } else if (!heavy) {
      watch.strikes = 0;
      watch.alerted = false;
    }
  }
}
