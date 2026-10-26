// tab-rename: names each tab after what its agents are working on, with Apple's on-device model,
// so the tab bar reads "Key Binding Fix" rather than "Tab 3". All of it is logic: it contributes
// no slot and draws nothing, so there is no `ui.tsx`.
//
// An agent's pane title is what the agent says it is doing (pi's `π - <session> - <folder>`,
// Claude Code's `✳ <summary>`). Each time one changes, the tab it is in is named again from the
// titles of every agent in it, the one in front first. A tab you named yourself is left alone
// (`names.ts`); `amresyd.tab_rename.rename` takes it back.
import { join } from "node:path";
import { call, fn, on, option, paths, request, self, workspace, type PaneId, type TabId, type PumiEvent } from "pumi";
import { Namer, Unavailable } from "./namer.ts";
import { Names } from "./names.ts";
import { basename, clean, key, topic } from "./titles.ts";

/** How long a tab's titles must hold still before it is named: agents retitle in bursts. */
const SETTLE_MS = 1500;
/** After the model was unavailable, how long until it is tried again (Apple Intelligence may be turned on). */
const RETRY_MS = 10 * 60 * 1000;
/** At most this many agents' titles go to the model for one tab. */
const MAX_TITLES = 6;

const namer = new Namer(join(self.plugin.dir, "swift", "namer.swift"), paths.cache);
const names = new Names();
/** A tab's id as the API has it (`@2`), from the number this package keeps of it. */
const tabRef = (tab: number): TabId => `@${tab}`;

/** The number a tab's id names (`@2` is `2`). */
const numberOf = (id: string): number => Number(id.slice(id.indexOf("/") + 1).replace(/^[%@$]/, ""));

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
  names.load((await option.get("named")) ?? {});
  await everyTab();
})();
ready.catch((e) => console.error("tab-rename: starting failed:", e));

async function save(): Promise<void> {
  await option.set("named", names.toJSON());
}

async function maxWords(): Promise<number> {
  const n = Number(await option.get("max_words"));
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 6) : 3;
}

/** What the agents in `tab` work on, the one in front first; empty when none says. */
async function topics(tab: number): Promise<string[]> {
  const front = workspace.getTab(tabRef(tab))?.activePane?.id ?? "";
  const panes = await workspace.panes({ tab: tabRef(tab) }).catch(() => []);
  const said = panes.map((pane) => {
    const options = (pane.options ?? {}) as Record<string, unknown>;
    const text = (name: string): string | null => (typeof options[name] === "string" ? (options[name] as string) : null);
    const agent = text("@agent");
    const status = text("@agent.status");
    if (!agent && !status) return null;
    const words = topic(text("title") ?? "", agent ?? "", basename(text("pane_current_path") ?? ""));
    return words ? { said: words, front: pane.id === front } : null;
  });
  const ordered = said.filter((each) => each !== null).sort((a, b) => Number(b.front) - Number(a.front));
  return [...new Set(ordered.map((each) => each.said))].slice(0, MAX_TITLES);
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
    await call("tab.update", tabRef(tab), { name: answer });
    await save();
  } catch (e) {
    asked.delete(tab);
    if (e instanceof Unavailable) {
      unavailableUntil = Date.now() + RETRY_MS;
      await request.open({ kind: "notification", title: `tab-rename: ${e.message}`, level: "warn" });
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
async function tabOf(pane: PaneId): Promise<number | null> {
  await workspace.ready.catch(() => {});
  const tab = workspace.getPane(pane)?.tab;
  return tab ? numberOf(tab.id) : null;
}

const desc = "name the tab after its agents";
on("pane.changed", { desc }, async (event: PumiEvent) => {
  if (typeof event.pane !== "string") return;
  const keys: string[] = event.data?.keys ?? [];
  // A status changing says nothing new unless the pane just became an agent's, and a move names
  // the tab it went to.
  const named = keys.some((key) => key === "options.title" || key === "options.@agent");
  const brief = keys.includes("options.@agent.status");
  const moved = keys.includes("place");
  if (!named && !brief && !moved) return;
  const tab = await tabOf(event.pane);
  if (tab !== null) soon(tab);
});
on("tab.changed", { desc: "tell your names from tab-rename's" }, async (event: PumiEvent) => {
  await ready.catch(() => {});
  const keys: string[] = event.data?.keys ?? [];
  if (!keys.includes("name") || typeof event.data?.tab !== "string") return;
  const id = numberOf(event.data.tab);
  // Which name it has now is the tab's own (`null`: its automatic one, back again).
  const given = (event.data?.patch as { name?: unknown } | undefined)?.name;
  names.renamed(id, typeof given === "string" && given !== "" ? given : null);
  await save();
  // Given back its automatic name: it is the package's again, so it is named now.
  if (typeof given !== "string" || given === "") {
    asked.delete(id);
    soon(id);
  }
});
on("tab.closed", { desc: "forget a closed tab" }, async (event: PumiEvent) => {
  await ready.catch(() => {});
  if (typeof event.data?.tab !== "string") return;
  const id = numberOf(event.data.tab);
  names.closed(id);
  asked.delete(id);
  clearTimeout(timers.get(id));
  timers.delete(id);
  await save();
});
on("option.changed", { match: self.plugin.prefixed("max_words"), desc: "name every tab again" }, () => everyTab());

fn.set("rename", { desc: "Name the tab after its agents again, taking it back from you.", parameters: [["table", "args"]] }, async (args?: { tab?: string }) => {
  await ready.catch(() => {});
  const given = typeof args?.tab === "string" ? numberOf(args.tab) : undefined;
  const tab = given ?? (await (async () => {
    await workspace.ready;
    const front = workspace.currentTab;
    return front ? numberOf(front.id) : undefined;
  })());
  if (tab === undefined) throw new Error("tab-rename: no tab in front to name");
  names.claim(tab);
  unavailableUntil = 0;
  await name(tab, true);
});

/** Names every tab that is the package's, as at startup. */
async function everyTab(): Promise<void> {
  await workspace.ready.catch(() => {});
  const all: { id: number; name: string | null }[] = [];
  for (const session of workspace.sessions) {
    for (const tab of session.tabs) all.push({ id: numberOf(tab.id), name: tab.name ?? null });
  }
  names.seed(all);
  await save();
  asked.clear();
  for (const t of all) soon(t.id);
}
