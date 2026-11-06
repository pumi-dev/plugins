// The window as stacked columns, in the default theme's look: the side bar first, then one column
// per tab of the session (its views joined in order, each view's tabs in its layout's order), then
// the launcher. A column keeps the width it was dragged to (its right edge), else the theme's
// `column_width` in characters.
//
// After Andy Matuschak's notes, a column scrolled to the left edge stays there and the next one
// slides over it; once only a spine of it is left, the spine shows its title running down it, and a
// click on the spine brings the column back. The theme keeps the scroll itself (a trackpad's
// sideways swipe, or shift and the wheel), and every column places itself from it in the same frame.
import { memo, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, TabIcon, useDraggable, useDragState, useFont, useMetrics, useTheme } from "pumi"
import {
  call,
  carried,
  renderComponent,
  runMove,
  tabsOf,
  useApp,
  useComponents,
  useDropBox,
  useFloats,
  useFocusedTab,
  useFocusOnHover,
  useLocal,
  useMenu,
  useNewTabs,
  useSession,
  useSidebar,
  useSlot,
  useTab,
  useThemeOption,
  useView,
  useWindow,
  via,
  type Carried,
  type NewTab,
  type Tab,
} from "pumi/theme"

const swallow = (err: unknown) => console.error(String(err))

/** How wide a folded column's spine is. */
const SPINE = 32
/** The side bar's width, as the default theme's. */
const SIDEBAR_WIDTH = 260
/** A bar's height, as the default theme's title bar and pane bars. */
const BAR = 38
/** Where a bar's content starts past the traffic lights. */
const TITLE_INSET = 78
/** Above every column, for what must keep its place after them. */
const LAST = 10_000
const MIN_WIDTH = 320
/** The least room past the last column, for the launcher. */
const NEW_WIDTH = 320
const MAX_WIDTH = 2400
/** A terminal character's width, as a share of its font size (SF Mono, Menlo). */
const CHAR = 0.6

const base = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path

/** A tab's name: its own, else what its program calls it, else its folder, else its block. */
function tabName(tab: Pick<Tab, "label" | "terminal_title" | "cwd" | "block"> | undefined): string {
  if (!tab) return ""
  return tab.label || tab.terminal_title || (tab.cwd ? base(tab.cwd) : "") || tab.block
}

/** The default theme's text sizes at the theme's font size: each part says its size at 13pt. */
function useTextSize(): (size: number) => number {
  const base = useMetrics().fontSize
  return (size: number) => (base === 13 ? size : Math.round((size * base) / 13))
}

// ── The scroll ───────────────────────────────────────────────────────────────────────────────

/**
 * The strip's scroll, which the theme keeps itself rather than a scrolling box's: every column is
 * placed from the same offset in the same frame, the ones stuck at the left edge as still as the
 * page. (A box's own scroll moves its content a frame before the stuck columns hear of it, and
 * they jitter back.) `lefts` is where each column starts along the strip; `end` is its length.
 */
interface Strip {
  x: number
  lefts: number[]
  widths: number[]
  end: number
  viewport: number
  listeners: Set<() => void>
}

function makeStrip(): Strip {
  return { x: 0, lefts: [], widths: [], end: 0, viewport: 0, listeners: new Set() }
}

const maxScroll = (strip: Strip) => Math.max(0, strip.end - strip.viewport)

function setScroll(strip: Strip, x: number) {
  const next = Math.round(Math.min(maxScroll(strip), Math.max(0, x)))
  if (next === strip.x) return
  strip.x = next
  for (const l of strip.listeners) l()
}

/** Reads `pick` of the strip, again as it scrolls. */
function useStrip<T extends string | number>(strip: Strip, pick: (strip: Strip) => T): T {
  return useSyncExternalStore(
    (l) => {
      strip.listeners.add(l)
      return () => strip.listeners.delete(l)
    },
    () => pick(strip),
  )
}

/** Whether column `i` has reached its place at the left edge (after the spines before it). */
function pinned(strip: Strip, i: number): boolean {
  const left = strip.lefts[i]
  // At its place exactly counts: scrolled to the end, the last column sits there and the rest fold.
  return left !== undefined && strip.x > 0 && strip.x >= left - i * SPINE
}

/** Where column `i`'s left edge is on screen, from the strip's left edge. */
function screenLeft(strip: Strip, i: number): number {
  return pinned(strip, i) ? i * SPINE : (strip.lefts[i] ?? 0) - strip.x
}

