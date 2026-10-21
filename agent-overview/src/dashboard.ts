// The dashboard: a rail of the sessions and their agents, and the overview beside it — what is
// working, what is waiting for the user, and where each one is. The rail narrows the table (a
// filter and a search); a row picks an agent, a second press goes to its pane.
import {
  chord,
  div,
  icon,
  input,
  list,
  notify,
  on,
  option,
  pane,
  pkg,
  px,
  relative,
  scroll,
  theme,
  token,
  ui,
  View,
  type Color,
  type El,
  type ElementEvent,
  type ViewContext,
  FocusHandle,
  ScrollHandle,
} from "pumi";

import { folder, path, place, Overview, read, type Agent } from "./overview.ts";
import { FILTERS, filterLabel, needsYou, statusLabel, STATUSES, type Filter, type Status } from "./status.ts";

/** A rail row's height, in pixels: a session's heading and an agent's row are both one row. */
const ROW = 26;

/** The icon a filter's row in the rail leads with. */
const FILTER_ICONS: Record<Filter, string> = {
  all: "blocks",
  "needs-you": "status-alert",
  working: "status-spinner",
  idle: "status-ring",
};

/** The theme token a status is drawn in. */
const TINTS: Record<Status, string> = {
  blocked: "warning",
  error: "error",
  working: "primary",
  done: "success",
  idle: "muted",
  unknown: "muted",
};

/** The tint a status is drawn in: the theme's, never a literal; the quiet ones faint. */
function tint(status: Status, alpha?: number): Color {
  const quiet = status === "idle" || status === "unknown";
  return token(TINTS[status], alpha ?? (quiet ? 0.55 : undefined));
}

/** A dot of a status, the shape the marks setting asks for. */
function dot(status: Status, size: number): El {
  return ui.stateMark(status, { marks: "dots", size });
}

/** A section's heading: its name, its count, and room for a legend. */
function heading(title: string, count: number | string, extra?: El): El {
  return div()
    .flex()
    .flexRow()
    .flexNone()
    .gap(px(8))
    .textSize(12)
    .textColor(theme.surface_text)
    .fontWeight(600)
    .child(title)
    .child(div().textSize(11).textColor(theme.muted).child(String(count)))
    .child(extra ?? div().flex1());
}

/** A thin bar filled to `fraction`. */
function bar(fraction: number, tinted: Color): El {
  return div()
    .h(px(3))
    .wFull()
    .roundedFull()
    .bg(theme.element)
    .child(div().hFull().w(relative(Math.min(Math.max(fraction, 0), 1))).roundedFull().bg(tinted));
}

/** The last time it read the model, as the bar says it: `elapsed` in milliseconds. */
export function since(elapsed: number): string {
  const seconds = Math.floor(elapsed / 1000);
  if (seconds <= 4) return "updated just now";
  if (seconds <= 59) return `updated ${seconds}s ago`;
  return `updated ${Math.floor(seconds / 60)}m ago`;
}

/** A line of the rail: a session's heading, one of its agents, or why there is nothing. */
type Line =
  | { kind: "session"; session: number; name: string; count: number }
  | { kind: "agent"; agent: Agent }
  | { kind: "empty"; text: string };

/** The dashboard's pane: the view `overview` in the manifest. */
export class Dashboard extends View {
  private overview = new Overview();
  private filter: Filter = "all";
  /** The agent picked: its row is highlighted and the bar under the table offers its pane. */
  private selected: number | null = null;
  private query = "";
  private readonly focus = new FocusHandle();
  private readonly scroll = new ScrollHandle();
  private readonly rail = new ScrollHandle();
  private refreshed = Date.now();
  private poll = 15;
  private railWidth = 248;
  private hideIdle = false;

  constructor(cx: ViewContext) {
    super(cx);
    // The overview follows the agents: one says what it is doing, a pane or a tab opens or
    // closes, the session in front moves, and its own options change.
    cx.own(
      on(
        ["pane.opened", "pane.closed", "pane.focused", "tab.opened", "tab.closed", "session.created", "session.closed", "session.focused"],
        { desc: "the agent overview follows the agents" },
        () => void this.refresh(),
      ),
    );
    cx.own(
      on(
        "option.changed",
        { match: ["@agent*", "@program_status", `${pkg.prefix}*`], desc: "the agent overview follows the agents" },
        () => void this.refresh(),
      ),
    );
    void this.refresh();
    // One tick a second: the "updated" line ages, and the model is read again on its poll.
    const timer = setInterval(() => {
      cx.notify();
      if (Date.now() - this.refreshed >= this.poll * 1000) void this.refresh();
    }, 1000);
    timer.unref?.();
    cx.own(() => clearInterval(timer));
  }

