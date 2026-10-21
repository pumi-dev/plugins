// Copied from pumi's default theme (`runtime/bun/examples/default-theme/themes/classic/docks.ts`),
// which alltabs extends and does not replace. A stopgap until the SDK grows `extends` or a shared
// default window.
//
// The docks: the side bars and the bottom panel, their pages and sections, and the buttons that
// pick a page; pages and sections are dragged between them (src/ui/shell/default_theme/docks.rs).
import { app, div, icon, native, px, text, type AppPage, type AppPanelLeaf, type AppSection, type Dock, type El, type ElementEvent, type Json, type ThemeContext } from "pumi";
import { activePage, b, dot, dragged, f, iconButton, label, num, pages, s, slot, spacer, truthy, word, type Cx, type Drag, type State } from "./parts.ts";

type Part = "sidebar" | "secondary" | "bottom";

/** Which window flag shows a dock. */
const shownBy = (dock: Dock): Part => (dock === "primary" ? "sidebar" : dock === "secondary" ? "secondary" : "bottom");
const dockIcon = (dock: Dock): string =>
  dock === "primary" ? "layout_sidebar_left" : dock === "secondary" ? "layout_sidebar_right" : "layout_panel_bottom";
const draggingSections = (state: State): boolean => truthy(state.dragging?.keys);

/** Makes `e` carry `data` when dragged, and the theme know it is being dragged. */
const dragPanel = (e: El, data: Drag, state: State): El =>
  e
    .draggable(data as Json)
    .onDragStart(() => {
      state.dragging = data;
      return false;
    })
    .onDragEnd(() => {
      state.dragging = null;
      return false;
    });
/** What dragging a whole page carries: the page and its sections. */
const pageDrag = (p: AppPage): Drag => ({ page: p.id, keys: p.sections.map((sec) => sec.key) });

/** Sections dropped on a page's button or tab: at its ends they make a page beside it, in its
 * middle they join it. */
function dropOnPage(ev: ElementEvent, page: AppPage, dock: Dock, state: State): boolean {
  const d = dragged(ev);
  const r = ev.data.current;
  if (!r) return false;
  if (!truthy(d.keys) || r.width === 0) return false;
  const at = (num(ev, "x") - r.x) / r.width;
  if (!(at >= 0.3 && at <= 0.7)) {
    if (d.page !== page.id) app.insertPage(d.page ?? null, d.keys!, dock, page.id, at > 0.7);
  } else if (d.page !== page.id) {
    app.moveSections(d.keys!, page.id);
  }
  state.dragging = null;
  return true;
}
/** Sections dropped on a dock make a page of their own there. */
function dropOnDock(ev: ElementEvent, dock: Dock, state: State): boolean {
  const d = dragged(ev);
  if (!truthy(d.keys)) return false;
  app.dockPanel(d.page ?? null, d.keys!, dock);
  state.dragging = null;
  return true;
}

/** A dock's edge, dragged to size it: `what` is `sidebar`, `secondary` or `bottom`. */
function handle(what: Part, edge: "right" | "left" | "top", given: number, state: State): El {
  return div()
    .class("handle")
    .class(`handle-${edge}`)
    .onDrag((ev) => {
      const [dx, dy] = [num(ev, "dx"), num(ev, "dy")];
      const now = state.sizes[what] ?? given;
      const d = edge === "right" ? dx : edge === "left" ? -dx : edge === "top" ? -dy : dy;
      state.sizes[what] = Math.max(now + d, 120);
      return true;
    })
    .onDragEnd(() => {
      const size = state.sizes[what];
      delete state.sizes[what];
      if (size !== undefined) app.setSize(what, size);
      return false;
    });
}
const size = (state: State, what: Part, given: number): number => state.sizes[what] ?? given;