/**
 * How much of column `i` shows, up to where the next one starts over it. What is under the next
 * column is cut off (`overflow: "hidden"`), so the mouse and its wheel over the front column
 * never reach the one behind: a fill lets the wheel through to whatever is under it.
 */
function visibleOf(strip: Strip, i: number): number {
  const width = strip.widths[i] ?? 0
  if (i + 1 >= strip.lefts.length) return width
  return Math.max(0, Math.min(width, Math.round(screenLeft(strip, i + 1) - screenLeft(strip, i))))
}

/** Column `i` as the scroll has it: where it is on screen, how much of it shows, whether the next
 * one covers all but its spine, and whether it covers the one before. */
function useStuck(strip: Strip, i: number): { left: number; visible: number; folded: boolean; covered: boolean } {
  const key = useStrip(strip, () => `${Math.round(screenLeft(strip, i))}|${visibleOf(strip, i)}|${pinned(strip, i + 1) ? 1 : 0}|${pinned(strip, i - 1) ? 1 : 0}`)
  const [left, visible, folded, covered] = key.split("|")
  return { left: Number(left), visible: Number(visible), folded: folded === "1", covered: covered === "1" }
}

/**
 * A wheel or trackpad's turn along the strip: its sideways part, or a mouse wheel's turn with
 * shift held. A swipe mostly up or down is a terminal's, and moves nothing here. Negative
 * `deltaX` pans right.
 */
function wheelBy(e: any): number {
  const dx = Number(e.deltaX ?? 0)
  const dy = Number(e.deltaY ?? 0)
  if (e.modifiers?.shift && dx === 0) return -dy
  return Math.abs(dx) > Math.abs(dy) ? -dx : 0
}

// ── The window ───────────────────────────────────────────────────────────────────────────────

/** A drag of a column's right edge: which column, and where it started. */
interface Sizing {
  key: string
  x: number
  width: number
}

