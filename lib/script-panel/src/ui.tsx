// The page itself, in the window's React tree: a toolbar saying what is there, then a group per
// directory that folds, each item run in a terminal beside the current pane. It follows the pane in
// focus (its directory is what is listed) and re-reads when one of the package's options changes;
// the walk and the running are the package's `main.ts`'s, answered as data: `load` and `run` come
// from it as props, since a library's `main.ts` is not a page of its own.
import { useEffect, useState } from "react";
import { Icon, useEvent, useHover, useMetrics, usePane, usePlugin, useTab, useTheme } from "pumi";

import type { Group, Item, Page } from "./main.ts";
import { shortDetail, splitLabel } from "./text.ts";

/** What a page view says: how it is read, the options it follows, and what its items are called. */
export interface ScriptPageProps {
  /** Reads the page for a directory. An export of the package's `main.ts` (a call to the worker). */
  load(cwd: string): Promise<Page>;
  /** Runs an item in `dir`: an export of the same `main.ts`, opening a terminal there. */
  run(dir: string, command: string): Promise<void>;
  /** The package's own options the page re-reads on, by key (`show_detail`, `max_depth`, …). */
  options?: string[];
  /** What its items are, for the count (`script`). */
  noun?: string;
}

/** What the page draws at: an item's name and a group's, and the smaller text beside them (a
 * command, a count, the toolbar). */
const TEXT = 13;
const META = 12;
/** The height of a group's heading, and of each of its items. */
const HEAD = 28;
const ROW = 24;
/** The page's inset from the sidebar's edges, and the gap between a glyph and what follows it. */
const EDGE = 8;
const GAP = 6;
/** The start glyph a row shows while the mouse is over it: a triangle, drawn from markup so the
 * page ships no file beside itself. An `<svg>` is a mask the theme's colour fills. */
const START =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M5.3 3.02a1.1 1.1 0 0 1 1.68-.94l6.6 4.5a1.1 1.1 0 0 1 0 1.82l-6.6 4.5a1.1 1.1 0 0 1-1.68-.94z" fill="black"/></svg>';

/** Text that keeps to one line and ends in an ellipsis when its row is too narrow for it. */
const CLIP = { whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 } as const;

/** A throw a view cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`script-panel: ${err instanceof Error ? err.message : String(err)}`);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The page: the toolbar and the groups, folding. */
export function ScriptPage({ load, run, options = [], noun = "script" }: ScriptPageProps) {
  const t = useTheme();
  const m = useMetrics();
  const focused = usePane(useTab()?.activePane?.id);
  const cwd = focused?.cwd ?? "/";
  // The package's options: one changing re-reads the page. The window names them with the prefix
  // the package's own options have (`amresyd.npm_scripts.show_command`).
  const id = usePlugin() ?? "";
  const prefix = id ? `${id.replace("/", ".").replaceAll("-", "_")}.` : "";
  const [changed, setChanged] = useState(0);
  // The options it follows, by the names the app gives them; with none named, the package's own.
  const watched = options.length > 0 ? options.map((key) => `${prefix}${key}`) : [`${prefix}*`];
  useEvent("option.changed", () => setChanged((n) => n + 1), { match: watched });
  const [page, setPage] = useState<Page | undefined>(undefined);
  const [reading, setReading] = useState(false);
  /** The groups folded away, by label. */
  const [folded, setFolded] = useState<string[]>([]);
  /** Bumped by Rescan: it reads again whatever the pane and the options say. */
  const [again, setAgain] = useState(0);

  useEffect(() => {
    let live = true;
    setReading(true);
    void load(cwd)
      .then((read) => {
        if (live) setPage(read);
      })
      .catch(swallow)
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [cwd, changed, again]);

  /** Folds the group `label` away, or unfolds it. */
  const fold = (label: string) => {
    setFolded((now) => (now.includes(label) ? now.filter((each) => each !== label) : [...now, label]));
  };

  const items = (page?.groups ?? []).reduce((count, group) => count + group.items.length, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: GAP, height: HEAD, paddingLeft: EDGE + 4, paddingRight: EDGE, flexShrink: 0 }}>
        <text style={{ ...CLIP, fontSize: META, color: t.muted, flexGrow: 1, flexShrink: 1 }}>
          {`${plural(items, noun)} · ${plural(page?.groups.length ?? 0, "place")}`}
        </text>
        {/* Rescan: a turning arrow, faint while it reads. */}
        <div
          onClick={() => setAgain((n) => n + 1)}
          style={{ display: "flex", alignItems: "center", padding: 3, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
        >
          <Icon name="rotate_cw" size={TEXT} color={reading ? t.faint : t.muted} />
        </div>
      </div>
      {list(page, folded, fold, run, t, m)}
    </div>
  );
}

/** The groups and their items, scrolling. */
function list(page: Page | undefined, folded: string[], fold: (label: string) => void, run: ScriptPageProps["run"], t: ReturnType<typeof useTheme>, m: ReturnType<typeof useMetrics>) {
  if (!page) return null;
  if (page.groups.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", paddingLeft: EDGE + 4, paddingRight: EDGE + 4, paddingTop: 8, paddingBottom: 8 }}>
        <text style={{ fontSize: TEXT, color: t.muted }}>{page.empty}</text>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingBottom: 6 }}>
      {page.groups.map((group, index) => (
        <GroupView key={group.label} group={group} first={index === 0} open={!folded.includes(group.label)} fold={fold} run={run} showDetail={page.showDetail} t={t} m={m} />
      ))}
    </div>
  );
}

