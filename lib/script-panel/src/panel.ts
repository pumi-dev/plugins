// The page: the repository around the current pane, listed by `Finder`s in groups that fold, each
// item run in a terminal beside it. It looks again when the current pane or its directory changes,
// when one of its options changes, and on Rescan.
import {
  div,
  format,
  notify,
  on,
  pane,
  px,
  scroll,
  theme,
  View,
  type El,
  type ViewClass,
  type ViewContext,
} from "pumi";
import { groupScripts, repoRoot, type Finder, type Group } from "./finder.ts";

/** Opens a terminal beside the current pane in `dir` and types `command` into it. */
async function run(dir: string, command: string): Promise<void> {
  try {
    const opened = await pane.open("terminal", { cwd: dir }, {});
    await pane.call(opened, "input", { text: `${command}\r` });
  } catch (err) {
    await notify(`${command}: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Whether two scans found the same page. */
function same(found: Group[], shown: Group[]): boolean {
  return JSON.stringify(found) === JSON.stringify(shown);
}

/**
 * A page of runnable scripts. `make` is called for each pane (its finder reads its options then)
 * and again when one of them changes.
 */
export class ScriptPanel extends View {
  private finder: Finder | null = null;
  /** The repository last looked at. */
  private root = "";
  private groups: Group[] = [];
  /** The labels of the groups folding their items away. */
  private readonly folded = new Set<string>();
  private readonly make: () => Finder | Promise<Finder>;
  /** What its items are (`script`): the page counts them. */
  private readonly noun: string;

  constructor(cx: ViewContext, make: () => Finder | Promise<Finder>, noun: string) {
    super(cx);
    this.make = make;
    this.noun = noun;
    void this.start();
  }

  /** Reads the finder's options, follows the app, and draws what the repository holds. */
  private async start(): Promise<void> {
    const finder = await this.make();
    this.finder = finder;
    this.cx.own(
      on(
        ["pane.focused", "cwd.changed", "session.focused", "tab.focused"],
        { desc: "the scripts page follows the current pane" },
        () => this.follow(),
      ),
    );
    this.cx.own(on("option.changed", { match: finder.optionMatch, desc: "the scripts page's options" }, () => this.reread()));
    if (await this.rescan(true)) this.cx.notify();
  }

  /** Looks again when the repository changed, and draws it if anything differs. */
  private async follow(): Promise<void> {
    if (await this.rescan(false)) this.cx.notify();
  }

  /** Re-reads the finder's options and looks again, whether or not the repository moved. */
  private async reread(): Promise<void> {
    this.finder = await this.make();
    if (await this.rescan(true)) this.cx.notify();
  }

  /** Looks again from the current pane's directory; says whether anything differs (or `force`). */
  private async rescan(force: boolean): Promise<boolean> {
    if (!this.finder) return false;
    const cwd = (await format.eval("#{pane_current_path}")) || "/";
    const root = repoRoot(cwd);
    if (!force && root === this.root) return false;
    this.root = root;
    const groups = groupScripts(this.finder, root);
    const changed = !same(groups, this.groups);
    this.groups = groups;
    return changed || force;
  }

  /** Folds the group `label` away, or unfolds it. */
  private fold(label: string): void {
    if (!this.folded.delete(label)) this.folded.add(label);
    this.cx.notify();
  }

  render(): El {
    const items = this.groups.reduce((count, group) => count + group.items.length, 0);
    const toolbar = div()
      .flex()
      .flexNone()
      .itemsCenter()
      .gap(px(8))
      .px2()
      .py1()
      .textXs()
      .textColor(theme.muted)
      .child(div().flex1().child(`${plural(items, this.noun)} · ${plural(this.groups.length, "place")}`))
      .child(
        div()
          .id("rescan")
          .px1()
          .roundedSm()
          .cursorPointer()
          .hover((s) => s.bg(theme.hover).textColor(theme.text))
          .onClick(() => void this.reread())
          .child("Rescan"),
      );
    return div().class("script-panel").sizeFull().flex().flexCol().child(toolbar).child(this.list());
  }

  /** The groups and their items, folding, scrolling. */
  private list(): El {
    const list = scroll().id("scripts").flex().flexCol().flex1().minH0();
    if (this.groups.length === 0) {
      if (!this.finder) return list;
      return list.child(div().px3().py2().textXs().textColor(theme.muted).child(this.finder.empty));
    }
    const detail = this.finder?.showDetail ?? false;
    for (const [g, group] of this.groups.entries()) {
      const open = !this.folded.has(group.label);
      list.child(
        div()
          .id(`group-${g}`)
          .flex()
          .itemsCenter()
          .gap(px(4))
          .px2()
          .h(px(22))
          .textXs()
          .fontWeight(600)
          .textColor(theme.text)
          .cursorPointer()
          .hover((s) => s.bg(theme.hover))
          .onClick(() => this.fold(group.label))
          .child(open ? "▾" : "▸")
          .child(div().flex1().truncate().child(group.label))
          .child(div().textColor(theme.muted).child(String(group.items.length))),
      );
      if (!open) continue;
      for (const [i, item] of group.items.entries()) {
        list.child(
          div()
            .id(`item-${g}-${i}`)
            .flex()
            .itemsCenter()
            .gap(px(8))
            .pl(px(22))
            .pr2()
            .h(px(22))
            .textXs()
            .textColor(theme.text)
            .cursorPointer()
            .hover((s) => s.bg(theme.hover))
            .onClick(() => void run(group.dir, item.command))
            .child(div().flexNone().child(item.name))
            .when(detail, (row) =>
              row.child(div().flex1().minW0().truncate().textColor(theme.muted).child(item.detail)),
            ),
        );
      }
    }
    return list;
  }
}

/**
 * The view class to register — `view("scripts", scriptPanel(() => read(), "script"))` draws panes of
 * it. `make` builds the finder of each pane (its options read then), and is called again when one of
 * the options `optionMatch` names changes.
 */
export function scriptPanel(make: () => Finder | Promise<Finder>, noun: string): ViewClass {
  return class extends ScriptPanel {
    constructor(cx: ViewContext) {
      super(cx, make, noun);
    }
  };
}
