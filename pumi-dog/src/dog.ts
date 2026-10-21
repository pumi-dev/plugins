// The dog in the status bar: its view, one canvas of the current frame, and the timer that steps it.
import { canvas, div, on, pkg, px, token, View, type El, type ViewContext } from "pumi";
import { current, DEFAULTS, interval, scale, width, type Settings } from "./settings.ts";
import { paint } from "./sprite.ts";
import { bark, barking, born, seeded, step, type Walker } from "./walker.ts";

/** The dogs on screen, for `bark` to reach: there is one, in the status bar. */
const open = new Set<Dog>();

/** Every dog on screen barks. */
export function barkAll(): void {
  for (const dog of open) dog.say();
}

/** The dog's pane, drawn by this: a canvas of the frame it is in, at the spot on its track it has
 * walked to. */
export class Dog extends View {
  private walker: Walker = born();
  private settings: Settings = DEFAULTS;
  private rng = seeded();
  private alive = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(cx: ViewContext) {
    super(cx);
    open.add(this);
    // Undone when the pane closes, or the package stops.
    cx.own(() => {
      this.alive = false;
      open.delete(this);
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    });
    // Its options, followed as they change.
    cx.own(
      on(
        "option.changed",
        { match: [pkg.prefixed("speed"), pkg.prefixed("track"), pkg.prefixed("size")], desc: "pumi-dog's options" },
        () => void this.reload(),
      ),
    );
    void this.reload();
    this.next();
  }

  /** Barks, as a click on the dog does. */
  say(): void {
    this.walker = bark(this.walker);
    this.cx.notify();
  }

  /** Reads its options again, and draws the dog as they now say. */
  private async reload(): Promise<void> {
    try {
      this.settings = await current();
    } catch (err) {
      console.error("pumi-dog: reading its options:", err);
    }
    this.cx.notify();
  }

  /** One step every frame interval, for as long as the dog is on screen. The interval is read each
   * time, so a change of `speed` is felt at the next frame. */
  private next(): void {
    if (!this.alive) return;
    this.timer = setTimeout(() => {
      this.walker = step(this.walker, this.settings, this.rng);
      this.cx.notify();
      this.next();
    }, interval(this.settings));
  }

  render(): El {
    const s = this.settings;
    const dog = this.walker;
    return div()
      .sizeFull()
      .flex()
      .itemsCenter()
      .justifyEnd()
      .child(
        div()
          .id("pumi-dog")
          .class("pumi-dog")
          .css("position", "relative")
          .flexShrink0()
          .w(px(s.track))
          .h(px(s.height))
          .cursorPointer()
          .onClick(() => this.say())
          .child(
            canvas(paint(dog.pose, dog.left, scale(s)))
              .id("frame")
              .css("position", "absolute")
              .top(px(0))
              .left(px(dog.x))
              .w(px(width(s)))
              .h(px(s.height)),
          )
          .child(this.bubble(s)),
      );
  }

  /** `woof!`, while it barks: on the side it faces, unless that runs off the track. */
  private bubble(s: Settings): El | null {
    const { x, left } = this.walker;
    if (!barking(this.walker)) return null;
    const roomRight = s.track - (x + width(s));
    const atRight = (!left && roomRight >= 40) || (left && x < 40);
    return div()
      .id("woof")
      .css("position", "absolute")
      .top(px(0))
      .left(px(atRight ? x + width(s) : Math.max(x - 40, 0)))
      .px(4)
      .roundedSm()
      .bg(token("palette.surface0"))
      .textColor(token("palette.mauve"))
      .textXs()
      .whitespaceNowrap()
      .child("woof!");
  }
}