/** One group: its heading — the fold, its kind, its label and how many it holds — then, unfolded,
 * its items, their names lined up under its label. */
function GroupView({ group, first, open, fold, run, showDetail, t, m }: { group: Group; first: boolean; open: boolean; fold: (label: string) => void; run: ScriptPageProps["run"]; showDetail: boolean; t: ReturnType<typeof useTheme>; m: ReturnType<typeof useMetrics> }) {
  const { place, file } = splitLabel(group.label);
  // An item's name starts where its group's label does: past the fold and the kind's glyph.
  const indent = EDGE + 4 + META + GAP + (group.icon ? META + GAP : 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, marginTop: first ? 0 : 4 }}>
      <div
        onClick={() => fold(group.label)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: GAP, height: HEAD, marginLeft: 4, marginRight: 4, paddingLeft: EDGE, paddingRight: EDGE - 4, borderRadius: m.radiusSmall, flexShrink: 0, cursor: "pointer", hover: { backgroundColor: t.hover } }}
      >
        <Icon name={open ? "chevron_down" : "chevron_right"} size={META} color={t.faint} />
        {group.icon ? <Icon name={group.icon} size={META} color={t.muted} /> : null}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <text style={{ ...CLIP, fontSize: TEXT, fontWeight: 600, color: t.text, flexShrink: 1 }}>{place}</text>
          {file ? <text style={{ ...CLIP, fontSize: META, color: t.faint, flexShrink: 100 }}>{file}</text> : null}
        </div>
        <text style={{ fontSize: META, color: t.faint, flexShrink: 0 }}>{String(group.items.length)}</text>
      </div>
      {open ? group.items.map((item) => <Row key={`${group.label}/${item.name}`} item={item} dir={group.dir} indent={indent} run={run} showDetail={showDetail} t={t} m={m} />) : null}
    </div>
  );
}

/** One item: its name, what it runs, and — while the mouse is over it — the glyph that says a
 * click starts it, kept out of the way when it is not. The name keeps what room it needs; the
 * command has what is left. */
function Row({ item, dir, indent, run, showDetail, t, m }: { item: Item; dir: string; indent: number; run: ScriptPageProps["run"]; showDetail: boolean; t: ReturnType<typeof useTheme>; m: ReturnType<typeof useMetrics> }) {
  const [over, hover] = useHover();
  const detail = showDetail ? shortDetail(item.name, item.detail) : "";
  return (
    <div
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      onClick={() => void run(dir, item.command).catch(swallow)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: ROW, marginLeft: 4, marginRight: 4, paddingLeft: indent - 4, paddingRight: EDGE - 4, borderRadius: m.radiusSmall, flexShrink: 0, cursor: "pointer", hover: { backgroundColor: t.hover } }}
    >
      <text style={{ ...CLIP, fontSize: TEXT, color: t.text, flexShrink: 1 }}>{item.name}</text>
      <text style={{ ...CLIP, fontSize: META, color: t.faint, flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>{detail}</text>
      {/* The start glyph's room is kept while it is hidden, so the command does not shift under it. */}
      <div style={{ display: "flex", width: META, height: META, flexShrink: 0 }}>
        {over ? <svg source={START} style={{ width: META, height: META, color: t.accent }} /> : null}
      </div>
    </div>
  );
}
