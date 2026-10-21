// The room: a pod for each session with its name on it, a desk for each of its tabs — its little
// screen showing the tab's pane in front, live, and opened big when you point at it — the free desk
// that makes a tab, the props you click (the bookshelf, the coffee machine, the door mat), the
// plants, you, and the name a desk asks for when you rename it.
import { app, div, input, native, text, type AppPane, type AppSpace, type AppState, type AppTab, type El, type ThemeContext } from "pumi";
import { sprite } from "./art.ts";
import { dot, label, num, pct, spacer } from "./parts.ts";
import { CELL_H, CELL_W, WALL, spot, type Cell, type Plan, type Pod } from "./plan.ts";
import { deskAt, keep, sitAt, walkTo, type OfficeState } from "./state.ts";

/** A desk's own screen is small — the one the sprite draws; pointed at, it opens this big. */
const PEEK_W = 720;
const PEEK_H = 440;
/** All of a box: the pane alone, filling the screen it is given. */
const WHOLE = { left: "0%", top: "0%", width: "100%", height: "100%" };

/** A preview is a pane's screen as the app has it, scaled to the box: nothing is attached or
 * resized to draw it, so a desk can show a pane that is not on screen (the theme attaches all). */
const preview = (p: AppPane): El => native(`preview:${p.key}`).class("preview");

/** A pane as a box with its screen in it, at `at` (a share of the box it sits in). */
function paneBox(p: AppPane, at: { left: string; top: string; width: string; height: string }): El {
  return div()
    .key(`pane${p.key}`)
    .class("desk-pane")
    .class(`kind-${p.kind || "terminal"}`)
    .left(at.left)
    .top(at.top)
    .w(at.width)
    .h(at.height)
    .child(p.kind === "terminal" ? preview(p) : label("desk-pane-label", p.title || p.kind));
}

/** A tab's panes as boxes, each with its screen in it: the whole tab, laid out as the tab is. */
function panes(tab: AppTab): El[] {
  return tab.panes
    .filter((p) => !p.hidden)
    .map((p) => paneBox(p, { left: pct(p.x), top: pct(p.y), width: pct(p.w), height: pct(p.h) }));
}

/** The pane in front of a tab: what the desk's screen has in it. */
const front = (tab: AppTab): AppPane | undefined => tab.panes.find((p) => p.focused) ?? tab.panes[0];

/** Where the open screen goes: beside the desk, to its right when there is room, else its left. */
function opened(cell: Cell, p: Plan): Cell {
  let left = cell.x + CELL_W + 14;
  if (left + PEEK_W > p.w - 8) left = cell.x - PEEK_W - 14;
  left = Math.max(8, Math.min(left, p.w - PEEK_W - 8));
  let top = cell.y + Math.floor(CELL_H / 2 - PEEK_H / 2);
  top = Math.max(WALL + 8, Math.min(top, p.floor_h - PEEK_H - 64));
  return { x: left - cell.x, y: top - cell.y };
}

/** A desk's screen. Without `pane` it is the tab's: the pane in front, or — pointed at — every pane
 * of the tab, laid out as the tab is. With `pane` (a desk of its own) it is that one pane's screen. */
function screen(tab: AppTab, space: AppSpace, cell: Cell, p: Plan, open: boolean, pane: AppPane | undefined): El {
  const status = pane !== undefined && (pane.status ?? "") !== "" ? pane.status : tab.status || "";
  const title = pane !== undefined ? `${tab.title}  ·  ${pane.title || pane.kind || "pane"}` : tab.title;
  if (open) {
    const at = opened(cell, p);
    return div()
      .class("screen open")
      .left(at.x)
      .top(at.y)
      .w(PEEK_W)
      .h(PEEK_H)
      .child(
        div()
          .class("screen-bar")
          .child(dot(status))
          .child(label("screen-title", `${space.label || "Session"}  ·  ${title}`))
          .child(spacer())
          .child(label("screen-hint", "click the desk to work here")),
      )
      .child(div().class("screen-panes").children(pane !== undefined ? [paneBox(pane, WHOLE)] : panes(tab)));
  }
  const shown = pane ?? front(tab);
  return div()
    .class(`screen of-${tab.of}`)
    .whenSome(shown, (e, at) => e.child(paneBox(at, WHOLE)));
}

