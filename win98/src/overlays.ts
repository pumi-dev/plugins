// What opens over the window: a menu, the session picker, a popover.
//
// Copied from pumi's runtime/bun/examples/default-theme/themes/classic/overlays.ts (with the few
// helpers it had from parts.ts inlined): a TS theme draws the whole window, so the default
// theme's overlays are a theme's own too, and the Lua's `extends: default` has no TS equivalent
// yet. It goes away when themes support `extends`.
//
// win98 draws its own menus (a window's menu bar, the Start menu) and dialogs; these are the ones
// the app opens over any theme: a point's menu, the session picker, a point's popover.
import {
  app,
  div,
  icon,
  input,
  native,
  px,
  text,
  type AppMenu,
  type AppMenuItem,
  type AppPicker,
  type AppPopover,
  type AppState,
  type El,
  type ElementEvent,
  type Json,
  type ThemeContext,
} from "pumi";

/** What the overlays keep between renders: the highlighted row, and the menu it is in. */
export interface OverlayState {
  menuHl: number | null;
  menuFor: string;
}

type Bag = Record<string, unknown> | null | undefined;
const truthy = (v: unknown): boolean => v !== null && v !== undefined && v !== false;
/** A string field, empty when it is not one. */
const s = (v: unknown, key: string): string => {
  const x = (v as Bag)?.[key];
  return typeof x === "string" ? x : "";
};
/** A string field, if it is one. */
const opt = (v: unknown, key: string): string | undefined => {
  const x = (v as Bag)?.[key];
  return typeof x === "string" ? x : undefined;
};
const b = (v: unknown, key: string): boolean => truthy((v as Bag)?.[key]);
const f = (v: unknown, key: string): number => {
  const x = (v as Bag)?.[key];
  return typeof x === "number" ? x : 0;
};
function listOf<T>(v: unknown, key: string): T[] {
  const x = (v as Bag)?.[key];
  return Array.isArray(x) ? (x as T[]) : [];
}
/** A field as text, numbers too. */
const word = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
const label = (cls: string, t: string): El => text(t).class(cls);
const spacer = (): El => div().class("spacer");
/** An icon that is a button: a press runs `click`, and stops there. */
const iconButton = (name: string, title: string, click: (e: ElementEvent) => void): El =>
  div()
    .class("icon-button")
    .title(title)
    .onClick((e) => {
      click(e);
      return true;
    })
    .child(icon(name));
/** A number of the event's (`wx`, `dx`), 0 without it. */
const num = (e: ElementEvent, field: "x" | "y" | "wx" | "wy" | "ox" | "oy" | "dx" | "dy"): number => e.data[field] ?? 0;

export function overlays(state: AppState, cx: ThemeContext<OverlayState>): El {
  return div()
    .id("overlays")
    .when(truthy(state.popover), (e) => e.child(popover(state.popover!)))
    .when(truthy(state.picker), (e) => e.child(picker(state.picker!, cx)))
    .when(truthy(state.menu), (e) => e.child(menu(state.menu!, cx.state)));
}

/** What is under an open menu: a press there runs `close` (it closes the menu). */
const backdrop = (close: () => void): El =>
  div()
    .class("backdrop")
    .onMouseDown(() => {
      close();
      return true;
    });

/** Runs a menu item: closes the menu, then runs the item's command with its arguments; a point's
 * item is chosen where the menu was pressed (`at`). */
function runItem(item: AppMenuItem, at: [number, number]) {
  app.closeMenu();
  const command = opt(item, "cmd");
  if (command === undefined) return;
  const args = listOf<Json>(item, "args");
  if (command === "choose") {
    const arg = (i: number): Json => args[i] ?? null;
    app.command("choose", arg(0), arg(1), arg(2), at[0], at[1]);
  } else {
    app.command(command, ...args);
  }
}
/** The rows of a menu that can be highlighted (1-based): not separators, headings or disabled. */
const choosable = (items: AppMenuItem[]): number[] =>
  items.flatMap((item, n) => (!b(item, "separator") && !b(item, "heading") && !b(item, "disabled") ? [n + 1] : []));
/** The row a key moves the highlight to. */
function step(rows: number[], at: number | null, key: string): number | null {
  if (rows.length === 0) return null;
  const found = at === null ? -1 : rows.indexOf(at);
  let pos = found < 0 ? 0 : found + 1;
  if (key === "down") pos = (pos % rows.length) + 1;
  else if (key === "up") pos = pos <= 1 ? rows.length : pos - 1;
  else if (key === "home") pos = 1;
  else if (key === "end") pos = rows.length;
  else return null;
  return rows[pos - 1] ?? null;
}

function menuItem(item: AppMenuItem, i: number, hl: number | null, state: OverlayState): El {
  if (b(item, "separator")) return div().key(`sep${i}`).class("menu-sep");
  if (b(item, "heading")) return div().key(`head${i}`).class("menu-heading").child(text(s(item, "label")));
  const disabled = b(item, "disabled");
  return div()
    .key(`item${i}`)
    .class("menu-item")
    .when(disabled, (e) => e.class("disabled"))
    .when(hl === i, (e) => e.class("highlighted"))
    .whenSome(opt(item, "desc"), (e, desc) => e.title(desc))
    .onMouseEnter(() => {
      state.menuHl = i;
      return false;
    })
    .onClick((e) => {
      if (!disabled) runItem(item, [num(e, "wx"), num(e, "wy")]);
      return true;
    })
    .child(
      div()
        .class("menu-check")
        .when(b(item, "checked"), (e) => e.child(icon("check"))),
    )
    .whenSome(opt(item, "icon"), (e, name) => e.child(icon(name).class("menu-icon")))
    .child(label("menu-label", s(item, "label")))
    .child(spacer())
    .whenSome(opt(item, "keys"), (e, keys) => e.child(label("menu-keys", keys)))
    .when(truthy(item.opens), (e) => e.child(icon("chevron_right").class("menu-opens")));
}
/** A menu: under the button that opened it, or where it was asked for; the arrows, Home and End
 * move the highlight and Enter runs it. */