  /** Its options, read when it opens and when one changes. */
  private async settings(): Promise<void> {
    const number = async (key: string, fallback: number, min: number, max: number): Promise<number> => {
      const value = await option.get(key);
      return typeof value === "number" ? Math.min(Math.max(value, min), max) : fallback;
    };
    this.poll = Math.trunc(await number("poll_secs", 15, 2, 600));
    this.railWidth = await number("rail_width", 248, 180, 380);
    this.hideIdle = (await option.get("hide_idle")) === true;
  }

  /** Reads the agents again; keeps the selection when its agent is still there. */
  private async refresh(): Promise<void> {
    await this.settings();
    try {
      const found = await read();
      const agents = this.hideIdle ? found.agents.filter((agent) => agent.status !== "idle" || agent.here) : found.agents;
      this.overview = new Overview(agents, found.currentPane);
    } catch (err) {
      console.error("agent-overview:", err instanceof Error ? err.message : err);
    }
    this.refreshed = Date.now();
    if (this.selected !== null && !this.overview.agents.some((agent) => agent.pane === this.selected)) this.selected = null;
    this.cx.notify();
  }

  private visible(): Agent[] {
    return this.overview.visible(this.filter, this.query);
  }

  private select(at: number): void {
    this.selected = at;
    const line = this.lines().findIndex((each) => each.kind === "agent" && each.agent.pane === at);
    if (line >= 0) this.rail.scrollToRow(line);
    this.cx.notify();
  }

  /** Move the highlight up or down the visible agents. */
  private step(by: number): void {
    const agents = this.visible();
    if (agents.length === 0) return;
    const at = this.selected === null ? undefined : agents.findIndex((agent) => agent.pane === this.selected);
    const next = at === undefined || at < 0 ? 0 : (((at + by) % agents.length) + agents.length) % agents.length;
    this.select(agents[next]!.pane);
  }

  /** Go to the agent's pane: what the dashboard is a dashboard for. */
  private async jump(at: number): Promise<void> {
    try {
      await pane.select({ to: at });
    } catch (err) {
      await notify(`agent overview: ${err instanceof Error ? err.message : err}`, "error");
      return;
    }
    // The user is looking at it now: what the program left for them goes.
    await pane.markSeen(at).catch(() => undefined);
  }

  private selectedAgent(): Agent | undefined {
    return this.overview.agents.find((agent) => agent.pane === this.selected);
  }

  /** A press on a row: pick the agent, and a second press on one picked goes to its pane. */
  private hit(at: number, event: ElementEvent): void {
    if ((event.data.clicks ?? 1) >= 2) void this.jump(at);
    else this.select(at);
  }

