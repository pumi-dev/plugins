// `marmaide.diagram`: one diagram, in the app's colours, fitted to the pane — and then moved and
// zoomed like a canvas: drag it with the mouse, scroll the wheel over it, double-click or press
// `fit` to put it back. Click a node and a note goes with it to an agent's inbox, which the agent
// reads with the user's next message.
//
// The pane's Mermaid source lives in the option `marmaide.source` (pane-scoped), so it is what
// `marmaide.draw` writes, what the view reads when it starts, and what brings a diagram back with
// a restored layout. A redraw is a new value of it: the view hears the change and draws again.
import { div, img, input, on, option, pkg, px, text, theme, View, type El, type ViewContext } from "pumi";
import { agents, attach, type Agent } from "./agents.ts";
import { message } from "./errors.ts";
import { at as nodeAt, type Node } from "./nodes.ts";
import { picture } from "./picture.ts";

/** Room around the diagram, in points. */
const PADDING = 12;
/** How much one press of + or − changes the zoom. */
const STEP = 1.25;
/** How much one notch of the wheel does: a trackpad's many small deltas add up to the same. */
const WHEEL = 1.06;
/** A wheel's line, in pixels: the app sends a scroll as pixels. */
const LINE = 16;
/** A press that moves less than this, in points, is a click, not a drag. */
const CLICK = 4;
/** The caption row's height, in points: a fit is measured against the room above it. */
const FOOTER = 26;

/** A node the user clicked, and the note they are writing about it. */
interface Asking {
  node: number;
  /** The agents it can go to, those in this pane's tab first. */
  to: Agent[];
  at: number;
}

export class Diagram extends View<{ source?: string }> {
  private source = "";
  private kind = "";
  /** The diagram's own size, in points. */
  private size: [number, number] = [0, 0];
  /** The file the app draws, once Pele has drawn it. */
  private file: string | null = null;
  private nodes: Node[] = [];
  private error: string | null = null;
  /** 1 is fitted to the pane. */
  private zoom = 1;
  /** Points per pane point, from the last measure. */
  private fit = 1;
  /** Where the diagram's top left corner is in the pane: dragging moves it. */
  private pan: [number, number] = [0, 0];
  /** Where the pointer went down, while it is down and moving the diagram. */
  private drag: [number, number] | null = null;
  /** Where the pointer went down, to tell a click from a drag. */
  private down: [number, number] | null = null;
  private asking: Asking | null = null;
  /** What the note being written says. */
  private note = "";
  /** What asking an agent answered, when it did. */
  private said: string | null = null;
  /** Which drawing is the current one: a slower one that comes back late is dropped. */
  private drawing = 0;

  constructor(cx: ViewContext<{ source?: string }>) {
    super(cx);
    this.fit = this.fitFor(this.room());
    // The pane's own option is the truth: `draw` sets it, and a pane coming back after a restart
    // has it. What the pane was opened with is the fallback.
    void this.started();
    // The source is the pane's to change: whoever sets it, this draws it.
    cx.own(
      on("option.changed", { match: pkg.prefixed("source") }, (e) => {
        const data = e.data as { scope?: string; id?: number; new?: unknown };
        if (data.scope !== "pane" || data.id !== cx.pane.id) return;
        void this.load(typeof data.new === "string" ? data.new : "");
      }),
    );
  }

  private async started(): Promise<void> {
    let stored: unknown = null;
    try {
      stored = await option.get("source", { pane: this.cx.pane.id, scope: "pane" });
    } catch {
      // No option to read: what the pane was opened with is the diagram.
    }
    const given = typeof stored === "string" && stored.trim() !== "" ? stored : this.cx.args?.source;
    await this.load(typeof given === "string" ? given : "");
  }

  /** Draws `source`, or says why it cannot. */
  async load(source: string): Promise<void> {
    if (source === this.source && (this.file !== null || this.error !== null)) return;
    const drawing = ++this.drawing;
    this.source = source;
    this.error = null;
    this.zoom = 1;
    this.nodes = [];
    this.asking = null;
    this.said = null;
    if (source.trim() === "") {
      this.file = null;
      this.error = `no diagram yet — \`pumi call ${pkg.prefixed("draw")} '<mermaid>'\``;
      return this.cx.notify();
    }
    try {
      const drawn = await picture(source);
      if (drawing !== this.drawing) return;
      this.kind = drawn.kind;
      this.size = [drawn.width, drawn.height];
      this.file = drawn.file;
      this.nodes = drawn.nodes;
    } catch (err) {
      if (drawing !== this.drawing) return;
      this.file = null;
      this.error = `${message(err)}: ${source.split("\n")[0] ?? ""}`;
    }
    this.fit = this.fitFor(this.room());
    this.centre();
    this.cx.notify();
  }

