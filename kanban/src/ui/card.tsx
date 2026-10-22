// A card, as the board draws it: a brief with a life of its own — or a live agent nobody filed, in
// the lane its own status puts it in. One press goes to the agent (that is the whole point), a drag
// is how a lane is told what to do, and the small buttons that show on hover file or close it.
import { Icon, useDraggable, useHover, useMetrics, useTheme } from "pumi";

import { commandLine, folderOf, stopwatch, tilde } from "../flight.ts";
import { since, type CardView } from "./view.ts";
import { Chip, Press, StatusMark, tint, toneColor } from "./kit.tsx";

/** What a drag carries: enough to find the card again. */
export interface DragData {
  id: string;
}

export function FlightCard({
  card,
  now,
  agentDefault,
  onGo,
  onLand,
  onClosePane,
}: {
  card: CardView;
  now: number;
  agentDefault: string;
  onGo(id: string): void;
  onLand(id: string): void;
  onClosePane(id: string): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  const [hovered, hover] = useHover();
  const drag = useDraggable<DragData>({ id: card.id });
  const tone = toneColor(t, card.place.tone);
  const waiting = since(card, now);
  const agent = card.agent === "" ? "" : (commandLine(card.agent)[0] ?? "");
  const landed = card.place.lane === "landed";

  return (
    <div
      {...drag.props}
      {...hover}
      onClick={() => {
        if (drag.wasDragged()) return;
        onGo(card.id);
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flexShrink: 0,
        paddingTop: 9,
        paddingBottom: 10,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: m.radius,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: hovered ? tint(tone, 0.55) : t.border,
        overflow: "hidden",
        cursor: "pointer",
        opacity: drag.dragging ? 0.5 : 1,
        boxShadow: hovered ? { offsetX: 0, offsetY: 4, blurRadius: 12, spreadRadius: 0, color: tint("#000000", 0.35) } : undefined,
        hover: { backgroundColor: t.hover },
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 7 }}>
        <div style={{ display: "flex", paddingTop: 1 }}>
          <StatusMark tone={card.place.tone} size={m.fontSize} />
        </div>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: m.fontSize, fontWeight: 600, color: landed ? t.muted : t.text, lineClamp: 2, whiteSpace: "normal" }}>
            {card.title}
          </text>
        </div>
        {hovered ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
            {card.kind === "flight" && !landed ? (
              <Press tip="Land it" onClick={() => onLand(card.id)} style={{ width: 18, height: 18, borderRadius: m.radiusSmall, hover: { backgroundColor: t.hover } }}>
                <Icon name="check" size={11} color={t.muted} />
              </Press>
            ) : null}
            {card.kind === "agent" ? (
              <Press tip="Close its pane" onClick={() => onClosePane(card.id)} style={{ width: 18, height: 18, borderRadius: m.radiusSmall, hover: { backgroundColor: t.hover } }}>
                <Icon name="close" size={10} color={t.error} />
              </Press>
            ) : null}
            {card.kind === "flight" ? (
              <Press tip="Go to its agent" onClick={() => onGo(card.id)} style={{ width: 18, height: 18, borderRadius: m.radiusSmall, hover: { backgroundColor: t.hover } }}>
                <Icon name="arrow_up_right" size={11} color={t.muted} />
              </Press>
            ) : null}
          </div>
        ) : null}
      </div>

      {card.brief !== "" && card.brief.trim().toLowerCase() !== card.title.toLowerCase() ? (
        <text style={{ fontSize: m.fontSize - 2, color: t.muted, lineClamp: 2, whiteSpace: "normal" }}>{card.brief}</text>
      ) : null}

      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        <Chip color={tone} background={tint(tone, 0.14)}>
          {card.place.reason}
        </Chip>
        {agent !== "" ? <Chip>{agent}</Chip> : null}
        {card.cwd !== "" ? <Chip>{folderOf(tilde(card.cwd, home()))}</Chip> : null}
        {card.turns > 0 ? <Chip>{card.turns === 1 ? "1 turn" : `${card.turns} turns`}</Chip> : null}
        {card.queue > 0 ? (
          <Chip color={t["agent.working"] ?? t.accent} background={tint(t["agent.working"] ?? t.accent, 0.14)}>
            {card.queue === 1 ? "1 queued" : `${card.queue} queued`}
          </Chip>
        ) : null}
        {waiting !== null && !landed ? <text style={{ fontSize: m.fontSize - 3, color: t.faint }}>{stopwatch(waiting)}</text> : null}
      </div>

      {card.note !== "" && (landed || card.place.lane === "holding") ? (
        <div style={{ display: "flex", flexDirection: "row", gap: 6, paddingLeft: 6, borderLeftWidth: 2, borderColor: tint(tone, 0.55) }}>
          <text style={{ fontSize: m.fontSize - 3, color: t.faint, lineClamp: 2, whiteSpace: "normal" }}>{card.note}</text>
        </div>
      ) : null}
    </div>
  );
}

/** The card that follows the pointer while one is carried, so a drag is never a guess. */
export function DragGhost({ card, x, y }: { card: CardView; x: number; y: number }) {
  const t = useTheme();
  const m = useMetrics();
  const tone = toneColor(t, card.place.tone);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 228,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: 10,
        borderRadius: m.radius,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: tint(tone, 0.7),
        opacity: 0.94,
        zIndex: 40,
        pointerEvents: "none",
        boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: tint("#000000", 0.5) },
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7 }}>
        <StatusMark tone={card.place.tone} size={m.fontSize} />
        <text style={{ flexGrow: 1, minWidth: 0, fontSize: m.fontSize, fontWeight: 600, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{card.title}</text>
        <text style={{ fontSize: m.fontSize - 3, color: tone }}>{card.place.reason}</text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Icon name="arrow_up_right" size={10} color={t.faint} />
        <text style={{ fontSize: m.fontSize - 3, color: t.faint }}>Drop it on a lane to give it a verb</text>
      </div>
    </div>
  );
}

/** The home directory, for a chip: the renderer's labels are long enough without it. */
function home(): string {
  return (globalThis.process as { env?: Record<string, string> } | undefined)?.env?.HOME ?? "";
}
