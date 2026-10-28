// The office's kit: the pixel font, the game's framed boxes, dark name tags,
// painted signs, hotbar slots, keycaps, the speech bubbles, and the room's art by path.
import { useSyncExternalStore, type ReactNode } from "react"
import { Icon, useTheme, type Tokens } from "pumi"
import { useAppearance } from "pumi/theme"

/** The typeface everything is drawn in: the theme brings it (`fonts/`). */
export const FONT = "Pixelify Sans"

/**
 * The room's art, by path. Not `import … from "./images/x.svg"`: a theme is loaded from disk when
 * the window draws it, and the app's module loader hands back an SVG without a default export —
 * a path is what `<img src>` and `backgroundImage` take anyway.
 */
export const art = (name: string) => `${import.meta.dir}/images/${name}.svg`

/** The floors, by the look in use; the size of a tile in points. */
export const FLOOR_TILES = { wood: [384, 192], carpet: [128, 128], rug: [128, 128], tile: [128, 128] } as const
export type FloorTile = keyof typeof FLOOR_TILES
export function useFloorArt(kind: FloorTile): { src: string; size: [number, number] } {
  const look = useAppearance()
  const [w, h] = FLOOR_TILES[kind]
  return { src: art(`floors/${look}/${kind}`), size: [w, h] }
}

/** A pixel sprite: nearest neighbour, never smoothed. */
export function Sprite({ src, width, height, style }: { src: string; width: number; height: number; style?: Record<string, unknown> }) {
  return <img src={src} style={{ width, height, flexShrink: 0, imageRendering: "pixelated", ...style }} />
}

// ── One clock for every pixel animation ────────────────────────────────────────────────────

const BEAT = 150
let beat = 0
let timer: ReturnType<typeof setInterval> | undefined
const beaters = new Set<() => void>()

function subscribeBeat(listener: () => void) {
  beaters.add(listener)
  timer ??= setInterval(() => {
    beat++
    for (const l of beaters) l()
  }, BEAT)
  return () => {
    beaters.delete(listener)
    if (!beaters.size && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

const still = () => 0
const noop = () => () => {}

/** A counter that goes up every `every` ms (a multiple of 150) while `on`: what frame to draw. */
export function useBeat(every: number, on = true): number {
  return useSyncExternalStore(on ? subscribeBeat : noop, on ? () => Math.floor(beat / Math.max(1, Math.round(every / BEAT))) : still)
}

// ── People ──────────────────────────────────────────────────────────────────────────────────

/** As many looks as the art has. */
export const LOOKS = 12

/** A number from a string, the same each time: who someone looks like. */
export function hash(s: string): number {
  let n = 2166136261
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619)
  return n >>> 0
}

export const walkArt = (look: number, facing: string, frame: number) => art(`walk/${look % LOOKS}-${facing}-${frame}`)
/** Someone at a desk, from the waist up, back to us: 24×24. */
export const sitArt = (who: string) => art(`sit/${hash(who) % LOOKS}`)

const BUBBLES = new Set(["working", "blocked", "error", "done"])

/** A speech bubble saying what someone is doing; "working" types its dots one at a time. */
export function Bubble({ status, style }: { status?: string; style?: Record<string, unknown> }) {
  const typing = useBeat(300, status === "working")
  if (!status || !BUBBLES.has(status)) return null
  const name = status === "working" ? ["working-0", "working-1", "working"][typing % 3] : status
  return <Sprite src={art(`bubbles/${name}`)} width={30} height={20} style={style} />
}

// ── Words on the map ────────────────────────────────────────────────────────────────────────

/** A name tag: a dark pill over whoever it names, with a dot for how they are. */
export function Nametag({ children, dot, dim, active, size = 12 }: { children: string; dot?: string; dim?: boolean; active?: boolean; size?: number }) {
  const t = useTheme()
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: size + 7,
        paddingLeft: dot ? 5 : 7,
        paddingRight: 7,
        borderRadius: 6,
        flexShrink: 1,
        minWidth: 0,
        backgroundColor: dim ? t.tagDim : t.tag,
        ...(active ? { borderWidth: 1, borderColor: t.slotActive } : {}),
      }}
    >
      {dot ? <div style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: dot }} /> : null}
      <text style={{ fontFamily: FONT, fontSize: size, color: dim ? t.tagTextDim : t.tagText, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{children}</text>
    </div>
  )
}

