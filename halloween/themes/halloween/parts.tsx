// The window's parts Halloween draws itself; the app's own draw the rest in its colours. Every
// menu is a card of the night with a cobweb in its corner and a pumpkin by the row the mouse is
// on; every question is a gravestone in the moonlight; the panes' edges glow as they are dragged;
// and the window starts with a jack-o'-lantern lighting up under the moon.
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Icon, motion, useFont, useMetrics, useTheme, type IconButtonProps, type StyleDesc, type Tokens } from "pumi"
import { grouped, renderComponent, type ActionItem, type Components, type DialogProps, type MenuProps } from "pumi/theme"
import { GHOST, GRAVE_FOOT, MOON, PUMPKIN, cobweb } from "../../src/sprites.ts"
import { Bats } from "../../src/bats.tsx"

/** The title face: the theme brings it (`fonts/`). Titles only; it is not for reading at length. */
export const SPOOKY = "Creepster"

const CORNER_WEB = cobweb(34, 3, 5)

/** The night's cards: a menu's, a submenu's. A faint pumpkin glow under a dark drop. */
function card(t: Tokens, m: { radius: number }): StyleDesc {
  return {
    display: "flex",
    flexDirection: "column",
    minWidth: 210,
    paddingTop: 5,
    paddingBottom: 5,
    borderRadius: m.radius,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.selected,
    boxShadow: [
      { offsetX: 0, offsetY: 8, blurRadius: 22, spreadRadius: 0, color: "#00000099" },
      { offsetX: 0, offsetY: 0, blurRadius: 18, spreadRadius: 0, color: t.glow },
    ],
  }
}

// ── Menus ───────────────────────────────────────────────────────────────────────────────────

/** How long a submenu stays once the mouse leaves it and its row: time to cross to it at a slant. */
const GRACE = 200

/**
 * What a card's rows share: which of its submenus is open. A row's hover opens its submenu and
 * closes the others after `GRACE`; `over` is the mouse in or out of an open submenu, told to every
 * card above it, so a press there is not a press outside them.
 */
interface MenuState {
  sub?: string
  enter(sub?: string): void
  leave(): void
  over(inside: boolean): void
  inSub(): boolean
}

const MenuContext = createContext<MenuState | undefined>(undefined)

function useMenuState(parent?: MenuState): MenuState {
  const [sub, setSub] = useState<string | undefined>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inside = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  return useMemo(() => {
    const later = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setSub(undefined), GRACE)
    }
    return {
      sub,
      enter(next) {
        clearTimeout(timer.current)
        if (next) setSub(next)
        else if (sub) later()
      },
      leave: later,
      over(now) {
        inside.current = now
        if (now) clearTimeout(timer.current)
        else later()
        parent?.over(now)
      },
      inSub: () => inside.current,
    }
  }, [sub, parent])
}

/** The `Menu` part: a slot's actions in their groups, submenus beside, then its components. */
function Menu({ at, actions, components, args, close }: MenuProps) {
  const t = useTheme()
  const m = useMetrics()
  const state = useMenuState()
  return (
    <anchored position={at} fit="snap" snapMargin={8} deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <MenuContext.Provider value={state}>
        <div onMouseDownOutside={() => state.inSub() || close()} style={{ ...card(t, m), position: "relative" }}>
          <svg src={CORNER_WEB} style={{ position: "absolute", top: 0, right: 0, width: 34, height: 34, color: t.webFaint, pointerEvents: "none" }} />
          <MenuRows actions={actions} close={close} />
          {components?.length && actions.length ? <Rule /> : null}
          {components?.map((c) => renderComponent(c, { ...args, close }))}
        </div>
      </MenuContext.Provider>
    </anchored>
  )
}

/** A thin line of thread between a menu's groups. */
function Rule() {
  const t = useTheme()
  return <div style={{ height: 0, flexShrink: 0, marginTop: 5, marginBottom: 5, marginLeft: 10, marginRight: 10, borderTopWidth: 1, borderStyle: "dashed", borderColor: t.border }} />
}

function MenuRows({ actions, close }: { actions: ActionItem[]; close(): void }) {
  return (
    <>
      {grouped(actions).map((group, i) => (
        <Fragment key={`${i}:${group[0]!.group ?? ""}`}>
          {i > 0 ? <Rule /> : null}
          {group.map((a) =>
            a.items ? (
              <SubMenu key={`${a.plugin}/${a.id}`} title={a.title} icon={a.icon} disabled={a.disabled}>
                <MenuRows actions={a.items} close={close} />
              </SubMenu>
            ) : (
              <MenuItem
                key={`${a.plugin}/${a.id}`}
                title={a.title}
                icon={a.icon}
                keys={a.keys}
                checked={a.checked}
                disabled={a.disabled}
                danger={a.danger}
                onClick={() => {
                  close()
                  a.run()
                }}
              />
            ),
          )}
        </Fragment>
      ))}
    </>
  )
}

