// Windows 98's menus: a raised grey card, a row lit navy under the mouse, a check in the gutter,
// the keys at the far end and an arrow for a row that cascades into another card beside it.
// Every menu of the app's is one (the `Menu` part, from `useMenu`), and so are the window's menu
// bar, the desktop's and the Start menu's cascades.
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTheme } from "pumi"
import { grouped, renderComponent, type ActionItem, type MenuProps } from "pumi/theme"
import { AnyIcon, Art, bevel, FONT, Mark, Separator } from "./kit.tsx"

/** How long a cascade stays once the mouse leaves its row: time to cross to it at a slant. */
const CASCADE_GRACE = 250

/** Which row of a card has its cascade open, and whether the mouse is in a cascade below it. */
interface CardState {
  open?: string
  enter(row?: string): void
  leave(): void
  over(inside: boolean): void
  inside(): boolean
}

const Card = createContext<CardState | undefined>(undefined)

function useCard(parent?: CardState): CardState {
  const [open, setOpen] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inside = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  return useMemo(() => {
    const later = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setOpen(undefined), CASCADE_GRACE)
    }
    return {
      open,
      enter(row) {
        clearTimeout(timer.current)
        if (row) setOpen(row)
        else if (open) later()
      },
      leave: later,
      over(now) {
        inside.current = now
        if (now) clearTimeout(timer.current)
        else later()
        parent?.over(now)
      },
      inside: () => inside.current,
    }
  }, [open, parent])
}

/** A menu's card: raised, grey, a little padding inside its bevel. */
export function MenuCard({ children, width, band }: { children: ReactNode; width?: number; band?: ReactNode }) {
  const t = useTheme()
  const [outer, inner] = bevel(t, "raised")
  return (
    <div style={{ display: "flex", flexDirection: "row", borderWidth: 1, ...outer, backgroundColor: t["w98.face"], boxShadow: { offsetX: 1, offsetY: 1, blurRadius: 0, spreadRadius: 0, color: "#00000066" } }}>
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, borderWidth: 1, ...inner!, padding: 1 }}>
        {band}
        <div style={{ display: "flex", flexDirection: "column", minWidth: width ?? 160, flexGrow: 1 }}>{children}</div>
      </div>
    </div>
  )
}

/**
 * A menu where the mouse is (or under a menu bar's title): `actions` as rows, and the slot's
 * `components` after them. A press outside it, or a pick, closes it.
 */
export function PopupMenu({ at, actions, components, args, close, large, band, width }: MenuProps & { large?: boolean; band?: ReactNode; width?: number }) {
  const state = useCard()
  return (
    <anchored position={at} fit="snap" snapMargin={4} deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <Card.Provider value={state}>
        <div onMouseDownOutside={() => state.inside() || close()} style={{ display: "flex" }}>
          <MenuCard band={band} width={width}>
            <Rows actions={actions} close={close} large={large} />
            {components?.length ? (actions.length ? <Separator /> : null) : null}
            {components?.map((v) => renderComponent(v, { ...args, close }))}
          </MenuCard>
        </div>
      </Card.Provider>
    </anchored>
  )
}

/**
 * A menu dropped from what it is drawn in (a menu bar's title, the Start button): below it, or
 * above it with `side: "top"`. Its own state, so a press outside closes it.
 */
export function DropMenu({ actions, close, side = "bottom", large, band, width }: { actions: ActionItem[]; close(): void; side?: "top" | "bottom"; large?: boolean; band?: ReactNode; width?: number }) {
  const state = useCard()
  return (
    <anchored side={side} align="start" gap={0} fit="snap" snapMargin={2} deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <Card.Provider value={state}>
        <div onMouseDownOutside={() => state.inside() || close()} style={{ display: "flex" }}>
          <MenuCard band={band} width={width}>
            <Rows actions={actions} close={close} large={large} />
          </MenuCard>
        </div>
      </Card.Provider>
    </anchored>
  )
}

/** The `Menu` part: every menu of the app's, as Windows 98 drew one. */
export function Menu(props: MenuProps) {
  return <PopupMenu {...props} />
}

