// The Explorer bar down a window's left (`toggle_sidebar`): the folders view, every session as a
// computer with its views as folders and their tabs inside them, as a tree with plus and minus
// boxes; or one of the panels plugins contribute (`panel`), picked on its header's buttons.
import { memo, useCallback, useMemo } from "react"
import { useDraggable, useTheme } from "pumi"
import {
  call,
  componentKey,
  renderComponent,
  serverOf,
  useApp,
  useLocal,
  useMenu,
  useRename,
  useSessions,
  useSidebar,
  useSlot,
  useWindow,
  via,
  type RenameInput,
  type View as ViewInfo,
} from "pumi/theme"
import { Art, Box, CaptionButton, FONT, Label, Mark, PushButton, stop, swallow, tabArt, tabTitle, viewName } from "./kit.tsx"

const FOLDERS = "folders"
const NONE: string[] = []

/** Shows a session in `window`, and one of its tabs in front. */
export function goTo(window: { session?: string; show(session: string): void }, session: string, tab?: string) {
  if (window.session !== session) window.show(session)
  if (tab) call(via(tab, "tab.focus"), tab).catch(swallow)
}

/** The Explorer bar: its header (what it shows, and ×), and the folders or a plugin's panel. */
export function ExplorerBar({ width }: { width: number }) {
  const t = useTheme()
  const [, setOpen] = useSidebar()
  const panels = useSlot("panel").components
  const [shown, setShown] = useLocal<string>("win98.explorer.view", FOLDERS)
  const panel = panels.find((v) => componentKey(v) === shown)
  return (
    <div style={{ display: "flex", flexDirection: "column", width, flexShrink: 0, minHeight: 0, marginRight: 2 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 20, flexShrink: 0, paddingLeft: 4, paddingRight: 1 }}>
        <Label>{panel ? (panel.title ?? panel.id) : "All Folders"}</Label>
        <div style={{ flexGrow: 1 }} />
        <CaptionButton glyph="close" title="Close the Explorer bar" onClick={() => setOpen(false)} />
      </div>
      {panels.length ? (
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 2, paddingBottom: 2, flexShrink: 0 }}>
          <PushButton label="Folders" art="folder" pushed={!panel} onClick={() => setShown(FOLDERS)} style={{ height: 22 }} />
          {panels.map((v) => (
            <PushButton key={componentKey(v)} label={v.title ?? v.id} icon={v.icon ?? "blocks"} pushed={panel === v} onClick={() => setShown(componentKey(v))} style={{ height: 22 }} />
          ))}
        </div>
      ) : null}
      <Box kind="field" style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }} inner={{ overflowY: "scroll", scrollbarColor: t["w98.shadow"], scrollbarWidth: 8 }}>
        {panel ? <div style={{ display: "flex", flexDirection: "column", padding: 2 }}>{renderComponent(panel)}</div> : <Folders />}
      </Box>
    </div>
  )
}

/** Every session, its views and their tabs, as a tree. */
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
  const views = useApp((s) => s.snapshot?.views.filter((view) => view.workspace_id === id) ?? NO_VIEWS)
  const sorted = useMemo(() => [...views].sort((a, b) => a.number - b.number), [views])
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
      {folded ? null : sorted.map((view) => <ViewNode key={view.view_id} view={view} session={id} folded={folds.includes(view.view_id)} toggle={toggle} />)}
    </>
  )
})

const NO_VIEWS: never[] = []
const NO_TABS: never[] = []

const ViewNode = memo(function ViewNode({ view, session, folded, toggle }: { view: ViewInfo; session: string; folded: boolean; toggle(id: string): void }) {
  const window = useWindow()
  const tabs = useApp((s) => s.snapshot?.tabs.filter((tab) => tab.view_id === view.view_id) ?? NO_TABS)
  const front = useApp((s) => s.snapshot?.workspaces.find((w) => w.workspace_id === session)?.active_view_id === view.view_id && window.session === session)
  const label = viewName(view)
  const { renaming, start, input } = useRename({ view: view.view_id }, label)
  const { open, menu } = useMenu(["view.menu", "view.actions"], { view: view.view_id })
  const drag = useDraggable({ kind: "pumi.view" as const, view: view.view_id }, { disabled: renaming })
  return (
    <>
      <Node
        depth={1}
        open={!folded}
        toggle={tabs.length ? () => toggle(view.view_id) : undefined}
        art="folder"
        label={label}
        selected={front}
        input={input}
        onClick={() => renaming || goTo(window, session, view.view_id)}
        onDoubleClick={start}
        onAuxClick={open}
        drag={drag}
      />
      {menu}
      {folded ? null : tabs.map((tab) => <TabNode key={tab.tab_id} tab={tab.tab_id} session={session} />)}
    </>
  )
})

const TabNode = memo(function TabNode({ tab: id, session }: { tab: string; session: string }) {
  const window = useWindow()
  const tab = useApp((s) => s.snapshot?.tabs.find((t) => t.tab_id === id))
  const { open, menu } = useMenu("tab.menu", { tab: id })
  const drag = useDraggable({ kind: "pumi.tab" as const, tab: id })
  if (!tab) return null
  return (
    <>
      <Node depth={2} art={tabArt(tab)} label={tabTitle(tab)} onClick={() => goTo(window, session, id)} onAuxClick={open} drag={drag} />
      {menu}
    </>
  )
})
