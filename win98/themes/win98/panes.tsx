// A pane, as a child window of its tab's: a small caption (navy while it has the focus, grey
// when not) with its picture, its name, what plugins put in its toolbar and its own caption
// buttons, over a sunken well its block is drawn in. The edges between panes are raised bars;
// a question is a message box.
import { useMemo, useRef } from "react"
import { useDraggable, useTheme } from "pumi"
import {
  call,
  num,
  renderView,
  useComponents,
  useLayout,
  useMenu,
  usePane,
  usePaneTitles,
  useSlot,
  useTabStatus,
  via,
  type ActionItem,
  type DialogProps,
  type IconButtonProps,
} from "pumi/theme"
import { AnyIcon, Art, bevel, Box, caption, CaptionButton, FONT, isTerminal, Label, paneArt, paneName, PushButton, stop, swallow } from "./kit.tsx"

/**
 * The `Pane` part: a child window. A tiled one has its caption while pane captions show
 * (`toggle_pane_titles`); a float is drawn bare, in the app's frame.
 */
export function Pane({ pane: id, focused, zoomed }: { pane: string; focused: boolean; zoomed: boolean; lifted?: boolean }) {
  const t = useTheme()
  const C = useComponents()
  const live = usePane(id)
  const last = useRef(live)
  if (live) last.current = live
  const pane = live ?? last.current
  const [titles] = usePaneTitles()
  const { open, menu } = useMenu("pane.menu", { pane: id })
  const floating = (pane?.place as { kind?: string } | undefined)?.kind === "float"
  const titled = titles && !!live && !floating
  const [outer, inner] = bevel(t, "window")
  const [well, wellIn] = bevel(t, "sunken")
  return (
    <div
      onMouseDown={() => {
        if (!focused) call(via(id, "pane.focus"), id).catch(swallow)
      }}
      onAuxClick={open}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: t["w98.face"], ...(floating ? {} : { borderWidth: 1, ...outer }) }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, ...(floating ? {} : { borderWidth: 1, ...inner!, padding: 1 }) }}>
        {titled ? <C.PaneTitle pane={id} focused={focused} zoomed={zoomed} menu={open} /> : null}
        {/* The well the block sits in: black for a terminal, as a DOS box's was. */}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, marginTop: titled ? 1 : 0, borderWidth: 1, ...well }}>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, borderWidth: 1, ...wellIn!, backgroundColor: isTerminal(pane) ? "#000000" : t.editor }}>
            <C.PaneBody pane={id} focused={focused} />
          </div>
        </div>
      </div>
      {menu}
    </div>
  )
}

/**
 * The `PaneTitle` part: a child window's caption. Its picture opens its menu (as a window's icon
 * opens its system menu), a double press fills the tab (or gives the layout back), and it drags
 * the pane onto a side of another, or onto a task on the taskbar.
 */