  /** The room the diagram is fitted to: the pane, less the caption row. */
  private room(): [number, number] {
    return [this.cx.size.width, Math.max(0, this.cx.size.height - FOOTER)];
  }

  private fitFor(room: [number, number]): number {
    const [width, height] = this.size;
    if (width <= 0 || height <= 0) return 1;
    const across = Math.max(1, room[0] - PADDING * 2);
    const down = Math.max(1, room[1] - PADDING * 2);
    // A small diagram is not blown up past twice its size: it is a diagram, not a poster.
    return Math.min(2, Math.max(0.02, Math.min(across / width, down / height)));
  }

  /** What is drawn, in points. */
  private shown(): [number, number] {
    if (this.file === null) return [0, 0];
    return [this.size[0] * this.fit * this.zoom, this.size[1] * this.fit * this.zoom];
  }

  /** Puts the diagram in the middle of the pane. */
  private centre(): void {
    const [width, height] = this.shown();
    const room = this.room();
    this.pan = [(room[0] - width) / 2, (room[1] - height) / 2];
  }

  /** Zooms, keeping what is under `at` (a point in the pane) under it. */
  private zoomAt(factor: number, at?: [number, number]): void {
    const before = this.zoom;
    this.zoom = Math.min(12, Math.max(0.05, this.zoom * factor));
    if (this.zoom === before) return;
    const anchor = at ?? [this.room()[0] / 2, this.room()[1] / 2];
    const grown = this.zoom / before;
    this.pan = [anchor[0] - (anchor[0] - this.pan[0]) * grown, anchor[1] - (anchor[1] - this.pan[1]) * grown];
    this.cx.notify();
  }

  /** Back to fitted, in the middle. */
  private fitted(): void {
    this.zoom = 1;
    this.fit = this.fitFor(this.room());
    this.centre();
    this.cx.notify();
  }

  resized(): void {
    // A pane that grows or shrinks puts the diagram back in the middle of itself; one dragged off
    // centre is only off centre at the size it was dragged at.
    const room = this.room();
    this.fit = this.fitFor(room);
    this.centre();
  }

  /** The node under a point of the pane. */
  private nodeUnder(at: [number, number]): number | null {
    const scale = this.fit * this.zoom;
    if (this.file === null || scale <= 0) return null;
    return nodeAt(this.nodes, (at[0] - this.pan[0]) / scale, (at[1] - this.pan[1]) / scale);
  }

  /** A click: on a node, it asks an agent about it; anywhere else it puts the asking away. */
  private async clicked(at: [number, number]): Promise<void> {
    const node = this.nodeUnder(at);
    if (node === null) {
      this.asking = null;
      this.said = null;
      return this.cx.notify();
    }
    this.said = null;
    const to = await agents(this.cx.pane.id);
    this.asking = { node, to, at: 0 };
    this.note = "";
    if (to.length === 0) this.said = "no agent is running in a pane (with pumi's hook) to ask";
    this.cx.notify();
  }

  /** Sends the note to the agent it is addressed to. */
  private async send(): Promise<void> {
    const asking = this.asking;
    const agent = asking?.to[asking.at];
    if (!asking || !agent) return;
    const node = this.nodes[asking.node];
    if (!node) return;
    this.asking = null;
    try {
      this.said = await attach(agent, {
        pane: this.cx.pane.id,
        kind: this.kind,
        source: this.source,
        node,
        note: this.note.trim(),
      });
    } catch (err) {
      this.said = `${agent.label}: ${message(err)}`;
    }
    this.note = "";
    this.cx.notify();
  }

  private caption(): string {
    if (this.kind === "") return "marmaide";
    const [width, height] = this.size;
    return `${this.kind} · ${width.toFixed(0)}×${height.toFixed(0)} · drag to move, scroll to zoom, click a node to ask an agent`;
  }

  render(cx: ViewContext): El {
    const [width, height] = this.shown();
    const percent = `${(this.zoom * 100).toFixed(0)}%`;
    return div()
      .id("marmaide")
      .sizeFull()
      .flex()
      .flexCol()
      .child(this.canvas(width, height))
      .whenSome(this.asking, (row, asking) => row.child(this.askingRow(asking)))
      .child(this.footer(percent));
  }