/** An easter egg: a cup of coffee for every pane open on the desk, so a desk you have been splitting
 * all night has a row of them. */
function cups(tab: AppTab): El[] {
  const out: El[] = [];
  for (let i = 1; i <= Math.min(tab.panes.length, 5); i++) {
    out.push(sprite("cup", "cup").key(`cup${i}`).left(48 + (i - 1) * 13).top(36));
  }
  return out;
}

/** What a desk says in its bubble, by the status it is in. */
const BUBBLE: Record<string, string> = { working: "…", blocked: "!", done: "✓", error: "✕" };

/** Who sits at a desk: a shirt of their own per tab, and per pane when a desk is a pane's. */
const shirt = (tab: AppTab, i: number): number => ((tab.id + (i || 1) - 1) % 5) + 2;

/** A desk's key: its tab's, and its pane's when it is a pane's. */
export const deskKey = (tab: AppTab, pane?: AppPane): string => `desk${tab.id}${pane !== undefined ? `:${pane.key}` : ""}`;

/** What it holds, as its nameplate and its tooltip say it. */
const where = (tab: AppTab, pane?: AppPane): string =>
  pane !== undefined ? `${tab.title}  ·  ${pane.title || pane.kind || "pane"}` : tab.title;

/** A desk: its sprite, its screen, the chair you sit in, the person at it and its nameplate. Dragged,
 * it moves (and stays where you put it); clicked, you walk over and sit at its monitor; pointed at,
 * its screen opens. */
export function desk(cx: ThemeContext<OfficeState>, tab: AppTab, space: AppSpace, cell: Cell, p: Plan, pane: AppPane | undefined, i: number): El {
  const st = cx.state;
  const status = pane !== undefined && (pane.status ?? "") !== "" ? pane.status : tab.status || "";
  const key = deskKey(tab, pane);
  const name = where(tab, pane);
  const active = tab.active && (pane === undefined || pane.focused);
  cell = deskAt(st, key, cell);
  const open = st.peek === key;
  return div()
    .key(key)
    .class("desk")
    .when(space.active, (e) => e.class("in-session"))
    .when(active, (e) => e.class("active"))
    .when(status !== "", (e) => e.class(`status-${status}`))
    .when(st.dragging === key, (e) => e.class("moving"))
    .when(open, (e) => e.class("peeking"))
    .when(pane !== undefined, (e) => e.class("one-pane"))
    .of(tab.of)
    .title(`${space.label || "Session"} · ${name}  —  click to work here`)
    .left(cell.x)
    .top(cell.y)
    .onMouseDown(() => {
      st.moved = 0;
    })
    .onDrag((e) => {
      const at = st.desks[key] ?? { x: cell.x, y: cell.y };
      at.x = Math.max(0, Math.floor(at.x + num(e, "dx")));
      at.y = Math.max(WALL, Math.floor(at.y + num(e, "dy")));
      st.desks[key] = at;
      st.moved += Math.abs(num(e, "dx")) + Math.abs(num(e, "dy"));
      if (st.moved > 4) st.dragging = key;
      return true;
    })
    .onDragEnd(() => {
      st.dragging = null;
      keep(st);
    })
    .onClick(() => {
      if (st.moved > 4) {
        st.moved = 0;
        return true;
      }
      sitAt(cx, tab, space, cell, pane?.key);
      return true;
    })
    .onContextMenu((e) => {
      if (pane !== undefined) app.paneMenu(pane.key, num(e, "wx"), num(e, "wy"));
      else app.tabMenu(tab.id, num(e, "wx"), num(e, "wy"));
      return true;
    })
    .onDoubleClick(() => {
      app.startRename(pane !== undefined ? `pane:${pane.key}` : `tab:${tab.id}`);
      return true;
    })
    .onMouseEnter(() => {
      st.peek = key;
      return true;
    })
    .onMouseLeave(() => {
      if (st.peek === key) st.peek = null;
    })
    .child(sprite("desk", "desk-art"))
    .when(pane === undefined, (e) => e.children(cups(tab)))
    .child(screen(tab, space, cell, p, open, pane))
    .child(sprite("chair", "chair"))
    .when(status !== "", (e) => e.child(sprite(`seated${shirt(tab, i)}`, "seated")))
    .whenSome(BUBBLE[status], (e, glyph) => e.child(div().class(`bubble bubble-${status}`).child(text(glyph))))
    .child(div().class("nameplate").child(dot(status)).child(label("nameplate-text", name)));
}

