// tab-rename: names each tab after what its agents are working on, with Apple's on-device model,
// so the tab bar reads "Key Binding Fix" rather than "Tab 3". All of it is logic: it contributes
// no slot and draws nothing, so there is no `ui.tsx`.
//
// An agent's tab title is what the agent says it is doing (pi's `π - <session> - <folder>`,
// Claude Code's `✳ <summary>`). Each time one changes, the tab is named again from it. The core
// keeps one title per tab (`tab.title`, the program's until something sets it), so a name given
// from the tab bar and the agent's own are the same field: this names it again with the next title
// the agent reports. `amresyd.tab_rename.rename` names it now.
import { join } from "node:path";
import { call, fn, on, option, paths, request, self, workspace, type TabId, type PumiEvent } from "pumi";
import { Namer, Unavailable } from "./namer.ts";
import { Names } from "./names.ts";
import { basename, clean, key, topic } from "./titles.ts";

/** How long a tab's titles must hold still before it is named: agents retitle in bursts. */
const SETTLE_MS = 1500;
/** After the model was unavailable, how long until it is tried again (Apple Intelligence may be turned on). */
const RETRY_MS = 10 * 60 * 1000;
const namer = new Namer(join(self.plugin.dir, "swift", "namer.swift"), paths.cache);
const names = new Names();
/** A tab's id as the API has it (`%2`), from the number this package keeps of it. */
const tabRef = (tab: number): TabId => `%${tab}`;

/** The number a tab's id names (`%2` is `2`). */
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

/** What the agent in `tab` works on; empty when it says nothing, or says no task. */
async function topics(tab: number): Promise<string[]> {
  const each = workspace.getTab(tabRef(tab));
  if (!each) return [];
  if ((await each.ready.catch(() => null)) === null) return [];
  const options = (each.options ?? {}) as Record<string, unknown>;
  const text = (name: string): string | null => (typeof options[name] === "string" ? (options[name] as string) : null);
  // A tab is an agent's when the Agents plugin's trait says which agent it is, or when it reports a
  // state: a shell nobody has reported on says neither.
  if (!text("@pumi_dev.agents.agent") && !text("@status")) return [];
  const words = topic(text("title") ?? "", text("@pumi_dev.agents.agent") ?? "", basename(text("tab_current_path") ?? ""));
  return words ? [words] : [];
}

/** Names `tab` from its agents' titles, unless it is someone else's or nothing changed. */
async function name(tab: number, force = false): Promise<void> {
  await ready.catch(() => {});
  if (running.has(tab)) return void running.set(tab, true);
  running.set(tab, false);
  try {
    if (Date.now() < unavailableUntil) return;
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
    // Its title may have moved on while the model thought.
    if (names.ours.get(tab) === answer) return;
    names.naming(tab, answer);
    await call("tab.update", tabRef(tab), { title: answer });
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

const desc = "name the tab after its agent";
on("tab.changed", { desc }, async (event: PumiEvent) => {
  await ready.catch(() => {});
  if (typeof event.tab !== "string") return;
  const keys: string[] = event.data?.keys ?? [];
  // Its title is what it is named from, its agent and its state say whether it is one, and a move
  // names the tab it went to.
  const titled = keys.includes("title");
  const named = keys.some((key) => key === "options.@pumi_dev.agents.agent");
  const brief = keys.includes("options.@status");
  const moved = keys.includes("place");
  if (!titled && !named && !brief && !moved) return;
  soon(numberOf(event.tab));
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
  asked.delete(tab);
  unavailableUntil = 0;
  await name(tab, true);
});

/** Names every tab that is the package's, as at startup. */
async function everyTab(): Promise<void> {
  await workspace.ready.catch(() => {});
  const all = (await workspace.tabs()).map((tab) => ({ id: numberOf(tab.id), name: tab.title ?? null }));
  names.seed(all);
  await save();
  asked.clear();
  for (const t of all) soon(t.id);
}