/** Drop targets over a section's halves while sections are dragged: before it, or after. */
function sectionDrops(sec: AppSection, page: AppPage, state: State): El[] {
  if (!draggingSections(state)) return [];
  return [false, true].map((after) => {
    const side = after ? "after" : "before";
    return div()
      .key(side)
      .class("section-drop")
      .class(side)
      .onDrop((ev) => {
        const keys = dragged(ev).keys;
        if (!truthy(keys)) return false;
        app.dropSections(keys!, page.id, sec.key, after);
        state.dragging = null;
        return true;
      });
  });
}
/** The edge between two open sections, dragged to share the height between them. */
function sectionSplit(up: AppSection, down: AppSection, cx: ThemeContext<State>): El {
  const [u, d] = [word(up.key), word(down.key)];
  const sizes = (st: State) => [st.sectionSizes[u] ?? f(up, "size"), st.sectionSizes[d] ?? f(down, "size")] as const;
  return div()
    .key("split")
    .class("handle handle-top section-split")
    .onDrag((ev) => {
      const st = cx.state;
      const fresh = !st.split || st.split.up !== u || st.split.down !== d;
      if (fresh) {
        const [upper, lower] = [cx.rect(`section-${u}`), cx.rect(`section-${d}`)];
        if (!upper || !lower) return true;
        const [wa, wb] = sizes(st);
        st.split = { up: u, down: d, top: upper.height, pair: upper.height + lower.height, weight: wa + wb, dy: 0 };
      }
      const sp = st.split;
      if (!sp) return true;
      sp.dy += num(ev, "dy");
      const least = Math.min(64, sp.pair / 2);
      const h = Math.max(least, Math.min(sp.top + sp.dy, sp.pair - least));
      const upper = (sp.weight * h) / Math.max(sp.pair, 1);
      st.sectionSizes[u] = upper;
      st.sectionSizes[d] = sp.weight - upper;
      return true;
    })
    .onDragEnd(() => {
      const st = cx.state;
      const [upper, lower] = [st.sectionSizes[u], st.sectionSizes[d]];
      if (upper !== undefined && lower !== undefined) app.setSectionSizes([[u, upper], [d, lower]]);
      st.split = null;
      st.sectionSizes = {};
      return false;
    })
    .onDoubleClick(() => {
      const [wa, wb] = sizes(cx.state);
      const half = (wa + wb) / 2;
      app.setSectionSizes([[u, half], [d, half]]);
      return true;
    });
}
function section(sec: AppSection, stacked: boolean, first: boolean, page: AppPage, above: AppSection | undefined, cx: ThemeContext<State>): El {
  const state = cx.state;
  const key = word(sec.key);
  const open = !stacked || first || !sec.collapsed;
  const grow = state.sectionSizes[key] ?? (typeof sec.size === "number" ? sec.size : 1);
  return div()
    .key(key)
    .id(`section-${key}`)
    .class("section")
    .when(open, (e) => e.class("open"))
    .when(open && stacked, (e) => e.flexGrow(grow))
    .when(stacked, (e) => {
      const head = div()
        .class("section-header")
        .onClick(() => {
          if (!first) app.toggleSection(sec.key);
          return true;
        })
        .when(!first, (h) => h.child(icon(open ? "chevron_down" : "chevron_right").class("chevron")))
        .child(label("section-label", sec.label));
      return e.child(dragPanel(head, { keys: [sec.key] }, state));
    })
    .when(open, (e) => e.child(native(sec.view).class("section-body")))
    .whenSome(open ? above : undefined, (e, up) => e.child(sectionSplit(up, sec, cx)))
    .children(sectionDrops(sec, page, state));
}
/** A dock's page: its sections, stacked when there are several; or a note that there is none. */
function pageBody(page: AppPage | undefined, dock: Dock | undefined, cx: ThemeContext<State>): El {
  const state = cx.state;
  if (!page) {
    return div()
      .class("page-empty")
      .whenSome(dock, (e, dock) => e.onDrop((ev) => dropOnDock(ev, dock, state)))
      .child(text("No plugins running. Turn one on in Settings."));
  }
  const sections = page.sections;
  const stacked = sections.length > 1;
  let above: AppSection | undefined;
  const kids: El[] = [];
  sections.forEach((sec, i) => {
    const open = !stacked || i === 0 || !sec.collapsed;
    kids.push(section(sec, stacked, i === 0, page, open ? above : undefined, cx));
    if (open) above = sec;
  });
  return div()
    .key(word(page.id))
    .class("page")
    .onDrop((ev) => {
      const keys = dragged(ev).keys;
      if (!truthy(keys)) return false;
      app.dropSections(keys!, page.id);
      state.dragging = null;
      return true;
    })
    .children(kids);
}

/** A dock's page buttons (in the status bar): pressing the page shown hides the dock. A dock with
 * no pages shows a place to drop sections while they are dragged. */
