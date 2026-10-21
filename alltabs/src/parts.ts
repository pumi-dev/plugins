// Copied from pumi's default theme (`runtime/bun/examples/default-theme/themes/classic/parts.ts`),
// unedited: alltabs is the default theme with its tab row's grouping changed (`header.ts`), and
// draws every other part as the default does. A stopgap until the SDK grows `extends` or a shared
// default window.
//
// What every region of the window uses: `app` read as the Rust default theme reads it (a missing
// field is nothing, and `null` and `false` are false), and the parts it draws everywhere.
// src/ui/shell/default_theme/mod.rs is what this ports.
import { app, div, icon, input, native, px, text, type AppPage, type AppState, type AppTab, type El, type ElementEvent, type ThemeContext } from "pumi";

/** What the theme keeps between renders while a drag or a menu is under way. */
export interface State {
  /** What a dock page or section being dragged carries (`{page, keys}`). */
  dragging: Drag | null;
  /** A dock's size while its edge is dragged, by `sidebar`, `secondary` or `bottom`. */
  sizes: Record<string, number>;
  /** A divider's ratio while it is dragged, by its path. */
  ratios: Record<string, number>;
  /** Two sections' weights while the edge between them is dragged. */
  sectionSizes: Record<string, number>;
  split: Split | null;
  /** The highlighted menu row (1-based) and the menu it is in. */
  menuHl: number | null;
  menuFor: string;
}
/** What a page or sections being dragged carry. */
export interface Drag {
  page?: string | null;
  keys?: string[];
  tab?: number;
  pane?: string;
}
/** The edge between two sections, being dragged. */
export interface Split {
  up: string;
  down: string;
  top: number;
  pair: number;
  weight: number;
  dy: number;
}
export const fresh = (): State => ({ dragging: null, sizes: {}, ratios: {}, sectionSizes: {}, split: null, menuHl: null, menuFor: "" });

/** What every part is drawn from: `app`, and the theme's context (its state, the layout). */
export interface Cx {
  app: AppState;
  cx: ThemeContext<State>;
}

type Bag = Record<string, unknown> | null | undefined;
export const truthy = (v: unknown): boolean => v !== null && v !== undefined && v !== false;
/** A string field, empty when it is not one. */
export const s = (v: unknown, key: string): string => {
  const x = (v as Bag)?.[key];
  return typeof x === "string" ? x : "";
};
/** A string field, if it is one (an empty string too). */
export const opt = (v: unknown, key: string): string | undefined => {
  const x = (v as Bag)?.[key];
  return typeof x === "string" ? x : undefined;
};
export const b = (v: unknown, key: string): boolean => truthy((v as Bag)?.[key]);
export const f = (v: unknown, key: string): number => {
  const x = (v as Bag)?.[key];
  return typeof x === "number" ? x : 0;
};
export function list<T = any>(v: unknown, key: string): T[] {
  const x = (v as Bag)?.[key];
  return Array.isArray(x) ? (x as T[]) : [];
}
/** A field as text, numbers too (`'tab' .. tab.id`). */
export const word = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
/** `string.format('%.4f%%', v * 100)`. */
export const pct = (v: number): string => `${(v * 100).toFixed(4)}%`;
/** What a dragged node carries, as the theme reads it. */
export const dragged = (e: ElementEvent): Drag => ((e.dragged ?? {}) as Drag);
/** A number of the event's (`wx`, `dx`), 0 without it. */
export const num = (e: ElementEvent, field: "x" | "y" | "wx" | "wy" | "ox" | "oy" | "dx" | "dy"): number => e.data[field] ?? 0;

/** The pages docked at `dock` (`primary`, `secondary`, `panel`). */
export const pages = (app: AppState, dock: string): AppPage[] => app.pages.filter((p) => p.dock === dock);
/** The page called `wanted`, or the first. */
export const activePage = (pages: AppPage[], wanted: unknown): AppPage | undefined => pages.find((p) => p.id === wanted) ?? pages[0];
export const activeTab = (app: AppState): AppTab | undefined => app.tabs.find((t) => t.active);

export const spacer = (): El => div().class("spacer");
export const dot = (status: string): El => div().class("dot").when(status !== "", (e) => e.class(`status-${status}`));
/** An icon that is a button: a press runs `click`, and stops there. */
export const iconButton = (name: string, title: string, click: (e: ElementEvent) => void): El =>
  div()
    .class("icon-button")
    .title(title)
    .onClick((e) => {
      click(e);
      return true;
    })
    .child(icon(name));
/** A name edited in place (`app.renaming`): Enter or a press elsewhere ends it, renaming only when
 * the name changed; Escape (the app's) leaves it as it was. */
export function renameField(cls: string, value: string, rename: (to: string) => void): El {
  const done = (e: ElementEvent) => {
    if (e.value !== value) rename(e.value);
    else app.finishRename();
    return true;
  };
  return input(value).class(cls).focusable().onSubmit(done).onBlur(done);
}
/** The panes the app lists in a slot, each the view its plugin draws. */
export const slot = (state: AppState, name: string, cls: string): El[] =>
  list(state.slots, name).map((v) => ownedView(v, `slot-view ${cls}`));
/** A pane a plugin draws, at its own width if it has one. */
export const ownedView = (v: unknown, cls: string): El =>
  native(s(v, "view"))
    .key(word((v as Bag)?.pane))
    .class(cls)
    .whenSome(typeof (v as Bag)?.width === "number" ? ((v as Bag)!.width as number) : undefined, (e, w) => e.w(px(w)));
export const label = (cls: string, t: string): El => text(t).class(cls);
