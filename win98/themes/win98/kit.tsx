// What every part of the Windows 98 window is made of: the bevels (two nested boxes, a colour a
// side, as the system drew them), its push buttons and caption buttons, its glyphs and its art.
import { memo, type ReactNode } from "react"
import { Icon, useTheme } from "pumi"

export type Tokens = ReturnType<typeof useTheme>

export const swallow = (err: unknown) => console.error(String(err))
export const stop = (e: any) => e?.stopPropagation?.()

/** The system's face, as macOS has it nearest: Tahoma at 11. */
export const FONT = "Tahoma"

// ── Art and glyphs ─────────────────────────────────────────────────────────────────────────────

/** A picture of the theme's (a 16-pixel icon, drawn crisp at 32 or 16), by name: `images/<name>.svg`. */
export const art = (name: string) => `${import.meta.dir}/images/${name}.svg`
/** A glyph of the theme's: one colour, drawn in the colour it is given. */
const glyphPath = (name: string) => `${import.meta.dir}/glyphs/${name}.svg`

/** One of the theme's pictures, crisp. */
export const Art = memo(function Art({ name, size = 16, style }: { name: string; size?: number; style?: Record<string, unknown> }) {
  return <img src={art(name)} style={{ width: size, height: size, flexShrink: 0, imageRendering: "pixelated", pointerEvents: "none", ...style }} />
})

/** A picture with its own colours from the glyphs (the Start band, the size grip). */
export const Picture = memo(function Picture({ name, width, height }: { name: string; width: number; height: number }) {
  return <img src={glyphPath(name)} style={{ width, height, flexShrink: 0, imageRendering: "pixelated", pointerEvents: "none" }} />
})

/** One of the theme's glyphs (a caption button's, a check, a menu's arrow), at its own pixel size. */
export const Glyph = memo(function Glyph({ name, width, height, color = "#000000" }: { name: string; width: number; height: number; color?: string }) {
  return <svg src={glyphPath(name)} style={{ width, height, flexShrink: 0, color, pointerEvents: "none" }} />
})

const GLYPH_SIZE: Record<string, [number, number]> = {
  minimize: [8, 7],
  maximize: [9, 9],
  restore: [8, 8],
  close: [8, 7],
  check: [7, 7],
  arrow_right: [4, 7],
  arrow_down: [7, 4],
  dot: [6, 6],
  plus_box: [9, 9],
  minus_box: [9, 9],
}

/** A glyph by name at its own size. */
export function Mark({ name, color }: { name: string; color?: string }) {
  const [w, h] = GLYPH_SIZE[name] ?? [8, 8]
  return <Glyph name={name} width={w} height={h} color={color} />
}

/** Which of the theme's pictures stands for an app icon, where it has one. */
const ART_FOR: Record<string, string> = {
  terminal: "dos",
  folder: "folder",
  tool_web: "globe",
  globe: "globe",
  settings: "settings",
  sliders: "settings",
  search: "find",
  magnifying_glass: "find",
  blocks: "plugin",
  box: "plugin",
  help: "help",
}

/** An icon: the theme's picture for it when it has one, else the app's, drawn black. */
export const AnyIcon = memo(function AnyIcon({ name, size = 16 }: { name: string; size?: number }) {
  const own = ART_FOR[name]
  if (own) return <Art name={own} size={size} />
  return <Icon name={name} size={Math.round(size * 0.85)} color="#000000" />
})

// ── Bevels ─────────────────────────────────────────────────────────────────────────────────────

/** The four sides of one ring of a bevel: `lit` on the top and left, `dim` on the right and foot. */
export function ring(lit: string, dim: string): Record<string, string> {
  return { borderTopColor: lit, borderLeftColor: lit, borderRightColor: dim, borderBottomColor: dim }
}

export type BevelKind = "raised" | "sunken" | "field" | "button" | "pressed" | "window" | "status" | "groove"

/**
 * The outer and inner rings of each kind of box the system drew:
 * - `raised`: a toolbar, a menu (light grey and black outside, white and grey inside)
 * - `button`: a push button (white and black outside, light grey and grey inside)
 * - `pressed`: a held button (black and white outside, grey and light grey inside)
 * - `sunken`, `field`: a well, a text field (grey and white outside, black and light grey inside)
 * - `window`: a window's frame (light grey and black, then white and grey)
 * - `status`: a status bar's field (one ring, grey and white)
 * - `groove`: an etched line (grey and white, then white and grey)
 */
