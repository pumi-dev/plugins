// The window's parts the office draws in pixel art, beside the room itself (window.tsx):
// every menu and question of the app's as a framed pixel dialog, the lobby's sections (the players
// and each plugin's panel on a notice board), an agent as the lobby lists it, and a button.
import { createContext, Fragment, useContext, useState, type ReactNode } from "react"
import { Icon, useTheme } from "pumi"
import {
  call,
  grouped,
  renderComponent,
  useAgentOf,
  useAgents,
  useComponents,
  useLocal,
  useMenu,
  useSession,
  useSlot,
  via,
  type ActionItem,
  type Components,
  type DialogProps,
  type MenuProps,
} from "pumi/theme"
import { box, Bubble, DialogButton, FONT, Nametag, PixelButton, Sign, Sprite, walkArt, hash } from "./kit.tsx"

const swallow = (err: unknown) => console.error(String(err))

/** How the room is reached from a part: walk to the desk a tab is at and sit down. */
export const RoomContext = createContext<{ visit(tab: string): void } | null>(null)

/**
 * The `Menu` part: every menu of the app's (a desk's, a view's, a tab's, an agent's: `useMenu`), as
 * a pixel dialog where the mouse is. Its groups with a rule between; a submenu opens under its row.
 */
function Menu({ at, actions, components, args, close }: MenuProps) {
  const t = useTheme()
  return (
    <anchored position={at} fit="snap" deferred occlude onMouseDownOutside={close}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 200, padding: 6, fontFamily: FONT, ...box(t, "dialog") }}>
        <MenuRows actions={actions} close={close} depth={0} />
        {components?.map((c) => renderComponent(c, { ...args, close }))}
      </div>
    </anchored>
  )
}

function MenuRows({ actions, close, depth }: { actions: ActionItem[]; close(): void; depth: number }) {
  const t = useTheme()
  const [open, setOpen] = useState<string>()
  const [at, setAt] = useState<string>()
  return (
    <>
      {grouped(actions).map((group, i) => (
        <Fragment key={`${i}:${group[0]!.group ?? ""}`}>
          {i > 0 ? <div style={{ height: 2, marginTop: 4, marginBottom: 4, backgroundColor: t.border }} /> : null}
          {group.map((a) => (
            <Fragment key={`${a.plugin}/${a.id}`}>
              <div
                onMouseEnter={() => setAt(a.id)}
                onClick={() => {
                  if (a.disabled) return
                  if (a.items) return setOpen(open === a.id ? undefined : a.id)
                  close()
                  a.run()
                }}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 2 + depth * 14, paddingRight: 10, cursor: "pointer", opacity: a.disabled ? 0.5 : 1, backgroundColor: at === a.id ? t.selected : undefined }}
              >
                <div style={{ display: "flex", width: 12, flexShrink: 0 }}>{at === a.id ? <text style={{ fontSize: 10, color: t.cursor }}>▶</text> : null}</div>
                {a.icon ? <Icon name={a.icon} size={12} color={a.danger ? t.error : t.muted} /> : null}
                <text style={{ fontFamily: FONT, fontSize: 14, color: a.danger ? t.error : t.text }}>{a.title}</text>
                <div style={{ flexGrow: 1, minWidth: 12 }} />
                {a.keys ? <text style={{ fontSize: 12, color: t.faint }}>{a.keys}</text> : null}
                {a.checked ? <Icon name="check" size={12} color={t.accent} /> : null}
                {a.items ? <Icon name={open === a.id ? "chevron_down" : "chevron_right"} size={12} color={t.muted} /> : null}
              </div>
              {a.items && open === a.id ? <MenuRows actions={a.items} close={close} depth={depth + 1} /> : null}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  )
}

/** The `Dialog` part: a question as a pixel dialog in the middle of the room. */
function Dialog({ title, detail, confirm, cancel, danger, input, onConfirm, onCancel }: DialogProps) {
  const t = useTheme()
  return (
    <anchored fill="window" occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", backgroundColor: t.scrim }}>
        <div
          autoFocus={!input}
          tabIndex={0}
          onMouseDownOutside={onCancel}
          onKeyDown={(e: any) => {
            if (e.key === "escape") onCancel()
            else if (e.key === "enter" && !input) onConfirm()
          }}
          style={{ display: "flex", flexDirection: "column", gap: 10, width: 380, padding: 16, fontFamily: FONT, keyboardFocusDim: false, ...box(t, "dialog") }}
        >
          <text style={{ fontSize: 17, color: t.text }}>{title}</text>
          {detail ? <text style={{ fontSize: 13, color: t.muted }}>{detail}</text> : null}
          {input ? (
            <input
              autoFocus
              value={input.value}
              placeholder={input.placeholder}
              onChange={(e: any) => input.onChange(e.value ?? "")}
              onSubmit={onConfirm}
              style={{ height: 32, fontSize: 14, color: t.slotText, paddingLeft: 8, fontFamily: FONT, ...box(t, "slot") }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <DialogButton label={cancel} onClick={onCancel} />
            <DialogButton label={confirm} fill={danger ? t.error : t.accent} onClick={onConfirm} />
          </div>
        </div>
      </div>
    </anchored>
  )
}

/** A point's components, given `args`, and its actions as buttons. */
export function Point({ point, args, gap = 4 }: { point: string; args?: Record<string, unknown>; gap?: number }) {
  const C = useComponents()
  const { components, actions } = useSlot(point, args)
  if (!components.length && !actions.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap, flexShrink: 0 }}>
      {components.map((c) => renderComponent(c, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} />
      ))}
    </div>
  )
}

// ── The lobby ───────────────────────────────────────────────────────────────────────────────

/**
 * The lobby's sections, each under a sign that folds it: the players (every agent, whatever view
 * it's in) and each plugin's panel on a framed notice board.
 */
function Panel({ point }: { point: string }) {
  const t = useTheme()
  const { components } = useSlot(point)
  const [collapsed, setCollapsed] = useLocal<string[]>(`office.${point}.collapsed`, [])
  const sections: { key: string; title: string; icon?: string; body: ReactNode; board: boolean }[] = [
    { key: "agents", title: "Players", icon: "agent", body: <Agents />, board: false },
    ...components.map((c) => ({ key: `${c.plugin}/${c.id}`, title: c.title ?? c.id, icon: c.icon, body: renderComponent(c), board: true })),
  ]
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, fontFamily: FONT }}>
      {point === "panel" ? <SessionHeader /> : null}
      {sections.map((s) => {
        const open = !collapsed.includes(s.key)
        return (
          <div key={s.key} style={{ display: "flex", flexDirection: "column", minHeight: 0, ...(open ? { flexGrow: 1, flexBasis: 0 } : {}) }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", height: 32, paddingLeft: 8, paddingRight: 8, flexShrink: 0 }}>
              <Sign
                onClick={() => setCollapsed(open ? [...collapsed, s.key] : collapsed.filter((k) => k !== s.key))}
                before={<Icon name={open ? "chevron_down" : "chevron_right"} size={10} color={t.signText} />}
              >
                {s.title}
              </Sign>
            </div>
            {open ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  minHeight: 0,
                  overflowY: "scroll",
                  ...(s.board ? { marginLeft: 8, marginRight: 8, marginBottom: 8, padding: 2, ...box(t, "panel") } : {}),
                }}
              >
                {s.body}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function SessionHeader() {
  const t = useTheme()
  const session = useSession()
  const { components, actions } = useSlot("session.header", { session: session?.workspace_id })
  if (!session || (!components.length && !actions.length)) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, margin: 8, marginBottom: 0, paddingLeft: 8, paddingRight: 4, flexShrink: 0, ...box(t, "panel") }}>
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
        <Point point="session.header" args={{ session: session.workspace_id }} />
      </div>
    </div>
  )
}

function Agents() {
  const C = useComponents()
  const agents = useAgents()
  const t = useTheme()
  if (!agents.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 16 }}>
        <text style={{ fontSize: 13, color: t.muted }}>Nobody's online</text>
      </div>
    )
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 4, paddingRight: 4, gap: 2 }}>
      {agents.map((a) => (
        <C.Agent key={a.tab_id} tab={a.tab_id} />
      ))}
    </div>
  )
}