export function PaneTitle({ pane: id, focused, zoomed, menu }: { pane: string; focused: boolean; zoomed: boolean; menu(e: { x?: number; y?: number }): void }) {
  const t = useTheme()
  const C = useComponents()
  const p = usePane(id)
  const tree = useLayout(p?.tab_id)
  const draggable = useDraggable({ kind: "pumi.pane", pane: id })
  const toolbar = useSlot("pane.toolbar")
  const args = useMemo(() => ({ pane: id }), [id])
  if (!p) return null
  const zoomable = zoomed || (!!tree && "axis" in tree)
  const zoom = () => call(via(id, "pane.update"), id, { zoom: !zoomed }).catch(swallow)
  const split = (side: "right" | "down") => call(via(id, "pane.open"), "terminal", {}, { beside: num(id), split: side }).catch(swallow)
  const status = useTabStatus(p?.tab_id)
  const name = paneName(p) + (status && status !== "idle" && status !== "unknown" ? ` - [${status[0]!.toUpperCase()}${status.slice(1)}]` : "")
  return (
    <div
      {...draggable.props}
      onDoubleClick={() => zoomable && zoom()}
      onAuxClick={(e: any) => {
        stop(e)
        menu(e)
      }}
      title={p.cwd ?? undefined}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, height: 18, flexShrink: 0, paddingLeft: 2, paddingRight: 2, userSelect: "none", opacity: draggable.dragging ? 0.6 : 1, ...caption(t, focused) }}
    >
      <div onClick={(e: any) => (stop(e), menu(e))} onMouseDown={stop} title="Pane menu" style={{ display: "flex", flexShrink: 0 }}>
        <Art name={paneArt(p)} size={16} />
      </div>
      <Label bold color={focused ? t["w98.white"] : t["w98.light"]} style={{ flexShrink: 1 }}>
        {name}
      </Label>
      <div style={{ flexGrow: 1 }} />
      {toolbar.views.map((v) => renderView(v, args))}
      {toolbar.actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0, marginLeft: 2 }}>
        <C.IconButton icon="split" title="Split Right" onClick={() => split("right")} />
        <C.IconButton icon="split_down" title="Split Down" onClick={() => split("down")} />
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0, marginLeft: 2 }}>
        {zoomable ? <CaptionButton glyph={zoomed ? "restore" : "maximize"} title={zoomed ? "Restore" : "Maximize"} onClick={zoom} /> : null}
      </div>
      <div style={{ marginLeft: 2, display: "flex" }}>
        <CaptionButton glyph="close" title="Close" onClick={() => call(via(id, "pane.close"), num(id)).catch(swallow)} />
      </div>
    </div>
  )
}

/** The `Splitter` part: the bar between two panes, raised, lit navy while it drags. */
export function Splitter({ axis, dragging }: { axis: "row" | "column"; dragging: boolean }) {
  const t = useTheme()
  if (dragging) return <div style={{ flexGrow: 1, backgroundColor: t["w98.shadow"] }} />
  // A thin raised ridge down its middle, where the system drew a splitter's.
  return (
    <div style={{ display: "flex", flexGrow: 1, flexDirection: axis === "row" ? "row" : "column", alignItems: "stretch", justifyContent: "center", hover: { backgroundColor: t["w98.light"] } }}>
      <div style={axis === "row" ? { width: 2, borderLeftWidth: 1, borderRightWidth: 1, borderLeftColor: t["w98.white"], borderRightColor: t["w98.shadow"] } : { height: 2, borderTopWidth: 1, borderBottomWidth: 1, borderTopColor: t["w98.white"], borderBottomColor: t["w98.shadow"] }} />
    </div>
  )
}