export function bevel(t: Tokens, kind: BevelKind): [Record<string, string>, Record<string, string> | undefined] {
  const light = t["w98.light"]!
  const white = t["w98.white"]!
  const shadow = t["w98.shadow"]!
  const dark = t["w98.dark"]!
  switch (kind) {
    case "raised":
    case "window":
      return [ring(light, dark), ring(white, shadow)]
    case "button":
      return [ring(white, dark), ring(light, shadow)]
    case "pressed":
      return [ring(dark, white), ring(shadow, light)]
    case "sunken":
    case "field":
      return [ring(shadow, white), ring(dark, light)]
    case "status":
      return [ring(shadow, white), undefined]
    case "groove":
      return [ring(shadow, white), ring(white, shadow)]
  }
}

interface BoxProps {
  kind: BevelKind
  children?: ReactNode
  /** The outer box's style: its size, its place, its margin. */
  style?: Record<string, unknown>
  /** The inner box's: its padding, its direction, its fill. */
  inner?: Record<string, unknown>
  title?: string
  onClick?(e: any): void
  onMouseDown?(e: any): void
  onMouseMove?(e: any): void
  onMouseUp?(e: any): void
  onDoubleClick?(e: any): void
  onAuxClick?(e: any): void
  onMouseEnter?(): void
  onMouseLeave?(): void
}

/** A box of the system's: two rings of a bevel round what it holds (one, for a status field). */
export function Box({ kind, children, style, inner, ...handlers }: BoxProps) {
  const t = useTheme()
  const [outer, within] = bevel(t, kind)
  const fill = kind === "field" ? t["w98.white"] : t["w98.face"]
  const body = { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, ...inner }
  return (
    <div {...handlers} style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderWidth: 1, backgroundColor: fill, ...outer, ...style }}>
      {within ? <div style={{ borderWidth: 1, ...within, ...body }}>{children}</div> : <div style={body}>{children}</div>}
    </div>
  )
}

// ── Buttons ────────────────────────────────────────────────────────────────────────────────────

/**
 * A push button: its label (and icon) in the middle, the whole of it a pixel down and right while
 * held, as the system's. `default` has the black ring of the button Enter presses; `pushed` is a
 * toggle that is on (a taskbar's front task), drawn held on a checker.
 */
export function PushButton({
  label,
  icon,
  art: picture,
  onClick,
  pushed,
  isDefault,
  disabled,
  title,
  bold,
  style,
  inner,
  onAuxClick,
}: {
  label?: string
  icon?: string
  art?: string
  onClick(): void
  pushed?: boolean
  isDefault?: boolean
  disabled?: boolean
  title?: string
  bold?: boolean
  style?: Record<string, unknown>
  inner?: Record<string, unknown>
  onAuxClick?(e: any): void
}) {
  const t = useTheme()
  const [up] = bevel(t, "button")
  const [, upIn] = bevel(t, "button")
  const [down, downIn] = bevel(t, "pressed")
  const content = (held: boolean) => (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        flexGrow: 1,
        minWidth: 0,
        paddingLeft: 6,
        paddingRight: 6,
        ...inner,
        ...(held ? { marginTop: 1, marginLeft: 1, marginBottom: -1, marginRight: -1 } : {}),
      }}
    >
      {picture ? <Art name={picture} size={16} /> : icon ? <AnyIcon name={icon} size={16} /> : null}
      {label ? (
        <text style={{ fontSize: 11, fontFamily: FONT, fontWeight: bold ? 700 : 400, color: disabled ? t["w98.shadow"] : t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{label}</text>
      ) : null}
    </div>
  )
  return (
    <div
      onClick={(e: any) => {
        stop(e)
        if (!disabled) onClick()
      }}
      onAuxClick={onAuxClick}
      onDoubleClick={stop}
      title={title ?? label}
      aria-label={title ?? label}
      aria-pressed={pushed}
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        borderWidth: isDefault ? 1 : 0,
        borderColor: t["w98.dark"],
        cursor: "default",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          borderWidth: 1,
          ...(pushed ? down : up),
          backgroundColor: pushed ? t["w98.checker"] : t["w98.face"],
          active: disabled ? undefined : { ...down, backgroundColor: t["w98.face"] },
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, borderWidth: 1, ...(pushed ? downIn : upIn), active: disabled ? undefined : downIn }}>
          {content(!!pushed)}
        </div>
      </div>
    </div>
  )
}

