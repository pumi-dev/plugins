// The board, in the window's `overlay` slot: four lanes, a card per flight — and a card for every
// other agent pumi is running, in the lane its own status puts it in. It reads the server's panes
// live (`usePanes`) so a card moves the moment its agent says something, and the flights from the
// worker (`main.ts`) — which owns the briefs, the panes it opened and the recorder.
//
// It is drawn over the whole window, above the panes and the side bar, while the plugin's `shown`
// option is set: the side bar's footer button, `pumi call amresyd.kanban.open`, or the palette
// put it there, and Escape or a click outside it takes it away. One press on a card goes to its
// agent: that is what the board is for. Dragging is how a card is told what to do — the lanes light
// up with the verb they would take.
import { useEffect, useMemo, useState } from "react";
import {
  Icon,
  useChannel,
  useChannelListener,
  useDragState,
  useDroppable,
  useMetrics,
  useNow,
  useOption,
  usePanes,
  usePlugin,
  useSession,
  useTheme,
  type AgentTrait,
  type Pane,
} from "pumi";

import { ACTION_LABEL, dropActionFor, folderOf, place, stopwatch, type DropAction, type Facts, type Flight, type Lane } from "./flight.ts";
import type { Snapshot } from "./main.ts";
import { clear, closeAgent, drawn, file, focus, go, hide, land, launch, load, park, revive } from "./main.ts";
import { DragGhost, FlightCard, type DragData } from "./ui/card.tsx";
import { Composer } from "./ui/panels.tsx";
import { Dot, Press, tint, toneColor } from "./ui/kit.tsx";
import { EMPTY_BOARD, LANE_EMPTY, LANE_TITLE, agentTitle, arrange, countOf, laneTone } from "./ui/view.ts";
import type { CardView } from "./ui/view.ts";

interface Notice {
  text: string;
  level: "info" | "error";
  at: number;
}

const LANES: Lane[] = ["queued", "flying", "holding", "landed"];