/** Actions as a menu's rows, their groups between grooves; `large` rows have 32-pixel icons (the Start menu's). */
export function Rows({ actions, close, large }: { actions: ActionItem[]; close(): void; large?: boolean }) {
  return (
    <>
      {grouped(actions).map((group, i) => (
        <Fragment key={`${i}:${group[0]!.group ?? ""}`}>
          {i > 0 ? <Separator /> : null}
          {group.map((a) => (
            <Row key={`${a.plugin}/${a.id}`} action={a} close={close} large={large} />
          ))}
        </Fragment>
      ))}
    </>
  )
}

/** One row: its check or icon in the gutter, its title, its keys or its arrow. */
function Row({ action: a, close, large }: { action: ActionItem; close(): void; large?: boolean }) {
  const t = useTheme()
  const card = useContext(Card)
  const mine = useCard(card)
  const key = `${a.plugin}/${a.id}`
  const open = !!a.items && card?.open === key
  const [hot, setHot] = useState(false)
  const lit = (hot || open) && !a.disabled
  const ink = a.disabled ? t["w98.shadow"] : lit ? t["w98.white"] : t.text
  const height = large ? 34 : 20
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }}>
      <div
        onMouseEnter={() => {
          setHot(true)
          card?.enter(a.items ? key : undefined)
        }}
        onMouseLeave={() => {
          setHot(false)
          if (a.items) card?.leave()
        }}
        onClick={() => {
          if (a.disabled) return
          if (a.items) return card?.enter(key)
          close()
          a.run()
        }}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", height, flexShrink: 0, paddingRight: 6, cursor: "default", backgroundColor: lit ? t["w98.title"] : undefined }}
      >
        <div style={{ display: "flex", width: large ? 40 : 20, height, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {a.checked ? <Mark name="check" color={ink} /> : a.icon ? large ? <LargeIcon name={a.icon} /> : <AnyIcon name={a.icon} size={16} /> : null}
        </div>
        <text style={{ fontSize: 11, fontFamily: FONT, color: ink, whiteSpace: "nowrap", flexGrow: 1, minWidth: 0, textOverflow: "ellipsis" }}>{a.title}</text>
        {a.keys ? <text style={{ fontSize: 11, fontFamily: FONT, color: ink, whiteSpace: "nowrap", marginLeft: 24, flexShrink: 0 }}>{a.keys}</text> : null}
        {a.items ? (
          <div style={{ display: "flex", width: 12, justifyContent: "flex-end", marginLeft: 16, flexShrink: 0 }}>
            <Mark name="arrow_right" color={ink} />
          </div>
        ) : null}
      </div>
      {open && a.items ? (
        <anchored side="right" align="start" gap={-3} offset={{ x: 0, y: -3 }} fit="snap" snapMargin={4} deferred occlude priority={2} style={{ backgroundColor: "transparent" }}>
          <Card.Provider value={mine}>
            <div onMouseEnter={() => card?.over(true)} onMouseLeave={() => card?.over(false)} style={{ display: "flex", maxHeight: 20 * 24 + 8, overflowY: "scroll" }}>
              <MenuCard>
                {a.items.length ? (
                  <Rows actions={a.items} close={close} />
                ) : (
                  <div style={{ display: "flex", height: 20, alignItems: "center", paddingLeft: 20, paddingRight: 12 }}>
                    <text style={{ fontSize: 11, fontFamily: FONT, color: t["w98.shadow"] }}>(Empty)</text>
                  </div>
                )}
              </MenuCard>
            </div>
          </Card.Provider>
        </anchored>
      ) : null}
    </div>
  )
}

/** The Start menu's 32-pixel icons: the theme's pictures by name (`programs`, `settings`, …). */
const LARGE: Record<string, string> = {
  programs: "folder",
  documents: "documents",
  settings: "settings",
  find: "find",
  help: "help",
  run: "run",
  shutdown: "shutdown",
  computer: "computer",
  globe: "globe",
  terminal: "dos",
  recycle: "recycle",
  plugin: "plugin",
}

function LargeIcon({ name }: { name: string }) {
  return LARGE[name] ? <Art name={LARGE[name]!} size={32} /> : <AnyIcon name={name} size={24} />
}