/** A row whose card opens beside it, on hover or a click, its top row level with this one. */
function SubMenu({ title, icon, disabled, children }: { title: string; icon?: string; disabled?: boolean; children: ReactNode }) {
  const t = useTheme()
  const m = useMetrics()
  const menu = useContext(MenuContext)
  const own = useMenuState(menu)
  const open = menu?.sub === title
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }}>
      <MenuItem title={title} icon={icon} disabled={disabled} more active={open} onEnter={() => menu?.enter(title)} onLeave={() => menu?.leave()} onClick={() => menu?.enter(title)} />
      {open ? (
        <anchored side="right" align="start" gap={6} offset={{ x: 0, y: -6 }} fit="snap" snapMargin={8} deferred occlude priority={2} style={{ backgroundColor: "transparent" }}>
          <MenuContext.Provider value={own}>
            <div onMouseEnter={() => menu?.over(true)} onMouseLeave={() => menu?.over(false)} style={{ ...card(t, m), maxHeight: 24 * 14 + 10, overflowY: "scroll" }}>
              {children}
            </div>
          </MenuContext.Provider>
        </anchored>
      ) : null}
    </div>
  )
}

/** A menu's row: a pumpkin by it while the mouse is on it, its title, then its keys, a tick or a chevron. */
function MenuItem({ title, icon, keys, checked, disabled, danger, more, active, onEnter, onLeave, onClick }: { title: string; icon?: string; keys?: string; checked?: boolean; disabled?: boolean; danger?: boolean; more?: boolean; active?: boolean; onEnter?(): void; onLeave?(): void; onClick(): void }) {
  const t = useTheme()
  const m = useMetrics()
  const menu = useContext(MenuContext)
  const [hovered, setHovered] = useState(false)
  const lit = !disabled && (hovered || active)
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => {
        setHovered(true)
        onEnter ? onEnter() : menu?.enter()
      }}
      onMouseLeave={() => {
        setHovered(false)
        onLeave?.()
      }}
      aria-disabled={disabled}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        height: 24,
        flexShrink: 0,
        marginLeft: 5,
        marginRight: 5,
        paddingLeft: 4,
        paddingRight: 8,
        borderRadius: m.radiusSmall,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        ...(lit ? { backgroundColor: t.active } : {}),
      }}
    >
      <div style={{ display: "flex", width: 14, height: 14, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
        {lit ? <img src={PUMPKIN} style={{ width: 13, height: 13 }} /> : icon ? <Icon name={icon} size={12} color={danger ? t.error : t.faint} /> : null}
      </div>
      <text style={{ fontSize: 13, color: danger ? t.error : lit ? t.text : t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
      {keys || checked !== undefined || more ? <div style={{ flexGrow: 1, minWidth: 18 }} /> : null}
      {keys ? <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{keys}</text> : null}
      {checked ? <Icon name="check" size={12} color={t.accent} /> : null}
      {more ? <Icon name="chevron_right" size={12} color={lit ? t.accent : t.faint} /> : null}
    </div>
  )
}

// ── Questions ───────────────────────────────────────────────────────────────────────────────

/**
 * The `Dialog` part: the question carved on a gravestone in the middle of the window, standing in
 * a mound of grass under a moonlit haze. One that ends something reads R.I.P. over its title.
 * Escape, a press outside it or the first button gives up; Enter goes ahead.
 */
function Dialog({ title, detail, confirm, cancel, danger, input, onConfirm, onCancel }: DialogProps) {
  const t = useTheme()
  return (
    <anchored fill="window" occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          padding: 20,
          background: [{ type: "radial-gradient", center: [0.5, 0.42], radius: 420, stops: [{ color: t.moonlight }, { color: t.scrim }] }],
        }}
      >
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 26 }}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 380 }}
        >
          <div
            autoFocus={!input}
            tabIndex={0}
            onMouseDownOutside={onCancel}
            onKeyDown={(e: any) => {
              if (e.key === "escape") {
                e.preventDefault?.()
                onCancel()
              } else if (e.key === "enter" && !input) {
                e.preventDefault?.()
                onConfirm()
              }
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              width: "100%",
              paddingTop: 38,
              paddingBottom: 18,
              paddingLeft: 26,
              paddingRight: 26,
              borderTopLeftRadius: 150,
              borderTopRightRadius: 150,
              borderBottomLeftRadius: 4,
              borderBottomRightRadius: 4,
              background: { type: "linear-gradient", angle: 180, stops: [{ color: t.stoneLight }, { color: t.stone }] },
              borderWidth: 2,
              borderColor: t.stoneRim,
              keyboardFocusDim: false,
              boxShadow: [
                { offsetX: 0, offsetY: 0, blurRadius: 40, spreadRadius: 0, color: t.moonGlow },
                { offsetX: 0, offsetY: 14, blurRadius: 30, spreadRadius: 0, color: "#000000aa" },
              ],
            }}
          >
            {danger ? <text style={{ fontFamily: SPOOKY, fontSize: 15, color: t.engraved }}>R . I . P .</text> : null}
            <text style={{ fontFamily: SPOOKY, fontSize: 24, color: danger ? t.error : t.accent, textAlign: "center" }}>{title}</text>
            {detail ? <text style={{ fontSize: 13, color: t.muted, textAlign: "center" }}>{detail}</text> : null}
            {input ? (
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
                style={{ alignSelf: "stretch", height: 28, marginTop: 4, fontSize: 13, color: t.text, paddingLeft: 8, paddingRight: 8, borderRadius: 5, borderWidth: 1, borderColor: t.accent, backgroundColor: t.editor }}
              />
            ) : null}
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 8 }}>
              <StoneButton title={cancel} onClick={onCancel} />
              <StoneButton title={confirm} fill={danger ? t.error : t.accent} onClick={onConfirm} />
            </div>
          </div>
          {/* The earth it stands in, a little wider than the stone. */}
          <img src={GRAVE_FOOT} objectFit="fill" style={{ width: "112%", height: 22, marginTop: -10 }} />
        </motion.div>
      </div>
    </anchored>
  )
}