  private canvas(width: number, height: number): El {
    const [x, y] = this.pan;
    return div()
      .id("marmaide-canvas")
      .flex1()
      .wFull()
      .overflowHidden()
      .css("position", "relative")
      .when(this.drag !== null, (e) => e.cursorGrabbing())
      .when(this.drag === null, (e) => e.cursorGrab())
      .onMouseDown((e) => {
        this.drag = [e.x, e.y];
        this.down = [e.x, e.y];
      })
      .onMouseMove((e) => {
        if (this.drag === null) return;
        this.pan = [this.pan[0] + e.x - this.drag[0], this.pan[1] + e.y - this.drag[1]];
        this.drag = [e.x, e.y];
        this.cx.notify();
      })
      .onMouseUp((e) => {
        this.drag = null;
        const down = this.down;
        this.down = null;
        if (down !== null && Math.hypot(e.x - down[0], e.y - down[1]) < CLICK) void this.clicked([e.x, e.y]);
        else this.cx.notify();
      })
      .onMouseLeave(() => {
        this.drag = null;
      })
      .onDoubleClick(() => this.fitted())
      .onScroll((e) => {
        const turn = e.data.dy ?? 0;
        if (turn === 0) return;
        this.zoomAt(WHEEL ** Math.min(4, Math.max(-4, turn / LINE)), [e.x, e.y]);
      })
      .whenSome(this.file, (frame, file) =>
        frame.child(
          div()
            .id("marmaide-picture")
            .css("position", "absolute")
            .left(px(x))
            .top(px(y))
            .w(px(Math.max(1, width)))
            .h(px(Math.max(1, height)))
            .child(img(file).sizeFull()),
        ),
      )
      .whenSome(this.asking === null ? null : this.nodes[this.asking.node], (frame, node) =>
        frame.child(this.ring(node)),
      )
      .whenSome(this.error, (frame, error) =>
        frame.child(
          div()
            .id("marmaide-error")
            .css("position", "absolute")
            .inset(px(0))
            .flex()
            .flexCol()
            .itemsCenter()
            .justifyCenter()
            .p4()
            .gap1()
            .child(text(error.split("\n")[0] ?? "").textSm().textColor(theme.error))
            .child(
              text(`marmaide draws Mermaid with Pele: \`pumi call ${pkg.prefixed("draw")} '<mermaid>'\`.`)
                .textXs()
                .textColor(theme.muted),
            ),
        ),
      );
  }

  /** The box around the node the user clicked. */
  private ring(node: Node): El {
    const scale = this.fit * this.zoom;
    return div()
      .id("marmaide-ring")
      .css("position", "absolute")
      .left(px(this.pan[0] + node.x * scale - 3))
      .top(px(this.pan[1] + node.y * scale - 3))
      .w(px(node.w * scale + 6))
      .h(px(node.h * scale + 6))
      .rounded(px(5))
      .border2()
      .borderColor(theme.focus_ring);
  }

  private askingRow(asking: Asking): El {
    const to = asking.to[asking.at];
    return div()
      .id("marmaide-ask")
      .flex()
      .itemsCenter()
      .gap2()
      .px2()
      .py1()
      .borderT1()
      .borderColor(theme.border)
      .child(
        div()
          .id("marmaide-to")
          .flexNone()
          .textXs()
          .textColor(theme.focus_ring)
          .when(asking.to.length > 1, (e) => e.cursorPointer())
          .onClick(() => {
            if (!this.asking) return;
            this.asking.at = (this.asking.at + 1) % Math.max(1, this.asking.to.length);
            this.cx.notify();
          })
          .child(`To ${to?.label ?? ""}${asking.to.length > 1 ? " ⇄" : ""}`),
      )
      .child(
        div()
          .id("marmaide-note")
          .flex1()
          .child(
            input(this.note)
              .placeholder(`${to ? `Ask ${to.label}` : "Ask an agent"} about “${this.nodes[asking.node]?.label ?? ""}”… (Enter sends)`)
              .autofocus()
              .onInput((e) => {
                this.note = e.value;
              })
              .onSubmit(() => void this.send()),
          ),
      )
      .child(this.control("send", "send", () => void this.send()))
      .child(
        this.control("×", "close-ask", () => {
          this.asking = null;
          this.note = "";
          this.cx.notify();
        }),
      );
  }

  private footer(percent: string): El {
    return div()
      .id("marmaide-footer")
      .flex()
      .itemsCenter()
      .justifyBetween()
      .px2()
      .py1()
      .borderT1()
      .borderColor(theme.border)
      .child(
        text(this.said ?? this.caption())
          .id("marmaide-caption")
          .textXs()
          .textColor(theme.muted),
      )
      .child(
        div()
          .flex()
          .itemsCenter()
          .gap1()
          .child(this.control("−", "zoom-out", () => this.zoomAt(1 / STEP)))
          .child(
            text(percent)
              .id("marmaide-zoom")
              .textXs()
              .textColor(theme.muted),
          )
          .child(this.control("+", "zoom-in", () => this.zoomAt(STEP)))
          .child(this.control("fit", "fit", () => this.fitted())),
      );
  }

  /** A small button of the caption row's own: pumi-ui's buttons are for forms. */
  private control(label: string, id: string, on: () => void): El {
    return div()
      .id(`marmaide-${id}`)
      .px1()
      .textXs()
      .textColor(theme.muted)
      .cursorPointer()
      .hover((s) => s.textColor(theme.surface_text))
      .onClick(() => on())
      .child(label);
  }
}