/** The `IconButton` part: a flat toolbar button, raised under the mouse and pushed in while held. */
export function IconButton({ icon, onClick, title, active }: IconButtonProps) {
  const t = useTheme()
  const [up] = bevel(t, "status")
  const flat = { borderTopColor: "#00000000", borderLeftColor: "#00000000", borderRightColor: "#00000000", borderBottomColor: "#00000000" }
  const raised = { borderTopColor: t["w98.white"]!, borderLeftColor: t["w98.white"]!, borderRightColor: t["w98.shadow"]!, borderBottomColor: t["w98.shadow"]! }
  return (
    <div
      onClick={(e: any) => {
        stop(e)
        onClick()
      }}
      onMouseDown={stop}
      onDoubleClick={stop}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{ display: "flex", width: 18, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center", borderWidth: 1, ...(active ? up : flat), backgroundColor: active ? t["w98.checker"] : t["w98.face"], hover: active ? undefined : raised, active: up }}
    >
      <AnyIcon name={icon} size={12} />
    </div>
  )
}

/** The `Action` part: one action as a toolbar button. */
export function Action({ action, args }: { action: ActionItem; args?: unknown }) {
  const C = useComponents()
  return <C.IconButton icon={action.icon ?? "ellipsis"} title={action.title} active={action.checked} onClick={() => action.run(args)} />
}

/**
 * The `Dialog` part: a message box in the middle of the desktop. Its caption says what it is
 * about, a picture says how much it matters (a warning for what ends something), and its OK has
 * the default ring. Enter is OK, Escape (or ×) Cancel.
 */
export function Dialog({ title, detail, confirm, cancel, danger, input, onConfirm, onCancel }: DialogProps) {
  const t = useTheme()
  return (
    <anchored fill="window" occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
        <div
          autoFocus={!input}
          tabIndex={0}
          onKeyDown={(e: any) => {
            if (e.key === "escape") {
              e.preventDefault?.()
              onCancel()
            } else if (e.key === "enter" && !input) {
              e.preventDefault?.()
              onConfirm()
            }
          }}
          style={{ display: "flex", keyboardFocusDim: false, boxShadow: { offsetX: 2, offsetY: 2, blurRadius: 0, spreadRadius: 0, color: "#00000055" } }}
        >
          <Box kind="window" style={{ width: 340 }} inner={{ padding: 1 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 18, paddingLeft: 3, paddingRight: 2, ...caption(t, true) }}>
              <Label bold color={t["w98.white"]}>
                {danger ? "Warning" : "pumi"}
              </Label>
              <div style={{ flexGrow: 1 }} />
              <CaptionButton glyph="close" title="Close" onClick={onCancel} />
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: 12, paddingTop: 14, paddingLeft: 12, paddingRight: 12, paddingBottom: 10 }}>
              <Art name={danger ? "shutdown" : input ? "run" : "help"} size={32} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: 11, fontFamily: FONT, color: t.text }}>{title}</text>
                {detail ? <text style={{ fontSize: 11, fontFamily: FONT, color: t.text }}>{detail}</text> : null}
                {input ? (
                  <Box kind="field" style={{ height: 22, marginTop: 4 }} inner={{ justifyContent: "center" }}>
                    <input
                      autoFocus
                      value={input.value}
                      placeholder={input.placeholder}
                      onChange={(e: any) => input.onChange(e.value ?? "")}
                      onSubmit={onConfirm}
                      onKeyDown={(e) => {
                        if (e.key !== "escape") return
                        e.preventDefault()
                        e.stopPropagation()
                        onCancel()
                      }}
                      style={{ fontSize: 11, fontFamily: FONT, color: t.text, paddingLeft: 3, backgroundColor: "transparent", selectionColor: `${t["w98.title"]}88` }}
                    />
                  </Box>
                ) : null}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: 6, paddingBottom: 10 }}>
              <PushButton label={confirm} isDefault onClick={onConfirm} style={{ width: 75, height: 23 }} />
              <PushButton label={cancel} onClick={onCancel} style={{ width: 75, height: 23 }} />
            </div>
          </Box>
        </div>
      </div>
    </anchored>
  )
}

/** Before the server answers: the boot screen, a band of colour moving under the name. */
export function Starting({ title, detail, gaveUp, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: t["w98.desktop"] }}>
      <Box kind="window" style={{ width: 380 }} inner={{ padding: 1 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 18, paddingLeft: 4, ...caption(t, true) }}>
          <Label bold color={t["w98.white"]}>
            {gaveUp ? "pumi - Error" : "Starting pumi..."}
          </Label>
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: 12, padding: 12, alignItems: "center" }}>
          <Art name={gaveUp ? "shutdown" : "computer"} size={32} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flexGrow: 1 }}>
            <Label bold>{title || "Please wait while pumi starts the server."}</Label>
            {detail ? <text style={{ fontSize: 11, fontFamily: FONT, color: t.text }}>{detail}</text> : null}
          </div>
        </div>
        {lines.length ? (
          <Box kind="field" style={{ marginLeft: 8, marginRight: 8, marginBottom: 8, maxHeight: 160 }} inner={{ padding: 4, overflowY: "scroll" }}>
            {lines.map((line, i) => (
              <text key={i} style={{ fontSize: 11, fontFamily: "Courier New", color: t.text }}>
                {line}
              </text>
            ))}
          </Box>
        ) : null}
      </Box>
    </div>
  )
}