/** A button carved in the stone, or (`fill`) lit like a candle. */
function StoneButton({ title, fill, onClick }: { title: string; fill?: string; onClick(): void }) {
  const t = useTheme()
  return (
    <div
      aria-label={title}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e: any) => {
        if (e.key !== "enter" && e.key !== " ") return
        e.preventDefault?.()
        onClick()
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 28,
        minWidth: 84,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 5,
        cursor: "pointer",
        keyboardFocusDim: false,
        backgroundColor: fill ?? t.stoneDeep,
        borderWidth: 1,
        borderColor: fill ? fill : t.stoneRim,
        ...(fill ? { boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 14, spreadRadius: 0, color: `${fill}66` } } : {}),
        hover: fill ? { opacity: 0.9 } : { backgroundColor: t.stoneRim },
      }}
    >
      <text style={{ fontSize: 13, fontWeight: 600, color: fill ? t.accentText : t.text, whiteSpace: "nowrap" }}>{title}</text>
    </div>
  )
}

// ── Buttons and edges ───────────────────────────────────────────────────────────────────────

/** The `IconButton` part: the app's, lit pumpkin orange under the mouse and while on. */
function IconButton({ icon, onClick, title, active, color }: IconButtonProps) {
  const t = useTheme()
  const m = useMetrics()
  return (
    <div
      onClick={(e: any) => {
        // The press is the button's, not the title bar's (which selects and drags its tab).
        e?.stopPropagation?.()
        onClick()
      }}
      onDoubleClick={(e: any) => e?.stopPropagation?.()}
      aria-label={title}
      aria-pressed={active}
      title={title}
      style={{
        display: "flex",
        width: 24,
        height: 24,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: m.radiusSmall,
        color: color ?? (active ? t.accent : t.faint),
        cursor: "pointer",
        hover: { backgroundColor: t.hover, color: t.accent },
        active: { backgroundColor: t.active },
      }}
    >
      <Icon name={icon} size={14} />
    </div>
  )
}

/** The `Splitter` part: the edge between two panes, a thread that glows under the mouse and burns while dragged. */
function Splitter({ axis, dragging }: { axis: "row" | "column"; dragging: boolean }) {
  const t = useTheme()
  const across = axis === "row" ? { width: 2, height: "100%" } : { height: 2, width: "100%" }
  return (
    <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", hover: { opacity: 1 }, opacity: dragging ? 1 : 0 }}>
      <div style={{ ...across, borderRadius: 1, backgroundColor: dragging ? t.accent : t.glowEdge, boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 8, spreadRadius: 0, color: t.accent } }} />
    </div>
  )
}

// ── Starting ────────────────────────────────────────────────────────────────────────────────

/** Before the server answers: a jack-o'-lantern lighting up under the moon, bats about. A ghost if it gave up. */
function Starting({ title, detail, gaveUp, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  const t = useTheme()
  const mono = useFont().family
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        position: "relative",
        color: t.text,
        background: [{ type: "radial-gradient", center: [0.5, 0.45], stops: [{ color: t.dusk }, { color: t.window }] }],
      }}
    >
      <img src={MOON} style={{ position: "absolute", top: 36, right: 64, width: 72, height: 72, opacity: 0.9 }} />
      <Bats />
      {gaveUp ? (
        <motion.img src={GHOST} animate={{ y: [0, -8, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} style={{ width: 84, height: 84 }} />
      ) : (
        <motion.img src={PUMPKIN} animate={{ opacity: [0.55, 1, 0.75, 1, 0.55] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} style={{ width: 96, height: 96 }} />
      )}
      {title ? <text style={{ fontFamily: SPOOKY, fontSize: 32, color: gaveUp ? t.error : t.accent }}>{title}</text> : null}
      {detail ? <text style={{ fontSize: 13, color: t.muted, maxWidth: 520, textAlign: "center" }}>{detail}</text> : null}
      {lines.length ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, maxWidth: 620 }}>
          {lines.map((line, i) => (
            <text key={i} style={{ fontSize: 11, color: t.faint, fontFamily: mono }}>{line}</text>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Halloween's parts: the rest are the app's, in the theme's colours. */
export const PARTS: Partial<Components> = { Menu, Dialog, IconButton, Splitter, Starting }