export function Window() {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const view = useView()
  const tabs = useSessionColumns()
  const focused = useFocusedTab()
  const floats = useFloats(view?.view_id)
  const overlays = useSlot("window.overlay").components
  const [sidebar] = useSidebar()
  const sessionName = useSession()?.label ?? "Sessions"
  const font = useFont()
  const chars = useThemeOption<number>("column_width", 90) ?? 90
  const [widths, setWidths] = useLocal<Record<string, number>>("stacks.widths", {})
  const [sizing, setSizing] = useState<Sizing>()
  const [viewport, setViewport] = useState(0)
  const strip = useMemo(makeStrip, [])

  const fallback = Math.round(chars * font.size * CHAR)
  const keys = [...(sidebar ? ["sidebar"] : []), ...tabs]
  const sizes = keys.map((k) => (k === "sidebar" ? SIDEBAR_WIDTH : (widths[k] ?? fallback)))
  const lefts: number[] = []
  sizes.reduce((at, w) => (lefts.push(at), at + w), 0)
  strip.lefts = lefts
  strip.widths = sizes
  const total = sizes.reduce((a, w) => a + w, 0)
  // The launcher, past the last column: as wide as it takes to scroll that one to its place.
  const launcherWidth = Math.max(NEW_WIDTH, viewport - (sizes[sizes.length - 1] ?? 0) - (sizes.length - 1) * SPINE)
  strip.end = total + launcherWidth
  // Fewer columns, or a wider window: the offset stays within what there is to scroll.
  useEffect(() => setScroll(strip, strip.x), [strip.end, viewport])

  /** Scrolls so column `i` shows whole: at its place past the spines, or with its right edge in view. */
  const reveal = (i: number) => {
    const left = lefts[i]
    const width = sizes[i]
    if (left === undefined || width === undefined) return
    const stuckAt = left - i * SPINE
    const rightAt = left + width - strip.viewport
    const x = strip.x > stuckAt ? stuckAt : strip.x < rightAt ? Math.min(rightAt, stuckAt) : undefined
    if (x !== undefined) setScroll(strip, x)
  }

  // A tab given the focus (a click, a key, a new tab) is scrolled into view.
  const focusedAt = focused ? keys.indexOf(focused) : -1
  useEffect(() => {
    if (focusedAt >= 0) reveal(focusedAt)
  }, [focused, focusedAt, keys.length])

  // A window with no tabs yet: the app's start screen, as the default theme draws it.
  if (!view || !tabs.length) {
    return (
      <div style={{ display: "flex", width: "100%", height: "100%", backgroundColor: t.window, color: t.text, fontSize: m.fontSize }}>
        <C.Layout />
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: BAR, appRegion: "drag" }} />
      </div>
    )
  }

  const startSizing = (key: string, x: number) => setSizing({ key, x, width: sizes[keys.indexOf(key)] ?? fallback })
  const resize = (x: number) => {
    if (!sizing) return
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(sizing.width + x - sizing.x)))
    setWidths((old) => (old[sizing.key] === width ? old : { ...old, [sizing.key]: width }))
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", backgroundColor: t.window, color: t.text, fontSize: m.fontSize }}>
      {/* The strip: every column placed by the theme's own offset, the wheel's sideways turns moving it. */}
      <div
        onLayout={(e: any) => {
          if (e.width > 0) strip.viewport = e.width
          if (e.width > 0) setViewport(e.width)
        }}
        onScroll={(e: any) => {
          const by = wheelBy(e)
          if (by) setScroll(strip, strip.x + by)
        }}
        style={{ display: "flex", flexGrow: 1, minHeight: 0, position: "relative", overflow: "hidden" }}
      >
        {keys.map((key, i) =>
          key === "sidebar" ? (
            <Column key={key} strip={strip} index={i} width={sizes[i]!} title={sessionName} status={undefined} fill={t.surface} onReveal={() => reveal(i)}>
              <Sidebar />
            </Column>
          ) : (
            <TabColumn
              key={key}
              tab={key}
              strip={strip}
              index={i}
              width={sizes[i]!}
              focused={key === focused}
              onReveal={() => reveal(i)}
              onSize={(x) => startSizing(key, x)}
              onResetSize={() => setWidths((old) => Object.fromEntries(Object.entries(old).filter(([k]) => k !== key)))}
            />
          ),
        )}
        <Launcher strip={strip} at={total} after={tabs[tabs.length - 1]} width={launcherWidth} />
        <ScrollThumb strip={strip} />
      </div>
      {floats.map((p) => (
        <C.Float key={p.tab_id} tab={p.tab_id} />
      ))}
      {/* The window moves by its top edge, wherever it is pressed. */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 4, appRegion: "drag" }} />
      {/* While a column's edge is dragged, the whole window follows the mouse, terminals too. */}
      {sizing ? (
        <div
          onMouseMove={(e) => resize(e.x ?? 0)}
          onMouseUp={() => setSizing(undefined)}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: "col-resize", zIndex: 1000 }}
        />
      ) : null}
      {overlays.map((v) => (
        <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {renderComponent(v)}
        </div>
      ))}
      <DragGhost />
    </div>
  )
}

/** Where the strip is scrolled to: a thin bar along its foot, while there is more than shows. */
function ScrollThumb({ strip }: { strip: Strip }) {
  const t = useTheme()
  const key = useStrip(strip, () => {
    const max = maxScroll(strip)
    if (!max || !strip.viewport) return ""
    const width = Math.max(40, Math.round((strip.viewport / strip.end) * strip.viewport))
    return `${Math.round((strip.x / max) * (strip.viewport - width))}|${width}`
  })
  if (!key) return null
  const [left, width] = key.split("|").map(Number)
  return <div style={{ position: "absolute", bottom: 2, left, width, height: 3, borderRadius: 2, backgroundColor: t.border, zIndex: LAST + 1, pointerEvents: "none" }} />
}

/** A column being dragged: its tab, following the mouse. */
function DragGhost() {
  const t = useTheme()
  const m = useMetrics()
  const ts = useTextSize()
  const drag = useDragState()
  const it = drag ? carried(drag.data) : undefined
  const tab = useTab(it?.kind === "pumi.tab" ? it.tab : undefined)
  if (!drag || !tab) return null
  return (
    <div
      style={{
        position: "absolute",
        left: drag.x + 12,
        top: drag.y + 10,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: m.radiusSmall,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.border,
        boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 12, spreadRadius: 0, color: "#00000040" },
        pointerEvents: "none",
        zIndex: LAST + 2,
      }}
    >
      <TabIcon tab={tab.tab_id} size={12} color={t.faint} />
      <text style={{ fontSize: ts(12), color: t.text, whiteSpace: "nowrap" }}>{tabName(tab)}</text>
    </div>
  )
}

// ── A column ─────────────────────────────────────────────────────────────────────────────────

