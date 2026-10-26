// The Explorer bar down a window's left (`toggle_sidebar`): the folders view, every session as a
// computer with its tabs as folders and their panes in them, as a tree with plus and minus boxes;
// or one of the panels plugins contribute (`panel`), picked on its header's buttons.
import { memo, useCallback, useMemo } from "react"
import { useDraggable, useTheme } from "pumi"
import {
  call,
  num,
  renderView,
  serverOf,
  useApp,
  useFocusedPane,
  useLocal,
  useMenu,
  useRename,
  useSessions,
  useSidebar,
  useSlot,
  useWindow,
  via,
  type RenameInput,
  type ViewItem,
} from "pumi/theme"
import { Art, Box, CaptionButton, FONT, Label, Mark, paneArt, paneName, PushButton, stop, swallow, tabName } from "./kit.tsx"

const FOLDERS = "folders"
const NONE: string[] = []
const viewKey = (v: ViewItem) => `${v.plugin}/${v.id}`

/** Shows a session's tab (and a pane of it) in `window`. */
export function goTo(window: { session?: string; show(session: string): void }, session: string, tab?: string, pane?: string) {
  if (window.session !== session) window.show(session)
  const tabbed = tab ? call(via(tab, "tab.select"), { tab: num(tab) }) : Promise.resolve()
  tabbed.then(() => pane && call(via(pane, "pane.select"), { pane: num(pane) })).catch(swallow)
}

/** The Explorer bar: its header (what it shows, and ×), and the folders or a plugin's panel. */
export function ExplorerBar({ width }: { width: number }) {
  const t = useTheme()
  const [, setShown] = useSidebar()
  const panels = useSlot("panel").views
  const [view, setView] = useLocal<string>("win98.explorer.view", FOLDERS)
  const shown = panels.find((v) => viewKey(v) === view)
  return (
    <div style={{ display: "flex", flexDirection: "column", width, flexShrink: 0, minHeight: 0, marginRight: 2 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 20, flexShrink: 0, paddingLeft: 4, paddingRight: 1 }}>
        <Label>{shown ? (shown.title ?? shown.id) : "All Folders"}</Label>
        <div style={{ flexGrow: 1 }} />
        <CaptionButton glyph="close" title="Close the Explorer bar" onClick={() => setShown(false)} />
      </div>
      {panels.length ? (
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 2, paddingBottom: 2, flexShrink: 0 }}>
          <PushButton label="Folders" art="folder" pushed={!shown} onClick={() => setView(FOLDERS)} style={{ height: 22 }} />
          {panels.map((v) => (
            <PushButton key={viewKey(v)} label={v.title ?? v.id} icon={v.icon ?? "blocks"} pushed={shown === v} onClick={() => setView(viewKey(v))} style={{ height: 22 }} />
          ))}
        </div>
      ) : null}
      <Box kind="field" style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }} inner={{ overflowY: "scroll", scrollbarColor: t["w98.shadow"], scrollbarWidth: 8 }}>
        {shown ? <div style={{ display: "flex", flexDirection: "column", padding: 2 }}>{renderView(shown)}</div> : <Folders />}
      </Box>
    </div>
  )
}

/** Every session, its tabs and their panes, as a tree. */
function Folders() {
  const sessions = useSessions()
  const [folded, setFolded] = useLocal<string[]>("win98.explorer.folded", NONE)
  const toggle = useCallback((id: string) => setFolded((now) => (now.includes(id) ? now.filter((k) => k !== id) : [...now, id])), [setFolded])
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingTop: 2, paddingBottom: 4 }}>
      {sessions.map((s) => (
        <SessionNode key={s.workspace_id} session={s.workspace_id} label={s.label || s.workspace_id} folded={folded.includes(s.workspace_id)} folds={folded} toggle={toggle} />
      ))}
    </div>
  )
}