  /** The keys the dashboard takes, wherever the keyboard is in it. Whether it took the key. */
  private key(event: ElementEvent): boolean {
    const typed = chord(event.key);
    if (typed === "down" || typed === "ctrl+n" || typed === "ctrl+j") {
      this.step(1);
      return true;
    }
    if (typed === "up" || typed === "ctrl+p" || typed === "ctrl+k") {
      this.step(-1);
      return true;
    }
    if (typed === "enter" || typed === "return") {
      const target = this.selected ?? this.visible()[0]?.pane;
      if (target !== undefined) void this.jump(target);
      return true;
    }
    if (typed === "escape" && this.selected !== null) {
      this.selected = null;
      this.cx.notify();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ drawing

  render(): El {
    return div()
      .id("agent-overview")
      .class("agent-overview")
      .flex()
      .flexCol()
      .sizeFull()
      .overflowHidden()
      .textSize(12)
      .textColor(theme.surface_text)
      .trackFocus(this.focus)
      .onKey((event) => this.key(event))
      .child(div().flex().flexRow().flex1().minH0().child(this.railView()).child(this.main()))
      .child(this.detailBar());
  }

  /** The rail's rows: each session's heading, then its agents; or why there is nothing. */
  private lines(): Line[] {
    const lines: Line[] = [];
    for (const group of this.overview.groups(this.filter, this.query)) {
      lines.push({ kind: "session", session: group.session, name: group.name, count: group.agents.length });
      for (const agent of group.agents) lines.push({ kind: "agent", agent });
    }
    if (lines.length === 0) {
      lines.push({ kind: "empty", text: this.query === "" ? "No agents report yet" : `Nothing matches “${this.query}”` });
    }
    return lines;
  }

  private railView(): El {
    return div()
      .flex()
      .flexCol()
      .flexNone()
      .w(px(this.railWidth))
      .hFull()
      .borderR1()
      .borderColor(token("border", 0.55))
      .child(
        div()
          .flex()
          .flexRow()
          .flexNone()
          .gap(px(8))
          .px(px(14))
          .pt(px(14))
          .pb(px(10))
          .child(icon("blocks").flexNone().size(px(16)).textColor(theme.surface_text))
          .child(div().flex1().truncate().textSize(13).textColor(theme.surface_text).fontWeight(600).child("Agent overview")),
      )
      .child(div().flex().flexCol().flexNone().gap1().px(px(6)).children(FILTERS.map((filter) => this.navRow(filter))))
      .child(
        div()
          .flexNone()
          .px(px(8))
          .pt(px(8))
          .pb(px(4))
          .child(
            input(this.query)
              .id("agent-overview-search")
              .placeholder("Filter agents")
              .autofocus()
              .onInput((event) => {
                this.query = event.value;
                this.cx.notify();
              }),
          ),
      )
      .child(
        list({ rows: this.lines().length, rowHeight: ROW, render: (at) => this.railLine(this.lines()[at]!) })
          .id("agent-overview-rail")
          .flex1()
          .minH0()
          .pb(px(8))
          .track(this.rail),
      )
      .child(
        div()
          .flexNone()
          .px(px(12))
          .py(px(8))
          .borderT1()
          .borderColor(token("border", 0.55))
          .textSize(10.5)
          .textColor(theme.muted)
          .child(`${this.overview.total()} agents · ${this.overview.sessions()} sessions`),
      );
  }

  private railLine(line: Line): El {
    if (line.kind === "session") {
      return div()
        .id(`agent-overview-session-${line.session}`)
        .flex()
        .flexRow()
        .flexNone()
        .gap(px(6))
        .h(px(ROW))
        .px(px(10))
        .pt(px(6))
        .textSize(10.5)
        .textColor(theme.muted)
        .fontWeight(500)
        .child(div().flex1().truncate().child(line.name.toUpperCase()))
        .child(div().flexNone().child(String(line.count)));
    }
    if (line.kind === "agent") return this.railRow(line.agent);
    return div().px(px(12)).py(px(10)).textSize(11).textColor(theme.muted).child(line.text);
  }

  private navRow(filter: Filter): El {
    const on = this.filter === filter;
    const count =
      filter === "all"
        ? this.overview.total()
        : filter === "needs-you"
          ? this.overview.needsYou()
          : filter === "working"
            ? this.overview.count("working")
            : this.overview.count("idle") + this.overview.count("done");
    return div()
      .id(`agent-overview-nav-${filter}`)
      .class("agent-overview-nav")
      .flex()
      .flexRow()
      .flexNone()
      .gap(px(8))
      .h(px(28))
      .px(px(8))
      .roundedMd()
      .when(on, (row) => row.bg(theme.hover))
      .when(!on, (row) => row.hover((style) => style.bg(token("hover", 0.5))))
      .cursorPointer()
      .onClick(() => {
        this.filter = filter;
        this.selected = null;
        this.scroll.scrollToTop();
        this.cx.notify();
      })
      .child(icon(FILTER_ICONS[filter]).flexNone().size(px(12)).textColor(on ? theme.surface_text : theme.muted))
      .child(
        div()
          .flex1()
          .truncate()
          .textSize(12)
          .textColor(on ? theme.surface_text : theme.muted)
          .child(filterLabel(filter)),
      )
      .child(div().flexNone().textSize(10.5).textColor(theme.muted).child(String(count)));
  }

  private railRow(agent: Agent): El {
    const picked = this.selected === agent.pane;
    const id = `agent-overview-rail-${agent.pane}`;
    return div()
      .id(id)
      .class("agent-overview-agent")
      .flex()
      .flexRow()
      .flexNone()
      .gap(px(7))
      .h(px(ROW))
      .pl(px(18))
      .pr(px(10))
      .roundedMd()
      .when(picked, (row) => row.bg(theme.hover))
      .when(!picked, (row) => row.hover((style) => style.bg(token("hover", 0.45))))
      .cursorPointer()
      .onClick((event) => this.hit(agent.pane, event))
      .child(dot(agent.status, 8).id(`${id}-dot`))
      .child(div().flexNone().textSize(11.5).textColor(picked ? theme.surface_text : theme.muted).child(agent.kind))
      .child(div().flex1().truncate().textSize(10.5).textColor(theme.placeholder).child(folder(agent)))
      .when(agent.here, (row) =>
        row.child(div().flexNone().textSize(9.5).textColor(theme.placeholder).child("you")),
      );
  }

  private topBar(): El {
    return div()
      .flex()
      .flexRow()
      .flexNone()
      .gap(px(6))
      .h(px(42))
      .px(px(16))
      .borderB1()
      .borderColor(token("border", 0.55))
      .child(div().textSize(11.5).textColor(theme.muted).child("Agents"))
      .child(icon("chevron-right").flexNone().size(px(10)).textColor(theme.placeholder))
      .child(div().textSize(11.5).textColor(theme.surface_text).child(filterLabel(this.filter)))
      .child(div().flex1())
      .child(div().textSize(11).textColor(theme.muted).child(since(Date.now() - this.refreshed)))
      .child(
        ui
          .button("Refresh", { variant: "primary" })
          .id("agent-overview-refresh")
          .onClick(() => void this.refresh()),
      );
  }

  private card(title: string, count: number, of: number, caption: string, status: Status): El {
    return div()
      .flex()
      .flexCol()
      .flex1()
      .minW(px(120))
      .gap(px(6))
      .p(px(12))
      .roundedLg()
      .border1()
      .borderColor(token("border", 0.7))
      .child(
        div()
          .flex()
          .flexRow()
          .gap(px(6))
          .child(dot(status, 8).id(`agent-overview-card-${title.toLowerCase().replaceAll(" ", "-")}`))
          .child(div().textSize(11).textColor(theme.muted).child(title)),
      )
      .child(div().textSize(24).textColor(theme.surface_text).fontWeight(600).child(String(count)))
      .child(bar(of === 0 ? 0 : count / of, tint(status)))
      .child(div().textSize(10.5).textColor(theme.muted).child(caption));
  }

  private alert(agent: Agent): El {
    return div()
      .id(`agent-overview-alert-${agent.pane}`)
      .class("agent-overview-alert")
      .flex()
      .flexCol()
      .flexNone()
      .gap(px(3))
      .px(px(12))
      .py(px(9))
      .roundedMd()
      .border1()
      .borderColor(tint(agent.status, 0.4))
      .bg(tint(agent.status, 0.06))
      .child(
        div()
          .flex()
          .flexRow()
          .gap(px(7))
          .child(icon(agent.status === "error" ? "status-x" : "warning").flexNone().size(px(12)).textColor(tint(agent.status)))
          .child(div().textSize(12).textColor(theme.surface_text).fontWeight(500).child(`${agent.kind} ${agent.why}`))
          .child(div().flex1())
          .child(div().textSize(10.5).textColor(theme.muted).child(place(agent))),
      )
      .child(
        div()
          .pl(px(21))
          .truncate()
          .textSize(11)
          .textColor(theme.muted)
          .child(agent.message === "" ? path(agent) : agent.message),
      );
  }

  private column(title: string, count: number, rows: El[]): El {
    return div()
      .flex()
      .flexCol()
      .flex1()
      .minW(px(180))
      .gap(px(6))
      .child(heading(title, count))
      .child(
        div()
          .flex()
          .flexCol()
          .roundedLg()
          .border1()
          .borderColor(token("border", 0.7))
          .when(rows.length === 0, (box) =>
            box
              .px(px(12))
              .py(px(12))
              .child(
                div()
                  .textSize(11)
                  .textColor(theme.muted)
                  .child(title.startsWith("Working") ? "Nothing is working right now." : "Nothing is waiting for you."),
              ),
          )
          .children(rows),
      );
  }

  /** One agent in the two columns under the cards: who, where, and what it says. */
  private brief(agent: Agent, show: string): El {
    return div()
      .id(`agent-overview-brief-${agent.pane}`)
      .flex()
      .flexRow()
      .flexNone()
      .gap(px(8))
      .h(px(28))
      .px(px(10))
      .borderT1()
      .borderColor(token("border", 0.4))
      .child(dot(agent.status, 7).id(`agent-overview-brief-${agent.pane}-dot`))
      .child(div().flexNone().textSize(11.5).textColor(theme.surface_text).child(agent.kind))
      .child(
        div()
          .flex1()
          .truncate()
          .textSize(11)
          .textColor(theme.muted)
          .child(show === "" ? place(agent) : show),
      )
      .child(div().flexNone().textSize(10.5).textColor(theme.placeholder).child(folder(agent)));
  }

  private table(agents: Agent[]): El {
    const cell = (said: string, size: number) =>
      div().flex1().truncate().textSize(size).textColor(theme.muted).child(said);
    const header = (said: string) => div().truncate().textSize(10).textColor(theme.muted).fontWeight(500).child(said);
    const rows = agents.map((agent) => {
      const picked = this.selected === agent.pane;
      return div()
        .id(`agent-overview-row-${agent.pane}`)
        .class("agent-overview-row")
        .flex()
        .flexRow()
        .flexNone()
        .gap(px(8))
        .h(px(32))
        .px(px(10))
        .borderT1()
        .borderColor(token("border", 0.4))
        .when(picked, (row) => row.bg(theme.hover))
        .when(!picked, (row) => row.hover((style) => style.bg(token("hover", 0.45))))
        .cursorPointer()
        .onClick((event) => this.hit(agent.pane, event))
        .child(div().flexNone().w(px(10)).child(dot(agent.status, 8).id(`agent-overview-row-${agent.pane}-dot`)))
        .child(
          div()
            .flex()
            .flexRow()
            .gap(px(6))
            .w(px(120))
            .flexNone()
            .child(icon("agent").flexNone().size(px(12)).textColor(theme.muted))
            .child(
              div()
                .flex1()
                .truncate()
                .textSize(11.5)
                .textColor(theme.surface_text)
                .fontWeight(500)
                .child(agent.kind),
            ),
        )
        .child(
          div()
            .flexNone()
            .w(px(74))
            .textSize(11)
            .textColor(tint(agent.status))
            .child(agent.why === "" ? statusLabel(agent.status) : agent.why),
        )
        .child(div().flexNone().w(px(150)).child(cell(place(agent), 11)))
        .child(div().flex1().minW(px(80)).child(cell(path(agent), 11)))
        .child(div().flexNone().w(px(110)).child(cell(agent.command, 11)))
        .child(div().flexNone().w(px(16)).child(icon("chevron-right").flexNone().size(px(12)).textColor(theme.placeholder)));
    });
    return div()
      .flex()
      .flexCol()
      .flexNone()
      .roundedLg()
      .border1()
      .borderColor(token("border", 0.7))
      .overflowHidden()
      .child(
        div()
          .flex()
          .flexRow()
          .flexNone()
          .gap(px(8))
          .h(px(28))
          .px(px(10))
          .bg(token("surface", 0.35))
          .child(div().flexNone().w(px(10)))
          .child(div().w(px(120)).flexNone().child(header("AGENT")))
          .child(div().flexNone().w(px(74)).child(header("STATUS")))
          .child(div().flexNone().w(px(150)).child(header("SESSION")))
          .child(div().flex1().minW(px(80)).child(header("DIRECTORY")))
          .child(div().flexNone().w(px(110)).child(header("PROGRAM")))
          .child(div().flexNone().w(px(16))),
      )
      .children(rows);
  }

  private legend(): El {
    return div()
      .flex()
      .flexRow()
      .flexNone()
      .gap(px(10))
      .children(
        STATUSES.map((status) =>
          div()
            .flex()
            .flexRow()
            .gap(px(4))
            .child(dot(status, 6).id(`agent-overview-legend-${status}`))
            .child(div().textSize(10).textColor(theme.muted).child(statusLabel(status))),
        ),
      );
  }

  private empty(): El {
    return div()
      .flex()
      .flexCol()
      .gap(px(8))
      .p(px(16))
      .roundedLg()
      .border1()
      .borderColor(token("border", 0.7))
      .child(div().textSize(13).textColor(theme.surface_text).fontWeight(600).child("No agents yet"))
      .child(
        div()
          .textSize(11.5)
          .textColor(theme.muted)
          .child("An agent says what it is doing itself, over OSC 7501 (docs/v2/23 §6)."),
      )
      .child(
        div()
          .textSize(11.5)
          .textColor(theme.muted)
          .child("Run `pumi skill setup` so pi, Claude and the rest report their state and their name."),
      );
  }

  private detailBar(): El | null {
    const agent = this.selectedAgent();
    if (!agent) return null;
    return div()
      .flex()
      .flexRow()
      .flexNone()
      .gap(px(8))
      .h(px(40))
      .px(px(16))
      .borderT1()
      .borderColor(token("border", 0.55))
      .bg(token("surface", 0.4))
      .child(dot(agent.status, 8).id(`agent-overview-selected-${agent.pane}`))
      .child(div().flexNone().textSize(11.5).textColor(theme.surface_text).child(agent.kind))
      .child(div().flexNone().textSize(11).textColor(theme.muted).child(place(agent)))
      .child(div().flex1().truncate().textSize(11).textColor(theme.placeholder).child(path(agent)))
      .child(ui.button("Go to pane").id("agent-overview-go").onClick(() => void this.jump(agent.pane)));
  }

  private main(): El {
    const agents = this.visible();
    const total = this.overview.total();
    const content: El[] = [];

    // The heading: what this list is, and how much of it there is.
    content.push(
      div()
        .flex()
        .flexCol()
        .flexNone()
        .gap(px(3))
        .child(
          div()
            .textSize(20)
            .textColor(theme.surface_text)
            .fontWeight(600)
            .child(this.filter === "all" ? "Agent overview" : filterLabel(this.filter)),
        )
        .child(
          div()
            .textSize(11.5)
            .textColor(theme.muted)
            .child(
              `${agents.length} of ${total} agents · ${this.overview.sessions()} sessions · ${this.overview.needsYou()} need you`,
            ),
        ),
    );

    // The cards: one per state the protocol has, each with its share of the whole.
    content.push(
      div()
        .flex()
        .flexRow()
        .itemsStretch()
        .gap(px(10))
        .children([
          this.card("Working", this.overview.count("working"), total, "running now", "working"),
          this.card("Needs you", this.overview.needsYou(), total, "blocked or failed", "blocked"),
          this.card("Done", this.overview.count("done"), total, "finished, not yet seen", "done"),
          this.card("Idle", this.overview.count("idle"), total, "waiting for a prompt", "idle"),
        ]),
    );

    // What wants the user, in its own words.
    const alerts = this.overview.agents.filter((agent) => needsYou(agent.status)).map((agent) => this.alert(agent));
    if (alerts.length > 0) {
      content.push(
        div()
          .flex()
          .flexCol()
          .flexNone()
          .gap(px(6))
          .child(heading("Needs you", alerts.length))
          .children(alerts),
      );
    }

    // Two columns, as a fleet page has: what runs, and what waits.
    const working = this.overview.agents
      .filter((agent) => agent.status === "working")
      .map((agent) => this.brief(agent, agent.message === "" ? agent.title : agent.message));
    const waiting = this.overview.agents
      .filter((agent) => needsYou(agent.status))
      .map((agent) => this.brief(agent, agent.message === "" ? agent.why : agent.message));
    content.push(
      div()
        .flex()
        .flexRow()
        .itemsStart()
        .gap(px(16))
        .child(this.column("Working now", working.length, working))
        .child(this.column("Waiting on you", waiting.length, waiting)),
    );

    // The agents, one row each.
    if (agents.length === 0) {
      content.push(this.empty());
    } else {
      content.push(
        div()
          .flex()
          .flexCol()
          .flexNone()
          .gap(px(6))
          .child(heading("Agents", agents.length, this.legend()))
          .child(this.table(agents)),
      );
    }

    return div()
      .flex()
      .flexCol()
      .flex1()
      .minW0()
      .hFull()
      .child(this.topBar())
      .child(
        scroll()
          .id("agent-overview-main")
          .flex()
          .flexCol()
          .flex1()
          .minH0()
          .gap(px(16))
          .px(px(20))
          .py(px(16))
          .track(this.scroll)
          .children(content),
      );
  }
}