/** A caption button: 16 by 14, its glyph in the middle. */
export function CaptionButton({ glyph, title, onClick, disabled }: { glyph: string; title: string; onClick(): void; disabled?: boolean }) {
  const t = useTheme()
  const [up, upIn] = bevel(t, "button")
  const [down, downIn] = bevel(t, "pressed")
  return (
    <div
      onClick={(e: any) => {
        stop(e)
        if (!disabled) onClick()
      }}
      onMouseDown={stop}
      onDoubleClick={stop}
      title={title}
      aria-label={title}
      style={{ display: "flex", width: 16, height: 14, flexShrink: 0, borderWidth: 1, ...up, backgroundColor: t["w98.face"], active: { ...down } }}
    >
      <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, ...upIn, active: { ...downIn } }}>
        <Mark name={glyph} color={disabled ? t["w98.shadow"] : "#000000"} />
      </div>
    </div>
  )
}

/** A title bar's gradient: the active window's navy to blue, an inactive one's greys. */
export function caption(t: Tokens, active: boolean) {
  const [from, to] = active ? [t["w98.title"]!, t["w98.title2"]!] : [t["w98.inactive"]!, t["w98.inactive2"]!]
  return { background: { type: "linear-gradient", angle: 90, stops: [{ color: from }, { color: to }] } as any }
}

/** A groove across a bar, between its groups: grey over white. */
export function Separator({ vertical }: { vertical?: boolean }) {
  const t = useTheme()
  return vertical ? (
    <div style={{ width: 2, alignSelf: "stretch", flexShrink: 0, marginLeft: 2, marginRight: 2, marginTop: 2, marginBottom: 2, borderLeftWidth: 1, borderRightWidth: 1, borderLeftColor: t["w98.shadow"], borderRightColor: t["w98.white"] }} />
  ) : (
    <div style={{ height: 2, flexShrink: 0, marginTop: 3, marginBottom: 3, marginLeft: 1, marginRight: 1, borderTopWidth: 1, borderBottomWidth: 1, borderTopColor: t["w98.shadow"], borderBottomColor: t["w98.white"] }} />
  )
}

/** A label of the system's: Tahoma at 11, black (white on a caption). */
export function Label({ children, color, bold, style }: { children: ReactNode; color?: string; bold?: boolean; style?: Record<string, unknown> }) {
  const t = useTheme()
  return <text style={{ fontSize: 11, fontFamily: FONT, fontWeight: bold ? 700 : 400, color: color ?? t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0, ...style }}>{children}</text>
}

/** A tab's name as its window says it: its own, or `Tab n` for one not named. */
export function tabName(tab: { label?: string | null; number?: number } | undefined, index?: number): string {
  if (tab?.label && !/^\d+$/.test(tab.label)) return tab.label
  return `Tab ${index !== undefined ? index + 1 : (tab?.number ?? "")}`.trim()
}

/** A pane by what it shows: an agent by its title, then its name, its title, its folder, its kind. */
export function paneName(p: { block: string; label?: string; terminal_title?: string | null; cwd?: string | null; agent?: string | null }): string {
  const dir = p.cwd ? p.cwd.replace(/\/+$/, "").split("/").pop() : undefined
  if (p.agent) return p.terminal_title || p.label || p.agent
  return p.label || p.terminal_title || dir || p.block
}

/** The picture a pane is shown with: a prompt for a terminal, a globe for a page, a plug for a plugin's. */
export function paneArt(p: { block: string; agent?: string | null } | undefined): string {
  if (!p) return "dos"
  if (p.agent) return "help"
  if (p.block === "terminal") return "dos"
  if (p.block === "file") return "documents"
  if (p.block === "browser" || p.block.endsWith(".page")) return "globe"
  if (p.block === "files" || p.block.endsWith(".files")) return "folder"
  return "plugin"
}