export function dockButtons({ app: state, cx }: Cx, dock: Dock): El | null {
  const st = cx.state;
  const docked = pages(state, dock);
  const base = () => div().class("dock-buttons").class(`dock-buttons-${dock}`);
  if (docked.length === 0) {
    if (!draggingSections(st)) return null;
    return base()
      .class("dock-drop")
      .title("Move here")
      .onDrop((ev) => dropOnDock(ev, dock, st))
      .child(icon(dockIcon(dock)));
  }
  const w = state.window;
  const wanted = dock === "primary" ? w.page : dock === "secondary" ? w.secondary_page : w.bottom_page;
  const active = activePage(docked, wanted);
  const shown = b(w, shownBy(dock)) && (dock !== "panel" || !truthy(w.bottom_leaf));
  return base()
    .onDrop((ev) => dropOnDock(ev, dock, st))
    .children(
      docked.map((p) => {
        const is = shown && active?.id === p.id;
        const button = iconButton(p.icon ?? "package", p.label, () => {
          if (is) app.toggle(shownBy(dock));
          else app.selectPage(p.id, dock);
        })
          .key(`${dock}${word(p.id)}`)
          .class("dock-button")
          .when(is, (e) => e.class("active"))
          .onDrop((ev) => dropOnPage(ev, p, dock, st));
        return dragPanel(button, pageDrag(p), st);
      }),
    );
}

export function sidebar({ app: state, cx }: Cx, docked: AppPage[]): El {
  const w = state.window;
  const width = w.sidebar_width;
  return div()
    .id("sidebar")
    .w(px(size(cx.state, "sidebar", width)))
    .children(slot(state, "sidebar.head", "sidebar-head"))
    .child(pageBody(activePage(docked, w.page), "primary", cx))
    .child(handle("sidebar", "right", width, cx.state));
}
export function secondary({ app: state, cx }: Cx, docked: AppPage[]): El {
  const w = state.window;
  const width = w.secondary_width;
  return div()
    .id("secondary-sidebar")
    .w(px(size(cx.state, "secondary", width)))
    .child(pageBody(activePage(docked, w.secondary_page), "secondary", cx))
    .child(handle("secondary", "left", width, cx.state));
}

function panelLeafTab(l: AppPanelLeaf, active: boolean): El {
  const key = l.key;
  const title = s(l, "title") || s(l, "kind");
  return div()
    .key(word(key))
    .class("panel-tab panel-leaf")
    .when(active, (e) => e.class("active"))
    .draggable({ pane: key })
    .onClick(() => {
      app.selectPanelLeaf(key);
      return true;
    })
    .onMouseDown((e) => {
      if (e.data.button === "middle") {
        app.closePane(key);
        return true;
      }
      return false;
    })
    .onContextMenu((e) => {
      app.paneMenu(key, num(e, "wx"), num(e, "wy"));
      return true;
    })
    .child(dot(l.status))
    .child(label("panel-tab-title", title))
    .child(iconButton("close", "Close Pane", () => app.closePane(key)).class("panel-tab-close"));
}
/** The bottom panel: its pages' tabs and the panes docked in it, and the one shown. */
export function bottom({ app: state, cx }: Cx): El {
  const st = cx.state;
  const w = state.window;
  const docked = pages(state, "panel");
  const leaves = state.panel_leaves;
  const leaf = leaves.find((l) => truthy(l.key) && l.key === w.bottom_leaf);
  const active = leaf === undefined ? activePage(docked, w.bottom_page) : undefined;
  const height = w.bottom_height;
  const tabs = div()
    .class("panel-tabs")
    .children(
      docked.map((p) => {
        const tab = div()
          .key(word(p.id))
          .class("panel-tab")
          .when(active?.id === p.id, (e) => e.class("active"))
          .onClick(() => {
            app.selectPage(p.id, "panel");
            return true;
          })
          .onDrop((ev) => dropOnPage(ev, p, "panel", st))
          .child(icon(p.icon ?? "package"))
          .child(text(p.label));
        return dragPanel(tab, pageDrag(p), st);
      }),
    )
    .children(leaves.map((l) => panelLeafTab(l, leaf !== undefined && leaf.key === l.key)))
    .child(spacer())
    .child(iconButton("close", "Close Panel", () => app.toggle("bottom")));
  const body = leaf
    ? div()
        .key(`leaf${word(leaf.key)}`)
        .class("panel-leaf-body")
        .child(native(leaf.view).class("pane-body"))
    : pageBody(active, "panel", cx);
  return div()
    .id("bottom-panel")
    .h(px(size(st, "bottom", height)))
    .onDrop((ev) => {
      const d = dragged(ev);
      if (truthy(d.tab)) app.dockTab(d.tab!);
      else if (truthy(d.pane)) app.dockPane(d.pane!);
      else return dropOnDock(ev, "panel", st);
      return true;
    })
    .child(handle("bottom", "top", height, st))
    .child(tabs)
    .child(body);
}