/** A player: their avatar with a bubble, their tag, what they're on. A click walks you to their desk. */
function Agent({ tab }: { tab: string }) {
  const t = useTheme()
  const C = useComponents()
  const room = useContext(RoomContext)
  const agent = useAgentOf(tab)
  const [hovered, setHovered] = useState(false)
  const { open, menu } = useMenu("agent.menu", { tab })
  if (!agent) return null
  const status = agent.agent_status || "unknown"
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onAuxClick={open}
      onClick={() => (room ? room.visit(tab) : call(via(tab, "tab.focus"), tab).catch(swallow))}
      title="Walk over to their desk"
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 46, paddingLeft: 4, paddingRight: 4, cursor: "pointer", hover: { backgroundColor: t.floorHover } }}
    >
      <div style={{ position: "relative", width: 46, height: 46, flexShrink: 0 }}>
        <Sprite src={walkArt(hash(tab), "down", 0)} width={24} height={34} style={{ position: "absolute", left: 2, top: 10 }} />
        <Bubble status={status} style={{ position: "absolute", left: 20, top: 0 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, flexGrow: 1, minWidth: 0 }}>
        <Nametag dot={t[`agent.${status}`] ?? t["agent.unknown"]}>{agent.name || agent.agent || tab}</Nametag>
        {agent.title ? <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "100%" }}>{agent.title}</text> : null}
        <Point point="agent.footer" args={{ tab }} />
      </div>
      <div style={{ display: "flex", flexDirection: "row", opacity: hovered ? 1 : 0 }}>
        <C.AgentControls tab={tab} />
      </div>
      {menu}
    </div>
  )
}

function AgentControls({ tab }: { tab: string }) {
  const C = useComponents()
  const { components, actions } = useSlot("agent.controls", { tab })
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3 }}>
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} />
      ))}
      {components.map((c) => renderComponent(c, { tab }))}
    </div>
  )
}

function Action({ action, args }: { action: ActionItem; args?: unknown }) {
  return <PixelButton icon={action.icon ?? "ellipsis"} title={action.title} size={26} active={action.checked} onClick={() => action.run(args)} />
}

/** The office's parts beside its window: the rest are the app's, in the theme's colours. */
export const PARTS: Partial<Components> = { Menu, Dialog, Panel, Agent, AgentControls, Action }