/** A painted plate, as a room's name is on its wall: square corners, a dark rim, a light edge. */
export function Sign({ children, before, onClick, title }: { children: string; before?: ReactNode; onClick?(): void; title?: string }) {
  const t = useTheme()
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 20,
        paddingLeft: before ? 5 : 8,
        paddingRight: 8,
        flexShrink: 1,
        minWidth: 0,
        ...box(t, "sign"),
        ...(onClick ? { cursor: "pointer", hover: { backgroundColor: t.signHover } } : {}),
      }}
    >
      {before}
      <text style={{ fontFamily: FONT, fontSize: 12, color: t.signText, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{children}</text>
    </div>
  )
}

/** A room's name on the plate over its top edge. */
export function RoomLabel({ children, dot, count, active, onClick, title }: { children: string; dot?: string; count?: number; active?: boolean; onClick?(): void; title?: string }) {
  const t = useTheme()
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 24,
        paddingLeft: dot ? 9 : 11,
        paddingRight: 11,
        borderRadius: 12,
        backgroundColor: t.roomLabel,
        borderWidth: active ? 2 : 1,
        borderColor: active ? t.roomRing : t.roomLabelRim,
        cursor: onClick ? "pointer" : undefined,
        pointerEvents: onClick ? "auto" : "none",
        hover: onClick ? { borderColor: t.roomRing } : undefined,
      }}
    >
      {dot ? <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} /> : null}
      <text style={{ fontFamily: FONT, fontSize: 14, color: t.roomLabelText, whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 260 }}>{children}</text>
      {count !== undefined ? <text style={{ fontFamily: FONT, fontSize: 12, color: t.faint }}>{`${count}`}</text> : null}
    </div>
  )
}

// ── The game's boxes ────────────────────────────────────────────────────────────────────────

/**
 * A framed box, as a pixel game draws its windows: a dark rim and a light ring inside it, square
 * corners. `dialog` is the menus' and the dialogs', `slot` the hotbar's, `sign` a plate.
 */
export function box(t: Tokens, kind: "dialog" | "slot" | "sign" | "panel" | "tag"): Record<string, unknown> {
  const [fill, rim, ring] = {
    dialog: [t.surface, t.rim, t.ring],
    panel: [t.surface, t.rim, t.ring],
    slot: [t.slot, t.slotRim, t.slotRing],
    sign: [t.sign, t.signRim, t.signRing],
    tag: [t.tag, t.tag, t.tag],
  }[kind]
  const width = kind === "sign" || kind === "tag" ? 1 : 2
  return {
    backgroundColor: fill,
    borderWidth: width,
    borderColor: rim,
    borderRadius: kind === "sign" ? 1 : 3,
    boxShadow: [
      ...(kind === "tag" ? [] : [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: width, color: ring, inset: true }]),
      ...(kind === "dialog" ? [{ offsetX: 4, offsetY: 4, blurRadius: 0, spreadRadius: 0, color: t.drop }] : []),
    ],
  }
}