function menu(m: AppMenu, state: OverlayState): El {
  const which = `${word(m.id)}${word(m.x)}${word(m.y)}`;
  if (state.menuFor !== which) {
    state.menuFor = which;
    state.menuHl = null;
  }
  const items = m.items;
  const rows = choosable(items);
  const hl = state.menuHl;
  const u = m.under;
  const [x, y] = truthy(u) ? [f(u, "x"), f(u, "y") + f(u, "h") + 4] : [f(m, "x"), f(m, "y")];
  return div()
    .key("menu-layer")
    .class("menu-layer")
    .child(backdrop(() => app.closeMenu()))
    .child(
      div()
        .id("menu")
        .class("menu")
        .class(`menu-${word(m.id)}`)
        .clamp(8)
        .autofocus()
        .left(px(x))
        .top(px(y))
        .onKey((e) => {
          const at = state.menuHl;
          const next = step(rows, at, e.key);
          if (next !== null) {
            state.menuHl = next;
            return true;
          }
          const item = at === null ? undefined : items[at - 1];
          if (e.key === "enter" && item) {
            runItem(item, [0, 0]);
            return true;
          }
          return false;
        })
        .children(items.map((item, i) => menuItem(item, i + 1, hl, state))),
    );
}

type Row = AppPicker["rows"][number];
function pickerRow(row: Row, highlighted: number): El {
  const index = row.index;
  const lit = row.index === highlighted;
  return div()
    .key(`row${word(index)}`)
    .class("picker-row")
    .when(lit, (e) => e.class("highlighted"))
    .when(b(row, "current"), (e) => e.class("current"))
    .onMouseEnter(() => {
      if (!lit) app.pickerMove(index);
      return false;
    })
    .onClick(() => {
      app.pickerPick(index);
      return true;
    })
    .whenSome(opt(row, "icon"), (e, name) => e.child(icon(name).class("picker-icon")))
    .child(label("picker-label", s(row, "label")))
    .when(b(row, "current"), (e) => e.child(icon("check").class("picker-check")))
    .child(spacer())
    .when(b(row, "removable"), (e) =>
      e.child(iconButton("close", "Remove from This Window", () => app.pickerRemove(index)).class("picker-remove")),
    );
}
/** The session picker, under the session button: a search field, this window's sessions, the
 * recent ones, and what opens another. */
function picker(p: AppPicker, cx: ThemeContext<OverlayState>): El {
  const rows = p.rows;
  const kind = (k: string) => rows.filter((r) => r.kind === k);
  const [here, recent, actions] = [kind("here"), kind("recent"), kind("action")];
  const lit = p.highlighted;
  const section = (title: string, list: Row[]): El[] =>
    list.length === 0 ? [] : [div().class("menu-heading").child(text(title)), ...list.map((r) => pickerRow(r, lit))];
  const at = cx.rect("space");
  const [x, y] = at ? [at.x, at.y + at.height + 4] : [80, 40];
  const id = word(p.id);
  return div()
    .key("picker-layer")
    .class("menu-layer")
    .child(backdrop(() => app.closePicker()))
    .child(
      div()
        .id("picker")
        .class("menu picker")
        .class(`picker-${id}`)
        .clamp(8)
        .left(px(x))
        .top(px(y))
        .onKey((e) => {
          if (e.key === "up" || e.key === "down") {
            app.pickerMove(e.key);
            return true;
          }
          return false;
        })
        .child(
          div()
            .class("picker-field")
            .child(
              input(p.query)
                .key(`picker-input-${id}`)
                .class("picker-input")
                .placeholder(p.placeholder)
                .focusable()
                .onInput((e) => {
                  app.pickerQuery(e.value);
                  return false;
                })
                .onSubmit(() => {
                  app.pickerPick();
                  return true;
                }),
            ),
        )
        .child(div().class("menu-sep"))
        .child(
          div()
            .class("picker-list")
            .when(here.length === 0 && recent.length === 0, (e) =>
              e.child(div().class("picker-empty").child(text("No matching sessions"))),
            )
            .children(section("This Window", here))
            .when(here.length > 0 && recent.length > 0, (e) => e.child(div().class("menu-sep")))
            .children(section("Recent Sessions", recent)),
        )
        .child(div().class("menu-sep"))
        .children(actions.map((r) => pickerRow(r, lit))),
    );
}

/** A point's popover, under the button that opened it, or an overlay over the whole window. */
function popover(p: AppPopover): El {
  const view = opt(p, "view");
  const body =
    view !== undefined
      ? native(view).key("popover-view").class("popover-view")
      : div().class("popover-waiting").child(text(p.waiting));
  if (p.overlay) {
    return div().key("popover-layer").class("menu-layer").child(div().id("popover").class("popover overlay").child(body));
  }
  return div()
    .key("popover-layer")
    .class("menu-layer")
    .child(backdrop(() => app.closePopover()))
    .child(
      div()
        .id("popover")
        .class("popover")
        .clamp(8)
        .left(px(p.x))
        .top(px(p.y + 12))
        .w(px(p.w))
        .h(px(p.h))
        .child(body),
    );
}
