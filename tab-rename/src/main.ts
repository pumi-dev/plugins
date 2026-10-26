// tab-rename: names each tab after what its agents are working on, with Apple's on-device model,
// so the tab bar reads "Key Binding Fix" rather than "Tab 3". All of it is logic: it contributes
// no slot and draws nothing, so there is no `ui.tsx`.
//
// An agent's pane title is what the agent says it is doing (pi's `π - <session> - <folder>`,
// Claude Code's `✳ <summary>`). Each time one changes, the tab it is in is named again from the
// titles of every agent in it, the one in front first. A tab you named yourself is left alone
// (`names.ts`); `amresyd.tab_rename.rename` takes it back.
import { join } from "node:path";
import { command, format, notify, on, option, Pane, paths, plugin, session as sessions, storage, Tab, tab as tabs } from "pumi";
import { Namer, Unavailable } from "./namer.ts";
import { Names } from "./names.ts";
import { basename, clean, key, topic } from "./titles.ts";

/** How long a tab's titles must hold still before it is named: agents retitle in bursts. */
const SETTLE_MS = 1500;
/** After the model was unavailable, how long until it is tried again (Apple Intelligence may be turned on). */
const RETRY_MS = 10 * 60 * 1000;
/** At most this many agents' titles go to the model for one tab. */
const MAX_TITLES = 6;

const namer = new Namer(join(plugin.dir, "swift", "namer.swift"), paths.cache);
const names = new Names();
/** Names already answered, by `key(topics)`: the same titles are not asked about twice. */
const answers = new Map<string, string>();
/** What each tab was last named from, so a title that changes nothing asks nothing. */
const asked = new Map<number, string>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
/** Tabs being named now, and whether they changed meanwhile. */
const running = new Map<number, boolean>();
let unavailableUntil = 0;

/** Startup: the names kept from the last run, then every tab named. Not awaited at the top, so the
 * worker is ready at once; every handler waits for it. */
const ready = (async () => {
  names.load((await storage.get<Record<string, string>>("named")) ?? {});
  await everyTab();
})();
ready.catch((e) => console.error("tab-rename: starting failed:", e));

async function save(): Promise<void> {
  await storage.set("named", names.toJSON());
}

async function maxWords(): Promise<number> {
  const n = Number(await option.get("max_words"));
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 6) : 3;
}

/** What the agents in `tab` work on, the one in front first; empty when none says. */
async function topics(tab: number): Promise<string[]> {
  const [panes, front] = await Promise.all([new Tab(tab).panes(), format.eval("#{pane_id}", { tab }).catch(() => "")]);
  const seen = await Promise.all(
    panes.map(async (p) => {
      const [title, agent, status, cwd] = await Promise.all([
        p.options.get<string | null>("title"),
        p.options.get<string | null>("@agent"),
        p.options.get<string | null>("@agent_status"),
        p.options.get<string | null>("pane_current_path"),
      ]);
      if (!agent && !status) return null;
      const said = topic(title ?? "", agent ?? "", basename(cwd ?? ""));
      return said ? { said, front: `%${p.id}` === front } : null;
    }),
  );
  const ordered = seen.filter((s) => s !== null).sort((a, b) => Number(b.front) - Number(a.front));
  return [...new Set(ordered.map((s) => s.said))].slice(0, MAX_TITLES);
}

/** Names `tab` from its agents' titles, unless it is someone else's or nothing changed. */
async function name(tab: number, force = false): Promise<void> {
  await ready.catch(() => {});
  if (running.has(tab)) return void running.set(tab, true);
  running.set(tab, false);
  try {
    if (!names.mine(tab) || Date.now() < unavailableUntil) return;
    const words = await maxWords();
    const said = await topics(tab);
    if (said.length === 0) return;
    const k = key(said, words);
    if (!force && asked.get(tab) === k) return;
    asked.set(tab, k);
    const answer = answers.get(k) ?? clean((await namer.name(said, words)) ?? "", words, said);
    if (!answer) return;
    answers.set(k, answer);
    if (answers.size > 500) answers.delete(answers.keys().next().value!);
    // You may have named it while the model thought.
    if (!names.mine(tab) || names.ours.get(tab) === answer) return;
    names.naming(tab, answer);
    await tabs.rename(tab, answer);
    await save();
  } catch (e) {
    asked.delete(tab);
    if (e instanceof Unavailable) {
      unavailableUntil = Date.now() + RETRY_MS;
      await notify(`tab-rename: ${e.message}`, "warn");
    } else {
      console.error(`tab-rename: naming tab @${tab} failed:`, e);
    }
  } finally {
    const again = running.get(tab);
    running.delete(tab);
    if (again) soon(tab);
  }
}

/** Names `tab` once its titles have held still. */
function soon(tab: number): void {
  clearTimeout(timers.get(tab));
  timers.set(
    tab,
    setTimeout(() => {
      timers.delete(tab);
      void name(tab);
    }, SETTLE_MS),
  );
}

/** The tab a pane is in, if it is tiled or floating in one. */
async function tabOf(pane: number): Promise<number | null> {
  try {
    return (await new Pane(pane).tab())?.id ?? null;
  } catch {
    return null;
  }
}

const desc = "name the tab after its agents";
on("option.changed", { match: ["title", "@agent", "@agent_status"], desc }, async (e) => {
  if (e.data.scope !== "pane") return;
  // A status changing says nothing new unless the pane just became an agent's.
  if (e.data.name === "@agent_status" && e.data.old) return;
  const tab = await tabOf(Number(e.data.id));
  if (tab !== null) soon(tab);
});
on("pane.moved", { desc }, async (e) => {
  if (e.pane === undefined) return;
  const tab = await tabOf(e.pane);
  if (tab !== null) soon(tab);
});
on("tab.renamed", { desc: "tell your names from tab-rename's" }, async (e) => {
  await ready.catch(() => {});
  const id = Number(e.tab);
  if (!Number.isFinite(id)) return;
  // Which name it has now is what the event matched (empty: its automatic one, back again).
  const given = e.match || null;
  names.renamed(id, given);
  await save();
  // Given back its automatic name: it is the package's again, so it is named now.
  if (!given) {
    asked.delete(id);
    soon(id);
  }
});
on("tab.closed", { desc: "forget a closed tab" }, async (e) => {
  await ready.catch(() => {});
  const id = Number(e.data.tab ?? e.tab);
  names.closed(id);
  asked.delete(id);
  clearTimeout(timers.get(id));
  timers.delete(id);
  await save();
});
on("option.changed", { match: plugin.prefixed("max_words"), desc: "name every tab again" }, () => everyTab());

command("rename", async (args?: { tab?: number }) => {
  await ready.catch(() => {});
  const tab = typeof args?.tab === "number" ? args.tab : (await tabs.get()).id;
  names.claim(tab);
  unavailableUntil = 0;
  await name(tab, true);
});

/** Names every tab that is the package's, as at startup. */
async function everyTab(): Promise<void> {
  const all: { id: number; name: string | null }[] = [];
  for (const session of await sessions.list()) {
    for (const tab of await tabs.list(session)) {
      all.push({ id: tab.id, name: (await tabs.get(tab.id)).name ?? null });
    }
  }
  names.seed(all);
  await save();
  asked.clear();
  for (const t of all) soon(t.id);
}