/** A hotbar slot: a square framed button with its icon, its number in the corner, lit gold when on. */
export function Slot({ icon, glyph, label, number, active, onClick, size = 40 }: { icon?: string; glyph?: string; label: string; number?: string; active?: boolean; onClick(): void; size?: number }) {
  const t = useTheme()
  return (
    <div
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: "flex",
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        cursor: "pointer",
        ...box(t, "slot"),
        ...(active ? { borderColor: t.slotActive, boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 2, color: t.slotActiveRing, inset: true } } : {}),
        color: t.slotText,
        hover: { borderColor: t.slotActive },
        active: { backgroundColor: t.slotRing },
      }}
    >
      {number ? <text style={{ position: "absolute", top: 1, left: 4, fontFamily: FONT, fontSize: 9, color: t.slotNumber }}>{number}</text> : null}
      {glyph ? <text style={{ fontSize: Math.round(size * 0.42) }}>{glyph}</text> : icon ? <Icon name={icon} size={Math.round(size * 0.42)} color={active ? t.slotActive : t.slotText} /> : null}
    </div>
  )
}

/** A wide hotbar slot with its word: what the bar's main buttons are. */
export function WideSlot({ icon, label, active, onClick, number }: { icon: string; label: string; active?: boolean; onClick(): void; number?: string }) {
  const t = useTheme()
  return (
    <div
      onClick={onClick}
      title={label}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 40,
        paddingLeft: 12,
        paddingRight: 12,
        flexShrink: 0,
        position: "relative",
        cursor: "pointer",
        ...box(t, "slot"),
        ...(active ? { borderColor: t.slotActive, boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 2, color: t.slotActiveRing, inset: true } } : {}),
        hover: { borderColor: t.slotActive },
        active: { backgroundColor: t.slotRing },
      }}
    >
      {number ? <text style={{ position: "absolute", top: 1, left: 4, fontFamily: FONT, fontSize: 9, color: t.slotNumber }}>{number}</text> : null}
      <Icon name={icon} size={15} color={active ? t.slotActive : t.slotText} />
      <text style={{ fontFamily: FONT, fontSize: 14, color: active ? t.slotText : t.slotTextDim, whiteSpace: "nowrap" }}>{label}</text>
    </div>
  )
}

/** A square framed button, as a game's are. */
export function PixelButton({ icon, onClick, title, active, size = 28 }: { icon: string; onClick(): void; title?: string; active?: boolean; size?: number }) {
  const t = useTheme()
  return (
    <div
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: "flex",
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        ...box(t, "slot"),
        ...(active ? { borderColor: t.slotActive } : {}),
        color: t.slotText,
        cursor: "pointer",
        hover: { borderColor: t.slotActive },
        active: { backgroundColor: t.slotRing },
      }}
    >
      <Icon name={icon} size={Math.round(size / 2)} />
    </div>
  )
}

/** A keycap, as a game prints the key to press. */
export function Keycap({ children }: { children: string }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, paddingLeft: 5, paddingRight: 5, borderRadius: 3, backgroundColor: t.sign, borderWidth: 1, borderColor: t.signRim, boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 0, spreadRadius: 0, color: t.signRim } }}>
      <text style={{ fontFamily: FONT, fontSize: 12, color: t.signText }}>{children}</text>
    </div>
  )
}

/** A text button in a dialog: framed, filled when it is the one that goes ahead. */
export function DialogButton({ label, fill, onClick }: { label: string; fill?: string; onClick(): void }) {
  const t = useTheme()
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", height: 30, paddingLeft: 14, paddingRight: 14, cursor: "pointer", ...box(t, "slot"), ...(fill ? { backgroundColor: fill } : {}), hover: { borderColor: t.slotActive } }}>
      <text style={{ fontFamily: FONT, fontSize: 14, color: fill ? t.accentText : t.slotText }}>{label}</text>
    </div>
  )
}

/** A dialog's pointing hand: the ▶ before the choice you're on. */
export function Cursor({ on }: { on: boolean }) {
  const t = useTheme()
  const nudge = useBeat(300, on) % 2
  return (
    <div style={{ display: "flex", width: 14, paddingLeft: on ? nudge : 0, flexShrink: 0 }}>
      {on ? <text style={{ fontSize: 11, color: t.cursor }}>▶</text> : null}
    </div>
  )
}
