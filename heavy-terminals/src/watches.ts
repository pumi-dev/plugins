// Every terminal's last checks, and the panes whose foreground job was suspended: what measuring
// finds, and what being heavy does to a pane.
import { notify, option, pane, type Pane } from "pumi";
import { flag, number } from "./options.ts";
import { usage, type Procs } from "./procs.ts";

/** What the last checks found of a pane. */
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
  /** Each terminal's last checks, by pane. */
  private readonly watched = new Map<number, Watch>();
  /** The panes whose foreground job was suspended. */
  private readonly sleeping = new Set<number>();

  /** Measures every terminal once, against `procs`; a heavy one is marked, and slept when asked. */
  async check(procs: Procs): Promise<void> {
    const bars: Bars = {
      cpu: await number("cpu", 150),
      memory: (await number("memory", 4096)) * 1_048_576,
      sustain: Math.max(Math.trunc(await number("sustain", 3)), 1),
      autoSleep: await flag("auto_sleep", false),
    };
    const terminals = (await pane.list({ type: "terminal" })) ?? [];
    const seen = new Set<number>();
    for (const terminal of terminals) {
      seen.add(terminal.id);
      try {
        await this.measure(terminal, procs, bars);
      } catch (err) {
        console.error(`heavy-terminals: pane ${terminal.id}:`, err);
      }
    }
    // A pane that closed is forgotten: what was found of it, and that it was asleep.
    for (const id of [...this.watched.keys()]) if (!seen.has(id)) this.watched.delete(id);
    for (const id of [...this.sleeping]) if (!seen.has(id)) this.sleeping.delete(id);
  }

  /** Suspend a pane's foreground job: ctrl+z, as a person would type it. */
  async sleep(id: number): Promise<void> {
    await pane.call(id, "input", { bytes: [0x1a] });
    this.sleeping.add(id);
    await option.set("@heavy", "asleep", { pane: id });
  }

  /** Wake it: `fg` and Enter. */
  async wake(id: number): Promise<void> {
    await pane.call(id, "input", { text: "fg\r" });
    this.sleeping.delete(id);
    await option.set("@heavy", null, { pane: id });
  }

  /** One terminal: its tree's cost, whether that is heavy, and what being heavy does. */
  private async measure(terminal: Pane, procs: Procs, bars: Bars): Promise<void> {
    const id = terminal.id;
    const pid = await terminal.options.get("pane_pid");
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
        await option.set("@heavy", cost, { pane: id });
        await notify(`%${id} is heavy: ${cost}`, "warn");
        if (bars.autoSleep) await this.sleep(id);
      }
    } else if (!heavy) {
      watch.strikes = 0;
      watch.alerted = false;
    }
  }
}