/**
 * One column of the strip: its frame, sticking at its place once scrolled there, a shadow while it
 * slides over the one before, and its spine while the next one covers it.
 */
function Column({
  strip,
  index,
  width,
  title,
  tab,
  status,
  fill,
  onReveal,
  onSize,
  onResetSize,
  children,
}: {
  strip: Strip
  index: number
  width: number
  title: string
  /** The tab the column shows, if it shows one (the side bar does not). */
  tab?: string
  status: string | undefined
  fill?: string
  onReveal(): void
  onSize?(x: number): void
  onResetSize?(): void
  children: ReactNode
}) {
  const t = useTheme()
  const { left, visible, folded, covered } = useStuck(strip, index)
  return (
    // Later columns paint (and take presses) over earlier ones: they slide over them. What shows
    // is cut where the next column starts, so nothing under it takes the mouse or the wheel.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        top: 0,
        left,
        width: visible,
        height: "100%",
        overflow: "hidden",
        zIndex: index + 1,
        boxShadow: covered ? [{ offsetX: -4, offsetY: 0, blurRadius: 12, spreadRadius: 0, color: "#00000033" }] : undefined,
      }}
    >
      {/* The column at its whole width, whatever shows of it: a terminal keeps its size as it is covered. */}
      <div style={{ display: "flex", flexDirection: "column", width, flexShrink: 0, height: "100%", position: "relative", backgroundColor: fill ?? t.editor, borderRightWidth: 1, borderColor: t.border }}>
        {children}
        {folded ? <Spine title={title} tab={tab} status={status} fill={fill} onClick={onReveal} /> : null}
        {onSize ? (
          <div
            onMouseDown={(e) => (e.clickCount === 2 ? onResetSize?.() : onSize(e.x ?? 0))}
            title="Drag to size · double-click for the default width"
            style={{ position: "absolute", top: 0, right: 0, width: 6, height: "100%", cursor: "col-resize", zIndex: 5, hover: { backgroundColor: `${t.accent}33` } }}
          />
        ) : null}
      </div>
    </div>
  )
}

/** A covered column's spine: its title running down it, its status at its top. */
function Spine({ title, tab, status, fill, onClick }: { title: string; tab?: string; status: string | undefined; fill?: string; onClick(): void }) {
  const t = useTheme()
  const src = useMemo(() => spineArt(title), [title])
  const loud = status === "working" || status === "blocked" || status === "error" || status === "done"
  // A blocked tab waits on the user: its whole spine takes the blocked colour, so it shows from across the strip.
  const blocked = status === "blocked" ? (t["status.blocked"] ?? t.warning) : undefined
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: SPINE,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // Below the traffic lights, for the first spine.
        paddingTop: BAR + 6,
        gap: 10,
        backgroundColor: fill ?? t.surface,
        borderRightWidth: 1,
        borderColor: t.border,
        cursor: "pointer",
        overflow: "hidden",
        zIndex: 6,
        hover: { backgroundColor: t.hover },
      }}
    >
      {blocked ? <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: blocked, opacity: 0.16, pointerEvents: "none" }} /> : null}
      {blocked ? <div style={{ position: "absolute", top: 0, left: 0, width: 2, height: "100%", backgroundColor: blocked, pointerEvents: "none" }} /> : null}
      {/* A working tab's spinner, as its tab bar shows it (`TabIcon` draws a loud status in place of the icon). */}
      {status === "working" && tab ? <TabIcon tab={tab} size={12} /> : loud && status ? <div style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: t[`status.${status}`] ?? t.faint }} /> : null}
      <svg src={src} style={{ width: 16, height: 900, flexShrink: 0, color: blocked ?? t.muted, pointerEvents: "none" }} />
    </div>
  )
}

/** A spine's title as an image: the text turned to run down, which `<text>` cannot do. */
function spineArt(title: string): string {
  const text = title.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="900" viewBox="0 0 16 900">` +
    `<text transform="translate(4 0) rotate(90)" x="0" y="0" font-family="SF Pro Text, Helvetica Neue, sans-serif" font-size="12" fill="#000">${text}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// ── The side bar ─────────────────────────────────────────────────────────────────────────────

/** The default theme's side bar as the first column: its top past the traffic lights, then its tree and the plugins' sections. */
function Sidebar() {
  const t = useTheme()
  const C = useComponents()
  const [, setOpen] = useSidebar()
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: BAR, flexShrink: 0, paddingLeft: TITLE_INSET, paddingRight: 8, borderBottomWidth: 1, borderColor: t.border, appRegion: "drag" }}>
        <C.IconButton icon="layout_sidebar_left" title="Hide Side Bar" onClick={() => setOpen(false)} />
      </div>
      <C.Panel point="panel" />
    </div>
  )
}

