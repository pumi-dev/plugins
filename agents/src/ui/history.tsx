// The Agents Archive panel (`panel`, from `ui.tsx`'s `History` export): every session the enabled
// agents have kept on this Mac, newest first, in Today / Past Week / Older, a search over their
// titles and directories, and a press to open one in a chat tab that resumes it (`history.ts` finds
// them, `main.ts` opens them).
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, IconImage, useMetrics, useTheme } from "pumi";

import { ago, groups, items as flatten, matching, where, type Past, type PastSession } from "../history.ts";
import { historyShow, openPast } from "../main.ts";

function swallow(err: unknown): void {
  console.error(`agents: ${err instanceof Error ? err.message : String(err)}`);
}

/** A session's row (its title over where it ran) and a group's name, for the list's estimates. */
const ROW = 46;
const HEADING = 26;
/** How many items are made beyond what shows, so scrolling does not wait for a frame. */
const OVERSCAN = 12;

/** The `panel` slot's component: the agent sessions on this Mac, to go back into. */
export function History() {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [past, setPast] = useState<Past>();
  const [query, setQuery] = useState("");
  useEffect(() => {
    historyShow()
      .then((got) => setPast(got))
      .catch(swallow);
  }, []);
  const sessions = useMemo(() => matching(past?.sessions ?? [], query), [past, query]);
  const shown = useMemo(() => groups(sessions), [sessions]);
  const rows = useMemo(() => flatten(shown), [shown]);
  // The items made: a window over `rows`, moved as the list scrolls.
  const [made, setMade] = useState({ start: 0, end: OVERSCAN * 2 });
  const scroller = useRef<any>(null);
  useEffect(() => {
    setMade({ start: 0, end: OVERSCAN * 2 });
    scroller.current?.scrollToItem?.(0);
  }, [query]);
  const count = rows.length;
  const start = Math.max(0, Math.min(made.start, Math.max(0, count - 1)));
  const end = Math.min(count, Math.max(made.end, start));
  const list = count === 0 ? undefined : { items: rows, count, start, end };
  const marks = past?.marks ?? {};
  const open = (session: PastSession) => {
    void openPast({ agent: session.agent, session: session.session, cwd: session.cwd }).catch(swallow);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: t.surface }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: "100%", height: 34, flexShrink: 0, paddingLeft: 12, paddingRight: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.border }}>
        <Icon name="magnifying_glass" size={14} color={focused ? t.muted : t.faint} />
        <input
          aria-label="Search agent sessions"
          value={query}
          placeholder="Search all sessions…"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setQuery(e.value ?? "")}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 22, fontSize: 13, color: t.text, backgroundColor: "transparent" }}
        />
      </div>
      {list === undefined ? (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
          <text style={{ fontSize: 12, color: t.faint, paddingLeft: 14, paddingTop: 8 }}>
            {past === undefined ? "Reading…" : query.trim() === "" ? "No agent sessions here yet." : "Nothing matches that."}
          </text>
        </div>
      ) : (
        <virtual-list
          ref={scroller}
          itemCount={list.count}
          estimatedItemHeight={ROW}
          windowStart={list.start}
          overdraw={ROW * 8}
          aria-label="Agent sessions"
          onVisibleRange={(e: any) => {
            const first = e?.startIndex ?? 0;
            const last = e?.endIndex ?? first;
            // The window moves once what shows comes within half an overscan of its edge.
            setMade((had) => {
              if (first - had.start >= OVERSCAN / 2 && had.end - last >= OVERSCAN / 2) return had;
              const next = { start: Math.max(0, first - OVERSCAN), end: last + OVERSCAN };
              return next.start === had.start && next.end === had.end ? had : next;
            });
          }}
          style={{ flexGrow: 1, minHeight: 0 }}
        >
          {Array.from({ length: list.end - list.start }, (_, i) => {
            const item = list.items[list.start + i]!;
            return item.kind === "group" ? (
              <Heading key={item.key} title={item.title} />
            ) : (
              <Row key={item.key} session={item.session} mark={marks[item.session.agent]} onPress={() => open(item.session)} />
            );
          })}
        </virtual-list>
      )}
    </div>
  );
}

/** A group's name, above the rows it holds. */
function Heading({ title }: { title: string }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0, height: HEADING, paddingLeft: 14, paddingTop: 6 }}>
      <text style={{ fontSize: 11, fontWeight: 600, color: t.faint }}>{title}</text>
    </div>
  );
}

/** One session: its agent's mark, its title, and where and when it ran. */
function Row({ session, mark, onPress }: { session: PastSession; mark?: string; onPress(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-label={`${session.title}: ${session.name}, ${where(session.cwd)}`}
      title={`${session.title}\n${session.cwd}`}
      onClick={onPress}
      onKeyDown={(event: { key?: string }) => (event.key === "enter" ? onPress() : undefined)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, paddingLeft: 12, paddingRight: 10, paddingTop: 6, paddingBottom: 6, cursor: "pointer", hover: { backgroundColor: t.hover } }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, flexShrink: 0 }}>
        {mark ? <IconImage icon={{ src: mark, tint: true }} size={14} color={t.text} /> : <Icon name="sparkle" size={12} color={t.muted} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <text style={{ fontSize: m.fontSize, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{session.title}</text>
        <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {`${where(session.cwd)} · ${ago(session.updatedAt)}`}
        </text>
      </div>
    </div>
  );
}