/** The desk a session always has free: walking to it, and clicking it, makes a new tab there. */
function freeDesk(cx: ThemeContext<OfficeState>, space: AppSpace, cell: Cell): El {
  return div()
    .key(`free-desk${space.id}`)
    .class("desk free")
    .title(`New desk: a new tab in ${space.label || "this session"}`)
    .left(cell.x)
    .top(cell.y)
    .onClick(() => {
      walkTo(cx, spot(cell), () => {
        app.selectSpace(space.id);
        app.run("new_tab");
      });
      return true;
    })
    .child(sprite("desk", "desk-art"))
    .child(sprite("chair", "chair"))
    .child(div().class("nameplate").child(label("nameplate-text", "+ New desk")));
}

/** You: the sprite that walks the floor (`#you`'s CSS transition is the walk). */
export function you(cx: ThemeContext<OfficeState>, p: Plan): El {
  const st = cx.state;
  const at = st.you ?? p.centre;
  return div()
    .key("you")
    .id("you")
    .when(st.walking, (e) => e.class("walking"))
    .css("transform", `translate(${at.x}px, ${at.y}px)`)
    .child(div().class("you-label").child(div().class("online")).child(text("You")))
    .child(sprite("person1", "you-art"));
}

/** What `app.renaming` names — a tab (`tab:12`) or a pane (`pane:t:%3`) — and its name as it is. */
interface Target {
  what: string;
  name: string;
  space: AppSpace;
  tab: AppTab;
  pane?: AppPane;
}
function renaming(state: AppState, target: string): Target | undefined {
  const digits = /^tab:(\d+)$/.exec(target);
  const tabId = digits ? Number(digits[1]) : undefined;
  for (const space of state.spaces) {
    for (const tab of space.tab_list ?? []) {
      if (tabId !== undefined && tab.id === tabId) return { what: "desk", name: tab.label ?? tab.title, space, tab };
      for (const pane of tab.panes ?? []) {
        if (target === `pane:${pane.key}`) return { what: "pane", name: pane.title, space, tab, pane };
      }
    }
  }
  return undefined;
}

/** A desk's (or a pane's) name, asked for in the middle of the room. */
export function rename(cx: ThemeContext<OfficeState>): El | null {
  const state = cx.app;
  const st = cx.state;
  if (!state.renaming) {
    st.typed = null;
    return null;
  }
  const r = renaming(state, state.renaming);
  if (!r) return null;
  const name = r.name ?? "";
  const done = (value: string): boolean => {
    const to = value.trim();
    if (r.pane !== undefined) app.renamePane(r.pane.key, to);
    else app.renameTab(r.tab.id, to);
    st.typed = null;
    return true;
  };
  return div()
    .id("rename-backdrop")
    .onClick(() => {
      app.finishRename();
      st.typed = null;
      return true;
    })
    .child(
      div()
        .id("rename")
        .onClick(() => true)
        .child(label("rename-title", `Rename ${r.what}`))
        .child(label("rename-where", `${r.space.label || "Session"}  ·  ${r.tab.title || ""}`))
        .child(
          input(name)
            .class("rename-input")
            .focusable()
            .autofocus()
            .onInput((e) => {
              st.typed = e.value;
              return false;
            })
            .onSubmit((e) => done(e.value)),
        )
        .child(
          div()
            .class("rename-actions")
            .child(
              div()
                .class("rename-button")
                .onClick(() => {
                  app.finishRename();
                  st.typed = null;
                  return true;
                })
                .child(text("Cancel")),
            )
            .child(div().class("rename-button primary").onClick(() => done(st.typed ?? name)).child(text("Rename"))),
        ),
    );
}

