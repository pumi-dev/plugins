// The page itself, in the window's React tree: a toolbar saying what is there, then a group per
// directory that folds, each item run in a terminal beside the current pane. It follows the pane in
// focus (its directory is what is listed) and re-reads when one of the package's options changes;
// the walk and the running are `main.ts`'s, answered as data.
import { useEffect, useState } from "react";
import { Icon, useEvent, useFocusedPane, useMetrics, usePlugin, useTheme } from "pumi";

import { run, type Page } from "./main.ts";

/** What a page view says: how it is read, the options it follows, and what its items are called. */
export interface ScriptPageProps {
  /** Reads the page for a directory. An export of the package's `main.ts` (a call to the worker). */
  load(cwd: string): Promise<Page>;
  /** The package's own options the page re-reads on, by key (`show_detail`, `max_depth`, …). */
  options?: string[];
  /** What its items are, for the count (`script`). */
  noun?: string;
}

/** A throw a view cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`script-panel: ${err instanceof Error ? err.message : String(err)}`);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The page: the toolbar and the groups, folding. */
export function ScriptPage({ load, options = [], noun = "script" }: ScriptPageProps) {
  const t = useTheme();
  const m = useMetrics();
  const focused = useFocusedPane();
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
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, flexShrink: 0, fontSize: 11, color: t.muted }}>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: 11, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {`${plural(items, noun)} · ${plural(page?.groups.length ?? 0, "place")}`}
          </text>
        </div>
        <div
          onClick={() => setAgain((n) => n + 1)}
          style={{ paddingLeft: 4, paddingRight: 4, borderRadius: m.radiusSmall, color: reading ? t.faint : t.muted, cursor: "pointer", hover: { backgroundColor: t.hover, color: t.text } }}
        >
          <text style={{ fontSize: 11 }}>Rescan</text>
        </div>
      </div>
      {list(page, folded, fold, t, m)}
    </div>
  );
}

/** The groups and their items, scrolling. */
function list(page: Page | undefined, folded: string[], fold: (label: string) => void, t: ReturnType<typeof useTheme>, m: ReturnType<typeof useMetrics>) {
  if (!page) return null;
  if (page.groups.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
        <text style={{ fontSize: 11, color: t.muted }}>{page.empty}</text>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
      {page.groups.map((group) => {
        const open = !folded.includes(group.label);
        return (
          <div key={group.label} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div
              onClick={() => fold(group.label)}
              style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingLeft: 8, paddingRight: 8, flexShrink: 0, cursor: "pointer", hover: { backgroundColor: t.hover } }}
            >
              <Icon name={open ? "chevron_down" : "chevron_right"} size={11} color={t.faint} />
              <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{group.label}</text>
              </div>
              <text style={{ fontSize: 11, color: t.muted }}>{String(group.items.length)}</text>
            </div>
            {open
              ? group.items.map((item) => (
                  <div
                    key={`${group.label}/${item.name}`}
                    onClick={() => void run(group.dir, item.command).catch(swallow)}
                    style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 22, paddingLeft: 22, paddingRight: 8, flexShrink: 0, cursor: "pointer", hover: { backgroundColor: t.hover } }}
                  >
                    <text style={{ fontSize: 11, color: t.text, flexShrink: 0 }}>{item.name}</text>
                    {page.showDetail ? (
                      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                        <text style={{ fontSize: 11, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{item.detail}</text>
                      </div>
                    ) : null}
                  </div>
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}