// ── A tab's column ───────────────────────────────────────────────────────────────────────────

const TabColumn = memo(function TabColumn({
  tab: id,
  strip,
  index,
  width,
  focused,
  onReveal,
  onSize,
  onResetSize,
}: {
  tab: string
  strip: Strip
  index: number
  width: number
  focused: boolean
  onReveal(): void
  onSize(x: number): void
  onResetSize(): void
}) {
  const t = useTheme()
  const C = useComponents()
  const window = useWindow()
  const tab = useTab(id)
  const { open, menu } = useMenu("tab.menu", { tab: id })
  const follow = useFocusOnHover(tab ? id : undefined, focused)
  // In front of the user: what its program left for them (done, an error) is seen.
  useEffect(() => {
    if (focused && tab) call(via(id, "tab.update"), id, { seen: true }).catch(swallow)
  }, [focused, !!tab])
  // The session's views are one strip here: a tab of another view brings its view in front first.
  const focus = () => {
    if (focused || !tab) return
    if (tab.view_id !== window.view) window.showView(tab.view_id)
    call(via(id, "tab.focus"), id).catch(swallow)
  }
  // Sorting: a column is dropped on another, before or after it by which half the mouse is over.
  // It moves beside that tab, into that tab's view if need be.
  const drop = useDropBox<Carried>(
    (data): data is Carried => {
      const it = carried(data)
      return it?.kind === "pumi.tab" && it.tab !== id
    },
    (it, at, box) => {
      if (it.kind !== "pumi.tab") return
      runMove({ kind: "tab.beside", tab: it.tab, target: id, side: sideOf(at.x, box) }, window)
    },
  )
  const side = drop.isOver && drop.drag ? sideOf(drop.drag.x, drop.box()) : undefined
  // A column at the window's left edge (the side bar hidden, or the ones before it folded) starts
  // its bar past the traffic lights.
  const inset = useStrip(strip, () => Math.max(10, Math.round(TITLE_INSET - screenLeft(strip, index))))
  return (
    <Column strip={strip} index={index} width={width} title={tabName(tab)} tab={id} status={tab?.status} onReveal={onReveal} onSize={onSize} onResetSize={onResetSize}>
      <div ref={drop.ref} onMouseDown={focus} onAuxClick={open} onMouseEnter={follow} style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, userSelect: "contain", position: "relative" }}>
        <TabBar tab={id} focused={focused} inset={inset} menu={open} />
        <C.TabBody key={id} tab={id} focused={focused} />
        {/* Where a dropped column goes: a line at this one's left or right edge. */}
        {side ? <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: t.accent, pointerEvents: "none", zIndex: 7, ...(side === "left" ? { left: 0 } : { right: 0 }) }} /> : null}
        {menu}
      </div>
    </Column>
  )
})

/**
 * A column's bar, as the default theme's pane bar for one tab: its icon and title, dragged to sort
 * the columns, then what plugins put at `tab.toolbar` and its buttons (a new column beside it, and
 * closing it), shown on the focused column and the one under the mouse.
 */
function TabBar({ tab: id, focused, inset, menu }: { tab: string; focused: boolean; inset: number; menu(e: { x?: number; y?: number }): void }) {
  const t = useTheme()
  const C = useComponents()
  const ts = useTextSize()
  const tab = useTab(id)
  const [over, setOver] = useState(false)
  const carry = useDraggable<Carried>({ kind: "pumi.tab", tab: id })
  const toolbar = useSlot("tab.toolbar")
  if (!tab) return null
  const color = focused ? t.text : undefined
  return (
    <div
      {...carry.props}
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      onAuxClick={(e: any) => {
        e?.stopPropagation?.()
        menu(e)
      }}
      title={tab.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: BAR,
        flexShrink: 0,
        gap: 6,
        paddingLeft: inset,
        userSelect: "none",
        borderBottomWidth: 1,
        borderColor: t.border,
        opacity: carry.dragging ? 0.55 : 1,
        cursor: carry.dragging ? "grabbing" : "default",
      }}
    >
      <TabIcon tab={id} size={12} color={t.faint} />
      <text style={{ fontSize: ts(12), color: focused ? t.text : t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{tabName(tab)}</text>
      {/* The bar's empty middle moves the window, as the default theme's top bars do. */}
      <div style={{ flexGrow: 1, alignSelf: "stretch", appRegion: "drag" }} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0, paddingLeft: 4, paddingRight: 4, opacity: focused || over ? 1 : 0 }}>
        {toolbar.components.map((v) => renderComponent(v, { tab: id }))}
        {toolbar.actions.map((a) => (
          <C.Action key={`${a.plugin}/${a.id}`} action={a} args={{ tab: id }} />
        ))}
        <C.IconButton icon="plus" title="New Column Beside It" color={color} onClick={() => void openBeside(id)} />
        <C.IconButton icon="close" title="Close Tab" color={color} onClick={() => void call(via(id, "tab.close"), id).catch(swallow)} />
      </div>
    </div>
  )
}

