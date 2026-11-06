// The panes, as cards: a rounded box with a shadow sitting on the desk, its tabs in a strip over
// its body. The bar has no window buttons — the system draws those — so it is only the tabs, the
// buttons that act on the pane, and the empty end a tab is dropped on.
import { Icon, useHover, useMetrics, useTheme } from "pumi"
import {
  call,
  run,
  useComponents,
  useMenu,
  usePaneTabs,
  useTab,
  useWindow,
  via,
  type IconButtonProps,
  type Tree,
} from "pumi/theme"

const swallow = (err: unknown) => console.error(String(err))

/** What a tab is called when it has no title of its own: its folder, else its block. */
export function tabLabel(tab: { label?: string; title?: string | null; terminal_title?: string | null; cwd?: string | null; block?: string } | undefined): string {
  if (!tab) return ""
  const folder = tab.cwd?.split("/").filter(Boolean).pop()
  return tab.label ?? tab.title ?? tab.terminal_title ?? folder ?? (tab.block ?? "").split(".").pop() ?? ""
}

/**
 * The `Pane` part: the card, its strip and the front tab's body. Only the front tab is drawn; the
 * others keep running behind it. A press in the card gives its tab the focus, and a right press
 * opens that tab's menu.
 */
export function Pane({ pane, tabs, active, focused }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean; lifted?: boolean }) {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const front = active ?? tabs[0]
  const { open, menu } = useMenu("tab.menu", { tab: front ?? "" })
  const strip = usePaneTabs()
  if (!front) return null
  return (
    <div
      onMouseDown={() => {
        if (!focused) call(via(front, "tab.focus"), front).catch(swallow)
      }}
      onAuxClick={open}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        // The card: what makes a pane a window on the desk. Clipped, so the body keeps its corners.
        overflow: "hidden",
        backgroundColor: t.editor,
        borderRadius: m.radius,
        borderWidth: 1,
        // The focused card is edged in the accent, quietly: it says which one the keys go to.
        borderColor: focused ? `${t.accent}8c` : t.border,
        boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 24, spreadRadius: -6, color: `${t["slate.shadow"]}2e` },
      }}
    >
      <C.PaneTitle pane={pane} tabs={tabs} active={front} focused={focused} zoomed={false} menu={open} />
      <C.TabBody key={front} tab={front} focused={focused} />
      {strip ? null : null}
      {menu}
    </div>
  )
}

/**
 * The `PaneTitle` part: the strip. Its tabs, then the buttons that act on the pane — a new tab, a
 * split to the right, the front tab closed — which show while the pane has the focus or the mouse.
 * A right press anywhere on the strip opens the front tab's menu.
 */
export function PaneTitle({ pane, tabs, active, focused, menu }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean; over?: boolean; menu(e: { x?: number; y?: number }): void }) {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const window = useWindow()
  const front = active ?? tabs[0]
  const [hovered, hover] = useHover()
  const strip = usePaneTabs()
  if (!front) return null
  const shown = focused || hovered
  const split = () => call(via(pane, "tab.open"), null, {}, { kind: "tiled", pane, split: "right" }).catch(swallow)
  return (
    <div
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      onAuxClick={(e: any) => {
        e?.stopPropagation?.()
        menu(e)
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: m.stripHeight,
        flexShrink: 0,
        gap: 2,
        paddingLeft: 6,
        paddingRight: 6,
        backgroundColor: t.surface,
        borderBottomWidth: 1,
        borderColor: t.border,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0, flexShrink: 1, height: "100%", overflowX: "scroll" }}>
        {strip
          ? tabs.map((tab, index) => <C.PaneTab key={tab} tab={tab} pane={pane} index={index} active={tab === front} focused={focused} />)
          : null}
      </div>
      <div style={{ flexGrow: 1 }} />
      {/* Kept in place (only faded out) so the tabs never move as the mouse comes and goes. */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0, opacity: shown ? 1 : 0 }}>
        <C.IconButton icon="plus" title="New Tab" color={t.faint} onClick={() => run("new_tab", window.id)} />
        <C.IconButton icon="split" title="Split Right" color={t.faint} onClick={split} />
        <C.IconButton icon="close" title="Close Tab" color={t.faint} onClick={() => call(via(front, "tab.close"), front).catch(swallow)} />
      </div>
    </div>
  )
}

/**
 * One tab in a strip: a pill while it is the front one, plain while it is not. Its own icon, its
 * name, and the cross that closes it (there while the pane has the focus, or the mouse is on it).
 */
export function PaneTab({ tab: id, active, focused }: { tab: string; pane: string; index: number; active: boolean; focused: boolean }) {
  const t = useTheme()
  const m = useMetrics()
  const tab = useTab(id)
  const [hovered, hover] = useHover()
  const { open, menu } = useMenu("tab.menu", { tab: id })
  if (!tab) return null
  return (
    <div
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      onMouseDown={(e: any) => {
        if ((e?.button ?? 0) !== 0) return
        if (!active || !focused) call(via(id, "tab.focus"), id).catch(swallow)
      }}
      onAuxClick={(e: any) => {
        e?.stopPropagation?.()
        open(e)
      }}
      title={tab.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 26,
        flexShrink: 1,
        maxWidth: 260,
        minWidth: 0,
        paddingLeft: 10,
        paddingRight: 6,
        borderRadius: m.radiusSmall,
        cursor: "pointer",
        backgroundColor: active ? t["slate.tab"] : "#00000000",
        borderWidth: active ? 1 : 0,
        borderColor: t.border,
        hover: { backgroundColor: active ? t["slate.tab"] : `${t.text}0f` },
      }}
    >
      <Icon name="dot" size={12} color={active ? t.accent : t.faint} />
      <text style={{ fontSize: 12, color: active ? t.text : t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{tabLabel(tab)}</text>
      <div
        aria-label="Close Tab"
        title="Close Tab"
        onMouseDown={(e: any) => e?.stopPropagation?.()}
        onClick={(e: any) => {
          e?.stopPropagation?.()
          call(via(id, "tab.close"), id).catch(swallow)
        }}
        style={{
          display: "flex",
          width: 16,
          height: 16,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
          opacity: active || hovered ? 1 : 0,
          hover: { backgroundColor: `${t.text}14` },
        }}
      >
        <Icon name="close" size={9} color={t.muted} />
      </div>
      {menu}
    </div>
  )
}

/**
 * The `Splitter` part: the edge that drags a split. The desk shows through the gap between two
 * cards, so the box itself is empty; the app's own hit testing drags it.
 */
export function Splitter({ axis, dragging }: { axis: "row" | "column"; dragging: boolean }) {
  const t = useTheme()
  return <div style={{ flexGrow: 1, backgroundColor: dragging ? `${t.accent}33` : "#00000000" }} />
}

/** `Split` is the app's, with the theme's parts inside it. */
export type { Tree, IconButtonProps }