/** One line of the tree: its plus or minus box, its picture, its name, lit navy while it is the one shown. */
function Node({
  depth,
  open,
  toggle,
  art,
  label,
  selected,
  bold,
  input,
  onClick,
  onDoubleClick,
  onAuxClick,
  drag,
}: {
  depth: number
  open?: boolean
  toggle?(): void
  art: string
  label: string
  selected?: boolean
  bold?: boolean
  input?: RenameInput
  onClick(): void
  onDoubleClick?(): void
  onAuxClick?(e: any): void
  drag?: { props: Record<string, unknown>; wasDragged(): boolean }
}) {
  const t = useTheme()
  return (
    <div
      {...(input ? {} : drag?.props)}
      onClick={() => input || drag?.wasDragged() || onClick()}
      onDoubleClick={() => input || onDoubleClick?.()}
      onAuxClick={onAuxClick}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 18, flexShrink: 0, paddingLeft: 3 + depth * 16, paddingRight: 4, userSelect: "none", cursor: "default" }}
    >
      <div
        onClick={(e: any) => {
          stop(e)
          toggle?.()
        }}
        onDoubleClick={stop}
        style={{ display: "flex", width: 13, height: 13, alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: toggle ? t["w98.white"] : undefined }}
      >
        {toggle ? <Mark name={open ? "minus_box" : "plus_box"} color={t["w98.shadow"]} /> : null}
      </div>
      <div style={{ width: 3, flexShrink: 0 }} />
      <Art name={art} size={16} />
      {input ? (
        <input {...input} style={{ flexGrow: 1, minWidth: 0, marginLeft: 3, fontSize: 11, fontFamily: FONT, color: t.text, paddingLeft: 1, borderWidth: 1, borderColor: t["w98.dark"], backgroundColor: t["w98.white"] }} />
      ) : (
        <div style={{ display: "flex", marginLeft: 3, paddingLeft: 2, paddingRight: 2, minWidth: 0, flexShrink: 1, backgroundColor: selected ? t["w98.title"] : undefined }}>
          <Label bold={bold} color={selected ? t["w98.white"] : t.text}>
            {label}
          </Label>
        </div>
      )}
    </div>
  )
}

const SessionNode = memo(function SessionNode({ session: id, label, folded, folds, toggle }: { session: string; label: string; folded: boolean; folds: string[]; toggle(id: string): void }) {
  const window = useWindow()
  const tabs = useApp((s) => s.snapshot?.tabs.filter((tab) => tab.workspace_id === id) ?? NO_TABS)
  const sorted = useMemo(() => [...tabs].sort((a, b) => a.number - b.number), [tabs])
  const { renaming, start, input } = useRename({ session: id }, label)
  const { open, menu } = useMenu("session.menu", { session: id })
  const current = window.session === id
  return (
    <>
      <Node
        depth={0}
        open={!folded}
        toggle={() => toggle(id)}
        art={serverOf(id) ? "globe" : "computer"}
        label={label}
        bold={current}
        input={input}
        onClick={() => renaming || window.show(id)}
        onDoubleClick={start}
        onAuxClick={open}
      />
      {menu}
      {folded ? null : sorted.map((tab, i) => <TabNode key={tab.tab_id} tab={tab.tab_id} session={id} label={tabName(tab, i)} folded={folds.includes(tab.tab_id)} toggle={toggle} />)}
    </>
  )
})

const NO_TABS: never[] = []
const NO_PANES: never[] = []

const TabNode = memo(function TabNode({ tab: id, session, label, folded, toggle }: { tab: string; session: string; label: string; folded: boolean; toggle(id: string): void }) {
  const window = useWindow()
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === id) ?? NO_PANES)
  const front = useApp((s) => s.snapshot?.workspaces.find((w) => w.workspace_id === session)?.active_tab_id === id && window.session === session)
  const { renaming, start, input } = useRename({ tab: id }, label)
  const { open, menu } = useMenu(["tab.menu", "tab.actions"], { tab: id })
  const drag = useDraggable({ kind: "pumi.tab", tab: id }, { disabled: renaming })
  return (
    <>
      <Node
        depth={1}
        open={!folded}
        toggle={panes.length ? () => toggle(id) : undefined}
        art="folder"
        label={label}
        selected={front}
        input={input}
        onClick={() => renaming || goTo(window, session, id)}
        onDoubleClick={start}
        onAuxClick={open}
        drag={drag}
      />
      {menu}
      {folded ? null : panes.map((p) => <PaneNode key={p.pane_id} pane={p.pane_id} tab={id} session={session} label={paneName(p)} art={paneArt(p)} />)}
    </>
  )
})

const PaneNode = memo(function PaneNode({ pane, tab, session, label, art }: { pane: string; tab: string; session: string; label: string; art: string }) {
  const window = useWindow()
  const focused = useFocusedPane(tab)
  const { open, menu } = useMenu("pane.menu", { pane })
  const drag = useDraggable({ kind: "pumi.pane", pane })
  return (
    <>
      <Node depth={2} art={art} label={label} bold={focused === pane} onClick={() => goTo(window, session, tab, pane)} onAuxClick={open} drag={drag} />
      {menu}
    </>
  )
})
