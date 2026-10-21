// The switcher: the row of cards, the one the highlight is on, and the keys that move it. It is the
// view `switcher`, opened as a float over the whole window (`open`), so a switch from any tab of the
// session still shows it; the app's float takes the presses outside it and closes it on Escape
// (`dismiss`), so the view handles neither key nor click itself.
import {
  chord,
  div,
  FocusHandle,
  icon,
  notify,
  pane,
  preview as panePreview,
  pkg,
  px,
  ScrollHandle,
  scroll,
  text,
  theme,
  token,
  ui,
  View,
  ViewContext,
  type El,
} from "pumi";

import { cards as makeCards, kindIcon, type Card } from "./panes.ts";
import { recently } from "./recent.ts";
import { settings, type Settings, DEFAULTS } from "./settings.ts";

/** The height of one line of a card's preview. */
const LINE = 14;

/** The gap between two cards, and the strip's padding around them. */
const GAP = 10;
const PAD = 12;

/** The chords that move the highlight back, and on, as a task switcher's do. */
const PREVIOUS = new Set(["left", "up", "ctrl+p", "ctrl+k", "shift+tab", "shift+alt+tab", "ctrl+shift+tab"].map(chord));
const NEXT = new Set(["right", "down", "tab", "alt+tab", "ctrl+tab", "ctrl+n", "ctrl+j"].map(chord));

/** The switcher on screen, so the trigger pressed again moves it on instead of replacing it. */
let live: Switcher | null = null;

/** Moves the live switcher on a card, as a held Alt-Tab does: whether one was up to take it. */
export function advance(): boolean {
  if (!live) return false;
  live.advance();
  return true;
}

/** A digit chord as the card it picks (`1` is the first), for a quick pick. */
export function digit(picked: string): number | undefined {
  if (picked.length !== 1) return undefined;
  const n = Number(picked);
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : undefined;
}