/** A session: its carpet, and its name above its desks. */
function podCarpet(pod: Pod): El {
  const space = pod.space;
  return div()
    .key(`pod${space.id}`)
    .class("pod")
    .when(space.active, (e) => e.class("active"))
    .left(pod.x)
    .top(pod.y)
    .w(pod.w)
    .h(pod.h)
    .child(div().class("pod-carpet").left(0).top(0).w(pod.w).h(pod.h))
    .child(
      div()
        .class("pod-label")
        .left(0)
        .top(8)
        .w(pod.w)
        .child(
          div()
            .class("pod-head")
            .title(`${space.label} — click to make it the session in front`)
            .onClick(() => {
              app.selectSpace(space.id);
              return true;
            })
            .child(dot(space.status))
            .child(label("pod-name", space.label || "Session"))
            .child(label("pod-count", String((space.tab_list ?? []).length))),
        ),
    );
}

/** Things to stand where a pod has room left: one per spare place, in the same order each time. */
const DECOR = [
  { art: "plant", w: 28, h: 44, top: 66 },
  { art: "coffee", w: 32, h: 48, top: 64 },
  { art: "mat", w: 60, h: 28, top: 96 },
  { art: "plant", w: 28, h: 44, top: 66 },
];
function decor(i: number, cell: Cell): El {
  const d = DECOR[(i - 1) % DECOR.length]!;
  return sprite(d.art, "decor").left(cell.x + Math.floor((CELL_W - d.w) / 2)).top(cell.y + d.top).w(d.w).h(d.h);
}

/** The bookshelf (the plugins' pages), the coffee machine (Settings) and the door mat (your other
 * sessions). */
function props(cx: ThemeContext<OfficeState>, p: Plan): El[] {
  const st = cx.state;
  return [
    div()
      .key("shelf")
      .class("prop")
      .title("Bookshelf: plugins")
      .left(36)
      .top(WALL + 16)
      .onClick(() => {
        st.shelf = !st.shelf;
        return true;
      })
      .child(sprite("shelf", "shelf-art"))
      .child(div().class("prop-label").child(text("Plugins"))),
    div()
      .key("coffee")
      .class("prop")
      .title("Coffee: Settings")
      .left(p.w - 84)
      .top(WALL + 12)
      .onClick(() => {
        app.settings();
        return true;
      })
      .child(sprite("coffee", "coffee-art"))
      .child(div().class("prop-label").child(text("Settings"))),
    div()
      .key("mat")
      .class("prop")
      .title("Sessions")
      .left(Math.floor(p.w / 2) - 30)
      .top(p.floor_h - 30)
      .onClick(() => {
        app.projects();
        return true;
      })
      .child(sprite("mat", "mat-art")),
  ];
}

/** The room: the floor you walk on (a press anywhere on it takes you there — a desk's own press
 * stops before it), the wall, the pods and their desks, the props, the plants and you. */
export function room(cx: ThemeContext<OfficeState>, p: Plan): El {
  const st = cx.state;
  const kids: El[] = [div().id("wall")];
  let spare = 0;
  for (const pod of p.pods) {
    kids.push(podCarpet(pod));
    pod.seats.forEach((seat, n) => {
      kids.push(desk(cx, seat.tab, pod.space, pod.cells[n]!, p, seat.pane, seat.i));
    });
    // The free desk, and what stands in the places past it (two of them, at most).
    const taken = pod.seats.length + 1;
    kids.push(freeDesk(cx, pod.space, pod.cells[taken - 1] ?? pod.cells[pod.cells.length - 1]!));
    let extras = 0;
    for (let i = taken + 1; i <= pod.cells.length && extras < 2; i++) {
      const cell = pod.cells[i - 1];
      if (cell === undefined) continue;
      spare += 1;
      extras += 1;
      kids.push(decor(spare, cell));
    }
  }
  kids.push(...props(cx, p));
  for (const left of [60, 96]) kids.push(sprite("plant", "plant").left(left).top(p.bottom + 40));
  for (const left of [p.w - 116, p.w - 80]) kids.push(sprite("plant", "plant").left(left).top(p.bottom + 40));
  kids.push(you(cx, p));
  return div().id("room").child(
    div()
      .id("floor")
      .h(p.floor_h)
      .onClick((e) => {
        if (st.moved > 4) {
          st.moved = 0;
          return true;
        }
        const floor = cx.rect("floor");
        if (!floor) return true;
        st.sitting = null;
        walkTo(cx, { x: Math.floor(e.x - floor.x), y: Math.max(WALL, Math.floor(e.y - floor.y)) });
        return true;
      })
      .children(kids),
  );
}