function told(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A pane's agent, when it has one: a terminal is not a card until an agent reports itself in it. */
function agentOf(pane: Pane | undefined): AgentTrait | undefined {
  return (pane?.traits as { agent?: AgentTrait } | undefined)?.agent;
}

/** A flight's card: what was filed, and what its agent is doing about it. */
function flightCard(flight: Flight, byId: Map<string, Pane>, now: number): CardView {
  const pane = flight.pane === null ? undefined : byId.get(flight.pane);
  const agent = agentOf(pane);
  const live = { alive: pane !== undefined, status: agent?.status ?? null, queue: agent?.queue?.length ?? 0 };
  return {
    id: flight.id,
    kind: "flight",
    title: flight.title,
    brief: flight.brief,
    cwd: flight.cwd,
    agent: flight.agent,
    note: flight.note,
    turns: flight.turns,
    pane: flight.pane,
    flight,
    place: place(flight, live, now),
    alive: live.alive,
    queue: live.queue,
    status: live.status,
    model: agent?.model ?? null,
  };
}

/** A live agent nobody filed: an agent started in a terminal, shown as the pane it is. */
function liveCard(pane: Pane, agent: AgentTrait, now: number): CardView {
  const live = { alive: true, status: agent.status ?? null, queue: agent.queue?.length ?? 0 };
  const facts: Facts = { pane: pane.id, launchedAt: null, landedAt: null, launching: false, launches: 0 };
  const said = pane.title ?? pane.process?.command?.join(" ") ?? "Agent";
  return {
    id: pane.id,
    kind: "agent",
    title: agentTitle(said, folderOf(pane.cwd ?? ""), agent.name ?? ""),
    brief: "",
    cwd: pane.cwd ?? "",
    agent: agent.name ?? "",
    note: "",
    turns: 0,
    pane: pane.id,
    place: place(facts, live, now),
    alive: true,
    queue: live.queue,
    status: live.status,
    model: agent.model ?? null,
  };
}

/** The window's `overlay` slot: the board is up while the plugin's `shown` option is set. */
export function Board() {
  const plugin = usePlugin() ?? "amresyd/kanban";
  const [shown] = useOption<boolean>("shown", { scope: "plugin", id: plugin });
  return shown ? <Overlay /> : null;
}

function Overlay() {
  const t = useTheme();
  const m = useMetrics();
  const now = useNow(1000);
  const session = useSession();
  const plugin = usePlugin() ?? "amresyd/kanban";
  const prefix = `${plugin.replace("/", ".")}.`;
  const [agentDefault] = useOption<string>(`${prefix}agent`);

  const pushed = useChannel<Snapshot | undefined>("board", undefined);
  const notice = useChannel<Notice | undefined>("notice", undefined);
  const [flights, setFlights] = useState<Flight[] | null>(null);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [searching, setSearching] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [shownNotice, setShownNotice] = useState<Notice | null>(null);
  const drag = useDragState<DragData>();

  useEffect(() => {
    let live = true;
    void drawn().catch(() => {});
    load()
      .then((board) => live && setFlights(board.flights))
      .catch((err) => console.error(`kanban: loading: ${told(err)}`));
    return () => {
      live = false;
    };
  }, []);

  // A notice from the worker: said for a few seconds, then gone.
  useEffect(() => {
    if (!notice) return;
    setShownNotice(notice);
    const timer = setTimeout(() => setShownNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice?.at]);

  useChannelListener("compose", () => setComposing(true));

  const all = pushed?.flights ?? flights ?? [];
  const panes = usePanes();
  const byId = useMemo(() => new Map(panes.map((each) => [each.id, each])), [panes]);
  const cards = useMemo(() => {
    const filed = all.map((flight) => flightCard(flight, byId, now));
    const owned = new Set(all.flatMap((flight) => (flight.pane === null ? [] : [flight.pane])));
    const loose = panes.flatMap((each) => {
      const agent = agentOf(each);
      return agent === undefined || owned.has(each.id) ? [] : [liveCard(each, agent, now)];
    });
    return [...filed, ...loose];
  }, [all, panes, byId, now]);
  const lanes = useMemo(() => arrange(cards, query), [cards, query]);
  const counts = useMemo(() => countOf(cards), [cards]);
  const cardOf = (id: string) => cards.find((card) => card.id === id);

  const act = (id: string, lane: Lane) => {
    const card = cardOf(id);
    if (!card) return;
    const action = dropActionFor(card.kind, card.place.lane, lane);
    if (action === null) return;
    if (action === "close") {
      void closeAgent(card.id).catch((err) => console.error(`kanban: close: ${told(err)}`));
      return;
    }
    if (action === "take") {
      void focus(card.id).catch((err) => console.error(`kanban: focus: ${told(err)}`));
      return;
    }
    void run(action, card.id).catch((err) => console.error(`kanban: ${action}: ${told(err)}`));
  };

  const run = (action: Exclude<DropAction, "close" | "take">, id: string) => {
    switch (action) {
      case "launch":
      case "fly":
        return launch(id);
      case "park":
        return park(id);
      case "land":
        return land(id);
      case "revive":
        return revive(id);
    }
  };

  const cwdDefault = session?.cwd ?? "";

  return (
    <div
      onClick={() => void hide()}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tint(t.window, 0.55),
        // The theme's overlay layer lets the mouse through (`pointerEvents: "none"`), so a closed
        // board blocks nothing; the open board is modal and takes it back, the wheel included.
        pointerEvents: "auto",
      }}
    >
    <div
      onClick={(e: any) => e?.stopPropagation?.()}
      autoFocus
      tabIndex={0}
      onLayout={(e: any) => {
        const x = Math.round(e?.x ?? 0);
        const y = Math.round(e?.y ?? 0);
        setOrigin((was) => (was.x === x && was.y === y ? was : { x, y }));
      }}
      onKeyDown={(e: any) => {
        const key = typeof e?.key === "string" ? e.key : "";
        const mod = e?.modifiers?.cmd === true || e?.modifiers?.ctrl === true;
        if (key === "escape") {
          e?.preventDefault?.();
          if (composing) setComposing(false);
          else void hide();
          return;
        }
        if (mod || typing) return;
        if (key === "n") {
          e?.preventDefault?.();
          setComposing(true);
        } else if (key === "/") {
          e?.preventDefault?.();
          setSearching(true);
        }
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "94%",
        height: "92%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        borderRadius: m.radius + 4,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.surface,
        boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: tint("#000000", 0.5) },
        color: t.text,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: 48, flexShrink: 0, paddingLeft: 14, paddingRight: 12, borderBottomWidth: 1, borderColor: t.border }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Icon name="zap" size={14} color={t.accent} />
          <text style={{ fontSize: m.fontSize + 1, fontWeight: 600, color: t.text }}>Kanban</text>
        </div>
        <Counts counts={counts} agents={cards.length} />
        <div style={{ display: "flex", flexGrow: 1 }} />
        <SearchBox
          value={query}
          autoFocus={searching}
          onChange={setQuery}
          onFocus={() => setTyping(true)}
          onBlur={() => {
            setTyping(false);
            setSearching(false);
          }}
        />
        {counts.landed > 0 ? (
          <Press tip="Clear the landed cards" onClick={() => void clear().catch(() => {})} style={{ width: 26, height: 26, borderRadius: m.radiusSmall, hover: { backgroundColor: t.hover } }}>
            <Icon name="dash" size={12} color={t.muted} />
          </Press>
        ) : null}
        <Press
          onClick={() => setComposing(true)}
          style={{ height: 26, paddingLeft: 10, paddingRight: 12, gap: 4, borderRadius: m.radiusSmall, backgroundColor: t.accent, hover: { backgroundColor: tint(t.accent, 0.9) } }}
        >
          <Icon name="plus" size={11} color={t.accentText} />
          <text style={{ fontSize: m.fontSize - 1, fontWeight: 500, color: t.accentText }}>New card</text>
        </Press>
        <Press tip="Close the board (Esc)" onClick={() => void hide()} style={{ width: 26, height: 26, borderRadius: m.radiusSmall, hover: { backgroundColor: t.hover } }}>
          <Icon name="close" size={12} color={t.muted} />
        </Press>
      </div>

      {cards.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 0 }}>
          <Icon name="sparkle" size={14} color={t["agent.done"] ?? t.success} />
          <text style={{ flexGrow: 1, fontSize: m.fontSize - 2, color: t.muted, whiteSpace: "normal" }}>{EMPTY_BOARD}</text>
          <Press
            onClick={() => setComposing(true)}
            style={{ height: 24, paddingLeft: 9, paddingRight: 9, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, hover: { backgroundColor: t.hover } }}
          >
            <text style={{ fontSize: m.fontSize - 2, color: t.accent }}>Add the first one</text>
          </Press>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, gap: 10, padding: 10 }}>
        {LANES.map((lane) => (
          <LaneColumn
            key={lane}
            lane={lane}
            cards={lanes[lane]}
            now={now}
            dragCard={drag ? cardOf(drag.data.id) : undefined}
            cardOf={cardOf}
            agentDefault={agentDefault ?? "pi"}
            onDrop={act}
            onNew={() => setComposing(true)}
            onGo={(id) => void go(id).catch((err) => console.error(`kanban: go: ${told(err)}`))}
            onLand={(id) => void land(id).catch(() => {})}
            onClosePane={(id) => void closeAgent(id).catch(() => {})}
          />
        ))}
      </div>

      {composing ? (
        <Composer
          agentDefault={agentDefault ?? "pi"}
          cwdDefault={cwdDefault}
          onClose={() => setComposing(false)}
          onFile={(input) => {
            setComposing(false);
            void file(input).catch((err) => console.error(`kanban: filing: ${told(err)}`));
          }}
        />
      ) : null}

      {shownNotice !== null ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, display: "flex", flexDirection: "row", justifyContent: "center", pointerEvents: "none", zIndex: 60 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              maxWidth: 560,
              paddingLeft: 11,
              paddingRight: 11,
              paddingTop: 7,
              paddingBottom: 7,
              borderRadius: m.radius,
              backgroundColor: t.overlay,
              borderWidth: 1,
              borderColor: t.border,
              boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: tint("#000000", 0.4) },
            }}
          >
            <Icon name={shownNotice.level === "error" ? "status_alert" : "check"} size={11} color={shownNotice.level === "error" ? t.error : t.success} />
            <text style={{ fontSize: m.fontSize - 2, color: t.text, whiteSpace: "normal" }}>{shownNotice.text}</text>
          </div>
        </div>
      ) : null}

      {drag && cardOf(drag.data.id) !== undefined ? (
        <DragGhost card={cardOf(drag.data.id)!} x={drag.x - origin.x - 40} y={drag.y - origin.y - 22} />
      ) : null}
    </div>
    </div>
  );
}