/** What a card says of its pane, with what an error says. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class Switcher extends View {
  /** What it was asked to show, as it opened. */
  private asked: Settings = DEFAULTS;
  private cards: Card[] = [];
  /** The card the highlight is on. */
  private at = 0;
  /** Whether the cards have been read: an empty row before that is not the panes' answer. */
  private ready = false;
  private scroll = new ScrollHandle();
  private focus = new FocusHandle();

  constructor(cx: ViewContext) {
    super(cx);
    live = this;
    void this.load();
  }

  /** Its pane closed: the trigger opens a new one next time. */
  closed(): void {
    if (live === this) live = null;
  }

  /** Reads the panes, and puts the highlight on `keep`: the pane being switched from, or the one
   * the highlight was on. */
  async load(keep?: number): Promise<void> {
    try {
      const asked = await settings();
      const found = await makeCards(asked, recently());
      const wanted = keep ?? (await pane.current()).id;
      this.asked = asked;
      this.cards = found;
      const at = found.findIndex((card) => card.pane === wanted);
      this.at = at >= 0 ? at : Math.min(this.at, Math.max(0, found.length - 1));
      this.ready = true;
      this.reveal();
      this.cx.notify();
    } catch (err) {
      console.error(`pane-switcher: ${message(err)}`);
    }
  }

  /** The trigger pressed again while it is up: on to the next card, as a held Alt-Tab does. */
  advance(): void {
    this.step(1);
  }

  /** Puts the highlight on card `at`, as far as there are cards. */
  private go(at: number): void {
    if (this.cards.length === 0) return;
    this.at = Math.min(at, this.cards.length - 1);
    this.reveal();
    this.cx.notify();
  }

  /** Moves the highlight by `by` cards, round the ends. */
  private step(by: number): void {
    if (this.cards.length === 0) return;
    const count = this.cards.length;
    this.at = (((this.at + by) % count) + count) % count;
    this.reveal();
    this.cx.notify();
  }

  /** Scrolls the strip so the highlighted card is in sight. */
  private reveal(): void {
    const step = this.asked.cardWidth + GAP;
    const at = this.at * step;
    const seen = this.scroll.offset.x;
    const room = this.scroll.size.width;
    if (at < seen) this.scroll.scrollTo({ x: at });
    else if (room > 0 && at + this.asked.cardWidth > seen + room) {
      this.scroll.scrollTo({ x: at + this.asked.cardWidth - room });
    }
  }

  /** Goes to the highlighted pane, whichever tab it is in, and closes the switcher. */
  async commit(): Promise<void> {
    const card = this.cards[this.at];
    if (card) {
      try {
        await pane.select({ to: card.pane });
      } catch (err) {
        notify(`pane-switcher: ${message(err)}`, "error");
      }
    }
    await this.close();
  }

  /** Closes the highlighted pane (its `PaneClosePre` may refuse) and reads the rest again. */
  async closeCard(): Promise<void> {
    const card = this.cards[this.at];
    if (!card) return;
    try {
      await pane.close(card.pane);
    } catch (err) {
      notify(`pane-switcher: ${message(err)}`, "error");
    }
    await this.load(card.pane);
    if (this.cards.length === 0) await this.close();
  }

  /** Closes the float itself: a pane picked, or nothing left to pick. */
  async close(): Promise<void> {
    try {
      await pane.close(this.cx.pane.id, true);
    } catch {
      // It is going anyway.
    }
  }

  /** A key the switcher answers: whether it took it, so nothing behind it acts on it too. */
  keyed(typed: string): boolean {
    const key = chord(typed);
    if (key === "enter" || key === "return") void this.commit();
    else if (PREVIOUS.has(key)) this.step(-1);
    else if (NEXT.has(key)) this.step(1);
    else if (key === "home") this.go(0);
    else if (key === "end") this.go(Number.MAX_SAFE_INTEGER);
    else if (key === "x") void this.closeCard();
    else {
      const picked = digit(key);
      if (picked === undefined) return false;
      this.go(picked);
    }
    return true;
  }

  render(): El {
    const count = this.cards.length;
    // The cards sit in the middle of the float while they fit in it, and start at its left edge
    // when they have to scroll: centring them as they overflow would clip the first ones.
    const fits = count * this.asked.cardWidth + Math.max(0, count - 1) * GAP + 2 * PAD <= this.cx.size.width;
    return div()
      .id("switcher")
      .class("pane-switcher")
      .sizeFull()
      .flex()
      .flexCol()
      .bg(theme.surface)
      .trackFocus(this.focus)
      .autofocus()
      .onKey((e) => this.keyed(e.key))
      .child(
        div()
          .flex()
          .flexNone()
          .itemsCenter()
          .gap(px(8))
          .px(px(14))
          .pt(px(10))
          .pb(px(6))
          .textSize(12)
          .child(icon("blocks").flexNone().w(px(12)).h(px(12)).textColor(theme.placeholder))
          .child(text("Switch pane").flexNone().textColor(theme.text).fontWeight(500))
          .child(text(String(count)).flexNone().textColor(theme.placeholder))
          .child(div().flex1())
          .child(text("← → choose · enter go · esc close").flexNone().textColor(theme.placeholder)),
      )
      .child(
        scroll()
          .id("strip")
          .flex()
          .itemsCenter()
          .flex1()
          .minH(px(0))
          .px(px(PAD))
          .pb(px(PAD))
          .gap(px(GAP))
          .css("overflow-x", "scroll")
          .css("overflow-y", "hidden")
          .track(this.scroll)
          .when(fits, (strip) => strip.justifyCenter())
          .children(count > 0 ? this.cards.map((card, i) => this.card(card, i)) : this.ready ? [this.empty()] : []),
      );
  }

  /** Nothing to switch to: the scope found no panes. */
  private empty(): El {
    return div()
      .flex()
      .flex1()
      .itemsCenter()
      .justifyCenter()
      .child(text("No panes to switch to").textSize(12).textColor(theme.muted));
  }

  /** One card: its pane's screen above, its title and detail below. */
  private card(card: Card, i: number): El {
    const selected = i === this.at;
    return div()
      .id(`card-${i}`)
      .class("card")
      .flex()
      .flexCol()
      .flexNone()
      .w(px(this.asked.cardWidth))
      .roundedLg()
      .overflowHidden()
      .border1()
      .borderColor(selected ? theme.primary : theme.border)
      .bg(selected ? theme.hover : theme.bg)
      .cursorPointer()
      .when(!selected, (el) => el.hover((s) => s.bg(theme.accent)))
      .onMouseEnter(() => {
        if (this.at === i) return;
        this.at = i;
        this.reveal();
        this.cx.notify();
      })
      .onClick(() => {
        this.go(i);
        void this.commit();
      })
      .child(this.screen(card))
      .child(this.footer(card, selected));
  }

  /** What the pane holds: the app's own screen of it, scaled to the box, or (with `preview` off,
   * and for the cards past the first `MAX_PREVIEWS`) the icon that says what it is. */
  private screen(card: Card): El {
    const room = div().flexNone().h(px(this.asked.rows * LINE));
    if (card.preview) return room.overflowHidden().child(panePreview(card.pane).sizeFull());
    return room
      .flex()
      .itemsCenter()
      .justifyCenter()
      .child(icon(kindIcon(card.kind)).w(px(28)).h(px(28)).textColor(token("muted", 0.35)));
  }

  /** The pane's title, its agent's state, and where it is. */
  private footer(card: Card, selected: boolean): El {
    const foreground = selected ? theme.text : theme.muted;
    return div()
      .flex()
      .flexCol()
      .flexNone()
      .gap(px(1))
      .px(px(10))
      .pt(px(5))
      .pb(px(6))
      .borderT1()
      .borderColor(token("border", 0.55))
      .child(
        div()
          .flex()
          .flexNone()
          .itemsCenter()
          .gap(px(7))
          .child(icon(kindIcon(card.kind)).flexNone().w(px(12)).h(px(12)).textColor(foreground))
          .child(text(card.title).flex1().truncate().textSize(12).fontWeight(500).textColor(foreground))
          .when(card.status !== "", (row) => row.child(ui.stateMark(card.status, { marks: "icons", size: 12 }))),
      )
      .when(card.detail !== "", (footer) =>
        footer.child(
          text(card.detail).flexNone().h(px(13)).truncate().textSize(11).textColor(token("muted", selected ? 0.85 : 0.6)),
        ),
      );
  }
}

/** Opens the switcher over the window, on the panes its scope asks for: `false` when it could not
 * open it. Any switcher already up is replaced, not moved on (that is the trigger's doing). */
export async function open(): Promise<boolean> {
  try {
    for (const others of (await pane.list({ type: pkg.prefixed("switcher") })) as { close(force?: boolean): Promise<null> }[]) {
      await others.close(true);
    }
    const asked = await settings();
    await pane.open(pkg.prefixed("switcher"), {}, place(asked));
    return true;
  } catch (err) {
    notify(`pane-switcher: ${message(err)}`, "error");
    return false;
  }
}

/** Where its float goes: over the whole window, whichever tab of the session shows, so a switch
 * from another tab still shows it; centred by its anchor, dimming what is under it by `backdrop`,
 * and closed by the app on Escape or a press outside it (`dismiss`). `focus: false`: the switcher
 * must not become the pane it is switching from. */
export function place(asked: Settings): Record<string, unknown> {
  return {
    kind: "float",
    relative: "client",
    anchor: "center",
    width: `${asked.width}%`,
    height: asked.height,
    backdrop: asked.backdrop,
    dismiss: ["escape", "press"],
    zindex: 70,
    focus: false,
  };
}
