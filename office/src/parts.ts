// The default theme's helpers, taken from pumi's examples/default-theme (themes/classic/parts.ts)
// and cut down to what the office and its overlays use. They go away when themes can
// `extends: default`.
import { div, icon, native, px, text, type AppPage, type AppState, type El, type ElementEvent, type ThemeContext } from "pumi";

/** What the overlays keep between renders: the highlighted menu row (1-based) and its menu. */
export interface MenuState {
  menuHl: number | null;
  menuFor: string;
}
/** What every part of the window is drawn from: `app`, and the theme's context (its state). */
export interface Cx<S extends MenuState = MenuState> {
  app: AppState;
  cx: ThemeContext<S>;
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
/** A number of the event's (`wx`, `dx`), 0 without it. */
export const num = (e: ElementEvent, field: "x" | "y" | "wx" | "wy" | "ox" | "oy" | "dx" | "dy"): number => e.data[field] ?? 0;

/** The page called `wanted`, or the first. */
export const activePage = (pages: AppPage[], wanted: unknown): AppPage | undefined => pages.find((p) => p.id === wanted) ?? pages[0];

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