/** What the counts say, in the header: who is in the air, who wants a person, what is waiting. */
function Counts({ counts, agents }: { counts: ReturnType<typeof countOf>; agents: number }) {
  const t = useTheme();
  const m = useMetrics();
  const items: { label: string; count: number; color: string }[] = [
    { label: "in flight", count: counts.flying, color: t["agent.working"] ?? t.accent },
    { label: "needs you", count: counts.needs, color: t["agent.blocked"] ?? t.warning },
    { label: "waiting", count: counts.waiting, color: t["agent.idle"] ?? t.faint },
    { label: "landed", count: counts.landed, color: t["agent.done"] ?? t.success },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
      <text style={{ fontSize: m.fontSize - 2, color: t.faint }}>{`${agents} ${agents === 1 ? "agent" : "agents"}`}</text>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Dot color={item.count === 0 ? t.faint : item.color} size={5} />
          <text style={{ fontSize: m.fontSize - 2, color: item.count === 0 ? t.faint : t.muted }}>{`${item.count} ${item.label}`}</text>
        </div>
      ))}
    </div>
  );
}

/** The search field: `/` gives it the keyboard, Escape gives it back to the board. */
function SearchBox({
  value,
  autoFocus,
  onChange,
  onFocus,
  onBlur,
}: {
  value: string;
  autoFocus: boolean;
  onChange(value: string): void;
  onFocus(): void;
  onBlur(): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        width: focused ? 220 : 168,
        height: 26,
        paddingLeft: 7,
        paddingRight: 6,
        borderRadius: m.radiusSmall,
        backgroundColor: t.editor,
        borderWidth: 1,
        borderColor: focused ? t.accent : t.border,
      }}
    >
      <Icon name="magnifying_glass" size={11} color={t.faint} />
      <input
        key={autoFocus ? "wanted" : "idle"}
        value={value}
        autoFocus={autoFocus}
        placeholder="Search agents"
        onChange={(e: any) => onChange(e?.value ?? "")}
        onFocus={() => {
          setFocused(true);
          onFocus();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur();
        }}
        style={{ flexGrow: 1, minWidth: 0, fontSize: m.fontSize - 1, color: t.text }}
      />
      {value !== "" ? (
        <Press onClick={() => onChange("")} style={{ width: 14, height: 14, borderRadius: 3, hover: { backgroundColor: t.hover } }}>
          <Icon name="close" size={9} color={t.faint} />
        </Press>
      ) : null}
    </div>
  );
}

