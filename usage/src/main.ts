// usage: how much of each AI plan is left, in the status bar and a section of the side bar.
//
//   pumi call amresyd.usage.refresh                 # read them now
//   pumi call amresyd.usage.report                  # what the bar has
//   pumi option set amresyd.usage.layout meters     # meters only
//
// The worker reads on its own clock (the `every` option), keeps the last numbers in the plugin's
// storage so a restart draws them before the first read, and posts each snapshot to its views in
// the window. What a plan is and how it is read is `providers/`; what the bar shows of it is
// `model.ts` and `settings.ts`, which `ui.tsx` shares.

import { command, notify, on, option, plugin, provide, storage, ui } from "pumi";

import { gather } from "./gather.ts";
import { http, MACHINE } from "./host.ts";
import { percent, resetText, tightest, type Snapshot } from "./model.ts";
import { PROVIDERS } from "./providers/index.ts";
import { coerce, OPTIONS, type Settings } from "./settings.ts";

/** Where the last snapshot is kept, so the window has numbers from the first frame after a restart. */
const CACHE = "readings";

let snapshot: Snapshot = { at: 0, readings: [] };
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<Snapshot> | null = null;
/** The window each alert was said for: a provider, its tightest limit, and when that resets. */
const alerted = new Set<string>();

/** The plugin's options as settings, whichever of them the server answers with. */
async function settings(): Promise<Settings> {
  const values = new Map<string, unknown>();
  await Promise.all(
    OPTIONS.map(async (name) => {
      try {
        values.set(name, await option.get(name));
      } catch {
        values.set(name, undefined);
      }
    }),
  );
  return coerce((name) => values.get(name));
}

/** The secret options the providers can use, as the keychain answers them. */
async function keys(): Promise<Record<string, string | undefined>> {
  const found: Record<string, string | undefined> = {};
  await Promise.all(
    PROVIDERS.filter((provider) => provider.key).map(async (provider) => {
      try {
        const value = await option.get(provider.key!);
        found[provider.key!] = typeof value === "string" ? value : undefined;
      } catch {
        found[provider.key!] = undefined;
      }
    }),
  );
  return found;
}

/** Reads every plan, tells the views, and keeps the answer. One read at a time. */
async function read(): Promise<Snapshot> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const current = await settings();
    try {
      const next = await gather({
        env: MACHINE,
        settings: current,
        keys: await keys(),
        http,
        previous: snapshot.readings,
        now: Date.now(),
      });
      snapshot = next;
      ui.post("usage", next);
      void storage.set(CACHE, next).catch(() => undefined);
      if (current.alert) void alerts(next, current);
      return next;
    } finally {
      // Whatever happened, the clock starts again: a failed read is not the end of the bar.
      schedule(current.every);
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Says a plan is nearly out once each window crosses the critical share, and not again until it resets. */
async function alerts(next: Snapshot, settings: Settings): Promise<void> {
  for (const reading of next.readings) {
    const top = tightest(reading.report?.windows);
    if (!top || percent(top.used) < settings.critAt) continue;
    const id = `${reading.provider}:${top.kind}:${top.resetsAt ?? "never"}`;
    if (alerted.has(id)) continue;
    alerted.add(id);
    const reset = resetText(top, Date.now(), "countdown");
    await notify(`${reading.name}'s ${top.title.toLowerCase()} limit is ${Math.round(percent(top.used))}% used${reset ? `, ${reset} left` : ""}`, "warn");
  }
}

/** Reads again `minutes` from now, instead of whenever the clock was last set. */
function schedule(minutes: number): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(
    () => {
      void read().catch((err) => console.error(`usage: ${message(err)}`));
    },
    Math.max(1, minutes) * 60_000,
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---- the functions the window and anyone else reaches

/** The bar's numbers as they stand: what a view that mounts reads before the next snapshot. */
export async function current(): Promise<Snapshot> {
  return snapshot;
}

/** Reads the plans again now, and says so to every view. */
export async function refresh(): Promise<Snapshot> {
  return read();
}

command("refresh", () => read());

/** Takes the bar away, or brings it back; the side bar's section stays either way. */
command("toggle", async () => {
  const show = await option.get("show");
  await option.set("show", show === false, { save: true });
});

provide(
  plugin.prefixed("report"),
  {
    desc: "How much of each plan is left, as the status bar has it: the plans signed in on this Mac, their limit windows, when each resets, and why a read failed if it did.",
    parameters: [],
    examples: [{ args: [] }],
  },
  () => snapshot,
);

// A change of any of its own options is followed at once: the plans, the colours, the clock.
on("option.changed", { match: `${plugin.prefix}*`, desc: "read the plans with the new settings" }, () => {
  void read().catch((err) => console.error(`usage: ${message(err)}`));
});

// The first paint has the last numbers, from before this run of the app.
void (async () => {
  try {
    const cached = await storage.get<Snapshot>(CACHE);
    if (cached?.readings?.length) {
      snapshot = cached;
      ui.post("usage", cached);
    }
  } catch (err) {
    console.error(`usage: no cached numbers: ${message(err)}`);
  }
  await read().catch((err) => {
    console.error(`usage: the first read failed: ${message(err)}`);
    schedule(coerce(() => undefined).every);
  });
})();