/** Which half of a column's box `x` is over. */
function sideOf(x: number, box: { x: number; width: number } | undefined): "left" | "right" {
  return box && x < box.x + box.width / 2 ? "left" : "right"
}

const openBeside = (tab: string) => call(via(tab, "tab.open"), null, {}, { kind: "tiled", beside: tab, split: "right" }).catch(swallow)

// ── The launcher ─────────────────────────────────────────────────────────────────────────────

/**
 * Past the last column, the launcher: everything a new tab can be (the `+` menu's list, the most
 * used first). A row opens its tab as a new column at the end of the strip.
 */
function Launcher({ strip, at, after, width }: { strip: Strip; at: number; after?: string; width: number }) {
  const t = useTheme()
  const ts = useTextSize()
  const rows = useNewTabs()
  const left = useStrip(strip, () => at - strip.x)
  if (!after) return null
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "absolute", top: 0, left, width, height: "100%", zIndex: LAST, backgroundColor: t.window }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: BAR, flexShrink: 0, paddingLeft: 10, gap: 6, borderBottomWidth: 1, borderColor: t.border }}>
        <Icon name="plus" size={12} color={t.faint} />
        <text style={{ fontSize: ts(12), color: t.muted }}>New Tab</text>
      </div>
      <div style={{ display: "flex", flexDirection: "column", width: Math.min(width, 320), flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingTop: 6, paddingLeft: 6, paddingRight: 6, paddingBottom: 12 }}>
        {rows.map((row) => (
          <LaunchRow key={row.id} row={row} after={after} />
        ))}
        {rows.length ? null : <text style={{ fontSize: ts(12), color: t.faint, paddingTop: 8, paddingLeft: 8 }}>No plugin opens tabs yet.</text>}
      </div>
    </div>
  )
}

function LaunchRow({ row, after }: { row: NewTab; after: string }) {
  const t = useTheme()
  const m = useMetrics()
  const ts = useTextSize()
  // `NewTabPlace` names a pane or a tab to replace; the server's place also takes a tab to open
  // beside, which puts the new tab after the last column rather than among a pane's tabs.
  const place = { kind: "tiled", beside: after, split: "right" } as unknown as Parameters<NewTab["open"]>[1]
  return (
    <div
      onClick={() => void row.open(after, place).catch(swallow)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 28, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: m.radiusSmall, cursor: "pointer", color: t.text, hover: { backgroundColor: t.hover } }}
    >
      {/* A box of its own, so a row whose icon the app lacks still lines up with the rest. */}
      <div style={{ display: "flex", width: 14, height: 14, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
        <Icon name={row.icon} size={14} color={t.muted} />
      </div>
      <text style={{ fontSize: ts(13), flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.title}</text>
      {row.keys ? <text style={{ fontSize: ts(11), color: t.faint, flexShrink: 0 }}>{row.keys}</text> : null}
    </div>
  )
}

// ── The session's tabs ───────────────────────────────────────────────────────────────────────

/**
 * Every tiled tab of the window's session, as one strip: its views in their order (by number),
 * each view's tabs in its layout's order. The theme has no views of its own to switch between.
 */
function useSessionColumns(): string[] {
  const session = useSession()?.workspace_id
  const key = useApp((s) =>
    (s.snapshot?.views ?? [])
      .filter((v) => v.workspace_id === session)
      .sort((a, b) => a.number - b.number)
      .flatMap((v) => {
        const tree = s.trees[v.view_id]
        return tree ? tabsOf(tree) : []
      })
      .join(" "),
  )
  return useMemo(() => (key ? key.split(" ") : []), [key])
}
