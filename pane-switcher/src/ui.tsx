// What the switcher draws, in the window's React tree: the row of cards, the one the highlight is
// on, and the keys that move it. It is the renderer of the block `switcher`, opened as a float over
// the window by its command (`main.ts`), so a switch from any tab of the session still shows it;
// the app's float takes the presses outside it and closes it on Escape (`dismiss`), so the view
// handles neither key nor click itself. The panes, the keys a card picks and the float it closes
// are `main.ts`'s: the view asks it and draws the answer.
import { useEffect, useRef, useState } from "react";
import { Icon, useMetrics, useTheme, type PaneId } from "pumi";

import { kindIcon } from "./cards.ts";
import { chord, keyed, type Action } from "./keys.ts";
import { closePane, dismiss, load, pick, triggerChord, type Opened } from "./main.ts";

/** The gap between two cards, and the strip's padding around them. */
const GAP = 10;
const PAD = 12;

/** What an error says, so a view that cannot read its panes says so in the log. */
function swallow(err: unknown): void {
  console.error(`pane-switcher: ${err instanceof Error ? err.message : String(err)}`);
}

/** One card's screen, and the pane it draws: what `scrollIntoView` needs to bring it into sight. */
interface Scrolls {
  scrollIntoView?(): void;
}

/** The `switcher` block's renderer: a card per pane, the highlight on the one a key or a click
 * picks. */
export function Switcher({ pane }: { pane: PaneId }) {
  const t = useTheme();
  const m = useMetrics();
  const [opened, setOpened] = useState<Opened | undefined>(undefined);
  const [at, setAt] = useState(0);
  /** The strip's width, as it is drawn: the cards sit in the middle of it while they fit. */
  const [width, setWidth] = useState(0);
  /** The chord that opens the switcher, which moves it on while it is up. */
  const [trigger, setTrigger] = useState<string | undefined>(undefined);
  const cards = useRef<Record<number, Scrolls | null>>({});
  const shown = opened?.cards ?? [];
  const cardWidth = opened?.cardWidth ?? 0;

  useEffect(() => {
    let live = true;
    void (async () => {
      const [read, chord] = await Promise.all([load(), triggerChord()]);
      if (!live) return;
      setOpened(read);
      setAt(read.at);
      setTrigger(chord === "" ? undefined : chord);
    })().catch(swallow);
    return () => {
      live = false;
    };
  }, []);

  // The highlighted card is scrolled into sight: the fewest pixels that bring it there.
  useEffect(() => {
    cards.current[at]?.scrollIntoView?.();
  }, [at, opened]);

  /** Puts the highlight on card `to`, as far as there are cards. */
  const go = (to: number) => {
    if (shown.length === 0) return;
    setAt(Math.min(Math.max(0, to), shown.length - 1));
  };

  /** Moves the highlight by `by` cards, round the ends. */
  const step = (by: number) => {
    const count = shown.length;
    if (count === 0) return;
    setAt((now) => (((now + by) % count) + count) % count);
  };

  /** Goes to the pane card `index` shows, and closes the switcher. */
  const commit = async (index: number) => {
    const card = shown[index];
    if (card) await pick(card.pane, pane);
    else await dismiss(pane);
  };

  /** Closes the pane card `index` shows and reads the rest again, closing the switcher when there
   * is nothing left to switch to. */
  const closeCard = async (index: number) => {
    const card = shown[index];
    if (!card) return;
    await closePane(card.pane);
    const next = await load(card.pane, index);
    setOpened(next);
    setAt(next.at);
    if (next.cards.length === 0) await dismiss(pane);
  };

  /** A key the switcher answers: what it does, and nothing behind it acts on the key too. */
  const press = (what: Action) => {
    if (what === "pick") void commit(at).catch(swallow);
    else if (what === "previous") step(-1);
    else if (what === "next") step(1);
    else if (what === "first") go(0);
    else if (what === "last") go(Number.MAX_SAFE_INTEGER);
    else if (what === "close") void closeCard(at).catch(swallow);
    else go(what.go);
  };

  // The cards sit in the middle of the strip while they fit in it, and start at its left edge when
  // they have to scroll: centring them as they overflow would clip the first ones.
  const fits = shown.length * cardWidth + Math.max(0, shown.length - 1) * GAP + 2 * PAD <= width;

  return (
    <div
      autoFocus
      tabIndex={0}
      onKeyDown={(e) => {
        const what = keyed(chord(e.key, e.modifiers), trigger);
        if (!what) return;
        e.preventDefault();
        e.stopPropagation();
        press(what);
      }}
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: t.surface }}
    >
      <div
        style={{
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          gap: 8,
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 10,
          paddingBottom: 6,
        }}
      >
        <Icon name="blocks" size={12} color={t.faint} />
        <text style={{ fontSize: 12, fontWeight: 500, color: t.text }}>Switch pane</text>
        <text style={{ fontSize: 12, color: t.faint }}>{String(shown.length)}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 12, color: t.faint }}>← → choose · enter go · esc close</text>
      </div>
      <div
        onLayout={(e) => setWidth(e.width ?? 0)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flexGrow: 1,
          minHeight: 0,
          paddingLeft: PAD,
          paddingRight: PAD,
          paddingBottom: PAD,
          gap: GAP,
          overflowX: "scroll",
          overflowY: "hidden",
          justifyContent: fits ? "center" : undefined,
        }}
      >
        {shown.length > 0
          ? shown.map((card, i) => (
              <div
                key={card.pane}
                ref={(el) => {
                  cards.current[i] = el;
                }}
                onMouseEnter={() => go(i)}
                onClick={() => {
                  go(i);
                  void commit(i).catch(swallow);
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flexShrink: 0,
                  width: cardWidth,
                  borderRadius: m.radius,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: i === at ? t.accent : t.border,
                  backgroundColor: i === at ? t.hover : t.window,
                  cursor: "pointer",
                  hover: i === at ? undefined : { backgroundColor: t.active },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexShrink: 0,
                    height: (opened?.rows ?? 0) * m.fontSize,
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {card.preview ? (
                    <preview pane={card.pane} style={{ width: "100%", height: "100%" }} />
                  ) : (
                    <Icon name={kindIcon(card.kind)} size={28} color={t.faint} />
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flexShrink: 0,
                    gap: 1,
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingTop: 5,
                    paddingBottom: 6,
                    borderTopWidth: 1,
                    borderColor: t.border,
                  }}
                >
                  <div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 7 }}>
                    <Icon name={kindIcon(card.kind)} size={12} color={i === at ? t.text : t.muted} />
                    <text
                      style={{
                        flexGrow: 1,
                        minWidth: 0,
                        fontSize: 12,
                        fontWeight: 500,
                        color: i === at ? t.text : t.muted,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {card.title}
                    </text>
                    {card.status !== "" ? (
                      <div
                        aria-label={card.status}
                        style={{
                          width: 7,
                          height: 7,
                          flexShrink: 0,
                          borderRadius: 4,
                          backgroundColor: t[`agent.${card.status}`] ?? t["agent.unknown"],
                        }}
                      />
                    ) : null}
                  </div>
                  {card.detail !== "" ? (
                    <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {card.detail}
                    </text>
                  ) : null}
                </div>
              </div>
            ))
          : opened
            ? empty(t)
            : null}
      </div>
    </div>
  );
}

/** Nothing to switch to: the scope found no panes. */
function empty(t: ReturnType<typeof useTheme>) {
  return (
    <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
      <text style={{ fontSize: 12, color: t.muted }}>No panes to switch to</text>
    </div>
  );
}