/** One lane: its name and count, and the cards in it — a drop target with the verb it would take. */
function LaneColumn({
  lane,
  cards,
  now,
  dragCard,
  cardOf,
  agentDefault,
  onDrop,
  onNew,
  onGo,
  onLand,
  onClosePane,
}: {
  lane: Lane;
  cards: CardView[];
  now: number;
  dragCard: CardView | undefined;
  cardOf(id: string): CardView | undefined;
  agentDefault: string;
  onDrop(id: string, lane: Lane): void;
  onNew(): void;
  onGo(id: string): void;
  onLand(id: string): void;
  onClosePane(id: string): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  const tone = toneColor(t, laneTone(lane, cards));
  const action = dragCard === undefined ? null : dropActionFor(dragCard.kind, dragCard.place.lane, lane);
  const { ref, isOver } = useDroppable<DragData>({
    accept: (data): data is DragData => {
      if (typeof data !== "object" || data === null) return false;
      const card = cardOf((data as DragData).id);
      return card !== undefined && dropActionFor(card.kind, card.place.lane, lane) !== null;
    },
    onDrop: (data) => onDrop(data.id, lane),
  });
  const glow = isOver && action !== null;
  const queue = lane === "queued" || lane === "landed";
  const turns = cards.reduce((sum, card) => sum + card.turns, 0);
  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        minHeight: 0,
        borderRadius: m.radius,
        backgroundColor: glow ? tint(tone, 0.08) : t.editor,
        borderWidth: 1,
        borderColor: glow ? tint(tone, 0.7) : t.border,
        borderStyle: glow ? "dashed" : "solid",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 34, flexShrink: 0, paddingLeft: 11, paddingRight: 6, borderBottomWidth: 1, borderColor: t.border }}>
        <Dot color={cards.length === 0 ? t.faint : tone} size={6} />
        <text style={{ fontSize: m.fontSize - 1, fontWeight: 600, color: cards.length === 0 ? t.muted : t.text }}>{LANE_TITLE[lane]}</text>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 16, height: 15, paddingLeft: 4, paddingRight: 4, borderRadius: m.radiusSmall, backgroundColor: t.hover }}>
          <text style={{ fontSize: m.fontSize - 3, fontWeight: 600, color: cards.length === 0 ? t.faint : tone }}>{String(cards.length)}</text>
        </div>
        <div style={{ display: "flex", flexGrow: 1 }} />
        {action !== null ? (
          <div style={{ display: "flex", paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, borderRadius: m.radiusSmall, backgroundColor: tint(tone, 0.18) }}>
            <text style={{ fontSize: m.fontSize - 3, fontWeight: 600, color: tone }}>{ACTION_LABEL[action]}</text>
          </div>
        ) : (
          <>
            {turns > 0 && lane === "landed" ? <text style={{ fontSize: m.fontSize - 3, color: t.faint }}>{`${turns} turns`}</text> : null}
            {queue ? (
              <Press tip="Add a card here" onClick={onNew} style={{ width: 18, height: 18, borderRadius: m.radiusSmall, hover: { backgroundColor: t.hover } }}>
                <Icon name="plus" size={11} color={t.muted} />
              </Press>
            ) : null}
          </>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          gap: 7,
          padding: 8,
          overflowY: "scroll",
        }}
      >
        {glow && action !== null ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, flexShrink: 0, height: 30, borderRadius: m.radius, borderWidth: 1, borderStyle: "dashed", borderColor: tint(tone, 0.55), backgroundColor: tint(tone, 0.07) }}>
            <Icon name="arrow_up_right" size={10} color={tone} />
            <text style={{ fontSize: m.fontSize - 2, fontWeight: 600, color: tone }}>{ACTION_LABEL[action]}</text>
          </div>
        ) : null}
        {cards.map((card) => (
          <FlightCard key={card.id} card={card} now={now} agentDefault={agentDefault} onGo={onGo} onLand={onLand} onClosePane={onClosePane} />
        ))}
        {cards.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, minHeight: 60, gap: 5, padding: 12 }}>
            <text style={{ fontSize: m.fontSize - 2, color: t.faint, textAlign: "center", whiteSpace: "normal" }}>{LANE_EMPTY[lane]}</text>
          </div>
        ) : null}
        {cards.length > 0 && lane === "holding" && waitedLongest(cards, now) > 0 ? (
          <text style={{ fontSize: m.fontSize - 3, color: t.faint, paddingLeft: 2 }}>{`waiting on you for ${stopwatch(waitedLongest(cards, now))}`}</text>
        ) : null}
      </div>
    </div>
  );
}

/** How long the oldest holding card has waited. */
function waitedLongest(cards: CardView[], now: number): number {
  let longest = 0;
  for (const card of cards) {
    const flight = card.flight;
    if (flight === undefined) continue;
    const waited = flight.launchedAt === null ? 0 : now - flight.launchedAt;
    if (waited > longest) longest = waited;
  }
  return longest;
}
