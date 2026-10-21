//! The dashboard: a rail of the sessions and their agents, and the overview beside it — what is
//! working, what is waiting for the user, and where each one is. The rail narrows the table (a
//! filter and a search); a row picks an agent, a second click goes to its pane.

use std::cell::RefCell;
use std::time::{Duration, Instant};

use pumi_plugin::gpui::{
    AnyElement, App, ClickEvent, FocusHandle, FontWeight, KeyDownEvent, Rgba, ScrollHandle, SharedString, Subscription,
    WeakEntity, relative,
};
use pumi_plugin::prelude::*;
use pumi_plugin::ui::{self, color};

use crate::data::{self, Agent, Filter, Overview, Status};

/// The pane type of the dashboard.
pub const VIEW: &str = "agent-overview.overview";

thread_local! {
    /// Every open dashboard, so an event reaches them all.
    static OPEN: RefCell<Vec<WeakEntity<Dashboard>>> = const { RefCell::new(Vec::new()) };
}

/// Read the agents again in every open dashboard (an autocmd's answer).
pub fn refresh_open(cx: &mut App) {
    OPEN.with(|open| {
        open.borrow_mut().retain(|dash| dash.update(cx, |dash, cx| dash.refresh(cx)).is_ok());
    });
}

/// Open the overview in a tab of its own: go to the one that is open, else make the tab.
pub fn open() -> bool {
    let panes = api::pumi_list_panes(json!({ "type": VIEW })).ok().unwrap_or(Value::Null);
    if let Some(pane) = panes.as_array().and_then(|list| list.iter().find_map(Value::as_u64)) {
        let _ = api::pumi_set_current_pane(pane);
        return true;
    }
    match api::pumi_open_pane(VIEW, json!({}), json!({ "kind": "tab", "name": "agents" })) {
        Ok(_) => true,
        Err(err) => {
            let _ = api::pumi_notify(&format!("agent overview: {}", err.message), Some("error"), json!({}));
            false
        }
    }
}

/// The tint a status is drawn in: the theme's, never a literal.
fn tint(status: Status) -> Rgba {
    match status {
        Status::Working => color::primary(),
        Status::Blocked => color::warning(),
        Status::Error => color::danger(),
        Status::Done => color::success(),
        Status::Idle | Status::Unknown => color::muted_foreground().opacity(0.55),
    }
}

/// A dot of a status, the shape the marks setting asks for.
fn dot(id: String, status: Status, size: f32) -> AnyElement {
    ui::state_mark(SharedString::from(id), status.word(), "", None, ui::Marks::Dots, size)
}

/// A section's heading: its name, its count, and room for a legend.
fn heading(title: impl Into<SharedString>, count: impl ToString, extra: Option<AnyElement>) -> AnyElement {
    let mut row = div()
        .hrow()
        .flex_none()
        .gap(px(8.))
        .text(12., color::foreground())
        .font_weight(FontWeight::SEMIBOLD)
        .child(title.into());
    row = row.child(div().text(11., color::muted_foreground()).child(count.to_string()));
    if let Some(extra) = extra {
        row = row.child(div().flex_1()).child(extra);
    } else {
        row = row.child(div().fill());
    }
    row.into_any_element()
}

/// A thin bar filled to `fraction`.
fn bar(fraction: f32, tint: Rgba) -> AnyElement {
    div()
        .relative()
        .h(px(3.))
        .w_full()
        .rounded_full()
        .bg(color::track())
        .child(div().h_full().w(relative(fraction.clamp(0., 1.))).rounded_full().bg(tint))
        .into_any_element()
}

/// The last time it read the model, as a dashboard says it.
fn since(elapsed: Duration) -> String {
    let seconds = elapsed.as_secs();
    match seconds {
        0..=4 => "updated just now".to_string(),
        5..=59 => format!("updated {seconds}s ago"),
        _ => format!("updated {}m ago", seconds / 60),
    }
}

pub struct Dashboard {
    overview: Overview,
    filter: Filter,
    /// The agent picked: its row is highlighted and the bar under the table offers the pane.
    selected: Option<u64>,
    query: Entity<ui::TextInput>,
    _changed: Subscription,
    focus: FocusHandle,
    scroll: ScrollHandle,
    rail: ScrollHandle,
    refreshed: Instant,
    poll: Duration,
    rail_width: f32,
    hide_idle: bool,
}

impl Dashboard {
    pub fn new(query: Entity<ui::TextInput>, cx: &mut Context<Self>) -> Self {
        let changed = cx.subscribe(&query, |this: &mut Dashboard, _, event: &ui::InputEvent, cx| {
            if let ui::InputEvent::Changed(_) = event {
                this.refresh(cx);
            }
        });
        let mut dash = Dashboard {
            overview: Overview::default(),
            filter: Filter::All,
            selected: None,
            query,
            _changed: changed,
            focus: cx.focus_handle(),
            scroll: ScrollHandle::new(),
            rail: ScrollHandle::new(),
            refreshed: Instant::now(),
            poll: Duration::from_secs(15),
            rail_width: 248.,
            hide_idle: false,
        };
        dash.settings();
        dash.refresh(cx);
        OPEN.with(|open| open.borrow_mut().push(cx.entity().downgrade()));
        Self::tick(cx);
        dash
    }

    /// Its options, read when it opens and when one changes.
    fn settings(&mut self) {
        let number = |name: &str| api::option(name, json!({})).ok().and_then(|value| value.as_f64());
        let flag = |name: &str| api::option(name, json!({})).ok().and_then(|value| value.as_bool());
        self.poll = Duration::from_secs(number("agent_overview.poll_secs").unwrap_or(15.).clamp(2., 600.) as u64);
        self.rail_width = number("agent_overview.rail_width").unwrap_or(248.).clamp(180., 380.) as f32;
        self.hide_idle = flag("agent_overview.hide_idle").unwrap_or(false);
    }

    fn query_text(&self, cx: &App) -> String {
        self.query.read(cx).text().to_string()
    }

    /// Read the agents again; keep the selection when its agent is still there.
    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.settings();
        match data::read() {
            Ok(overview) => {
                self.overview = overview;
                if self.hide_idle {
                    self.overview.agents.retain(|agent| agent.status != Status::Idle || agent.here);
                }
            }
            Err(err) => eprintln!("agent-overview: {}", err.message),
        }
        self.refreshed = Instant::now();
        if self.selected.is_some_and(|pane| !self.overview.agents.iter().any(|agent| agent.pane == pane)) {
            self.selected = None;
        }
        cx.notify();
    }

    /// One tick a second: the "updated" line ages, and the model is read again on its poll.
    fn tick(cx: &mut Context<Self>) {
        cx.spawn(async move |dash: WeakEntity<Dashboard>, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                let Ok(due) = dash.update(cx, |dash, cx| {
                    cx.notify();
                    dash.refreshed.elapsed() >= dash.poll
                }) else {
                    break;
                };
                if due {
                    let Ok(()) = dash.update(cx, |dash, cx| dash.refresh(cx)) else { break };
                }
            }
        })
        .detach();
    }

    fn visible(&self, cx: &App) -> Vec<Agent> {
        let query = self.query_text(cx);
        self.overview.visible(self.filter, &query).into_iter().cloned().collect()
    }

    fn select(&mut self, pane: u64, cx: &mut Context<Self>) {
        self.selected = Some(pane);
        if let Some(at) = self.visible(cx).iter().position(|agent| agent.pane == pane) {
            self.scroll.scroll_to_item(at);
        }
        cx.notify();
    }

    /// Move the highlight up or down the visible agents.
    fn step(&mut self, by: i64, cx: &mut Context<Self>) {
        let agents = self.visible(cx);
        if agents.is_empty() {
            return;
        }
        let at = self
            .selected
            .and_then(|pane| agents.iter().position(|agent| agent.pane == pane))
            .map(|at| (at as i64 + by).rem_euclid(agents.len() as i64) as usize)
            .unwrap_or(0);
        let pane = agents[at].pane;
        self.select(pane, cx);
    }

    /// Go to the agent's pane: what the dashboard is a dashboard for.
    fn jump(&mut self, pane: u64) {
        if let Err(err) = api::pumi_set_current_pane(pane) {
            let _ = api::pumi_notify(&format!("agent overview: {}", err.message), Some("error"), json!({}));
            return;
        }
        // The user is looking at it now: what the program left for them goes.
        let _ = api::pumi_pane_seen(pane);
    }

    fn selected_agent(&self) -> Option<&Agent> {
        self.selected.and_then(|pane| self.overview.agents.iter().find(|agent| agent.pane == pane))
    }

    fn key(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let chord = ui::keys::chord(&event.keystroke);
        match chord.as_str() {
            "down" | "ctrl+n" | "ctrl+j" => self.step(1, cx),
            "up" | "ctrl+p" | "ctrl+k" => self.step(-1, cx),
            "enter" | "return" => {
                if let Some(pane) = self.selected.or_else(|| self.visible(cx).first().map(|agent| agent.pane)) {
                    self.jump(pane);
                }
            }
            "escape" => {
                if self.selected.is_some() {
                    self.selected = None;
                    cx.notify();
                }
            }
            _ => return,
        }
        cx.stop_propagation();
    }

    // ------------------------------------------------------------ drawing

    fn render_rail(&self, cx: &mut Context<Self>) -> AnyElement {
        let query = self.query_text(cx);
        let mut nav: Vec<AnyElement> = Vec::new();
        for filter in Filter::ALL {
            let count = match filter {
                Filter::All => self.overview.total(),
                Filter::NeedsYou => self.overview.needs_you(),
                Filter::Working => self.overview.count(Status::Working),
                Filter::Idle => self.overview.count(Status::Idle) + self.overview.count(Status::Done),
            };
            nav.push(self.nav_row(cx, filter, count));
        }

        let mut rows: Vec<AnyElement> = Vec::new();
        for (session, name, agents) in self.overview.groups(self.filter, &query) {
            rows.push(
                div()
                    .id(SharedString::from(format!("agent-overview-session-{session}")))
                    .hrow()
                    .flex_none()
                    .gap(px(6.))
                    .h(px(26.))
                    .px(px(10.))
                    .pt(px(6.))
                    .text(10.5, color::muted_foreground())
                    .font_weight(FontWeight::MEDIUM)
                    .child(div().fill().truncate().child(name.to_uppercase()))
                    .child(div().flex_none().child(agents.len().to_string()))
                    .into_any_element(),
            );
            for agent in agents {
                rows.push(self.rail_row(cx, &agent, &query));
            }
        }
        if rows.is_empty() {
            rows.push(
                div()
                    .px(px(12.))
                    .py(px(10.))
                    .text(11., color::muted_foreground())
                    .child(if query.is_empty() { "No agents report yet".to_string() } else { format!("Nothing matches “{query}”") })
                    .into_any_element(),
            );
        }

        div()
            .vcol()
            .flex_none()
            .w(px(self.rail_width))
            .h_full()
            .border_r_1()
            .border_color(color::border().opacity(0.55))
            .child(
                div()
                    .hrow()
                    .flex_none()
                    .gap(px(8.))
                    .px(px(14.))
                    .pt(px(14.))
                    .pb(px(10.))
                    .child(ui::icon("blocks", ui::ICON_MEDIUM, color::foreground()))
                    .child(
                        div()
                            .fill()
                            .truncate()
                            .text(13., color::foreground())
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Agent overview"),
                    ),
            )
            .child(div().vcol().flex_none().gap(px(1.)).px(px(6.)).children(nav))
            .child(div().flex_none().px(px(8.)).pt(px(8.)).pb(px(4.)).child(self.query.clone()))
            .child(
                div()
                    .id("agent-overview-rail")
                    .vcol()
                    .flex_1()
                    .min_h(px(0.))
                    .pb(px(8.))
                    .overflow_y_scroll()
                    .track_scroll(&self.rail)
                    .children(rows),
            )
            .child(
                div()
                    .flex_none()
                    .px(px(12.))
                    .py(px(8.))
                    .border_t_1()
                    .border_color(color::border().opacity(0.55))
                    .text(10.5, color::muted_foreground())
                    .child(format!(
                        "{} agents · {} sessions",
                        self.overview.total(),
                        self.overview.sessions()
                    )),
            )
            .into_any_element()
    }

    fn nav_row(&self, cx: &mut Context<Self>, filter: Filter, count: usize) -> AnyElement {
        let on = self.filter == filter;
        let icon = match filter {
            Filter::All => "blocks",
            Filter::NeedsYou => "status-alert",
            Filter::Working => "status-spinner",
            Filter::Idle => "status-ring",
        };
        div()
            .id(SharedString::from(format!("agent-overview-nav-{filter:?}")))
            .class("agent-overview-nav")
            .hrow()
            .flex_none()
            .gap(px(8.))
            .h(px(28.))
            .px(px(8.))
            .rounded(px(color::radius()))
            .when(on, |row| row.bg(color::accent()))
            .when(!on, |row| row.hover(|row| row.bg(color::accent().opacity(0.5))))
            .cursor_pointer()
            .on_click(cx.listener(move |this: &mut Dashboard, _: &ClickEvent, _, cx| {
                this.filter = filter;
                this.selected = None;
                this.scroll.scroll_to_item(0);
                cx.notify();
            }))
            .child(ui::icon(icon, ui::ICON_SMALL, if on { color::foreground() } else { color::muted_foreground() }))
            .child(
                div()
                    .fill()
                    .truncate()
                    .text(12., if on { color::foreground() } else { color::muted_foreground() })
                    .child(filter.label()),
            )
            .child(
                div()
                    .flex_none()
                    .text(10.5, color::muted_foreground())
                    .child(count.to_string()),
            )
            .into_any_element()
    }

    fn rail_row(&self, cx: &mut Context<Self>, agent: &Agent, _query: &str) -> AnyElement {
        let picked = self.selected == Some(agent.pane);
        let pane = agent.pane;
        let status = agent.status;
        let id = format!("agent-overview-rail-{}", agent.pane);
        let mut row = div()
            .id(SharedString::from(id.clone()))
            .class("agent-overview-agent")
            .hrow()
            .flex_none()
            .gap(px(7.))
            .h(px(26.))
            .pl(px(18.))
            .pr(px(10.))
            .rounded(px(color::radius()))
            .when(picked, |row| row.bg(color::accent()))
            .when(!picked, |row| row.hover(|row| row.bg(color::accent().opacity(0.45))))
            .cursor_pointer()
            .on_click(cx.listener(move |this: &mut Dashboard, event: &ClickEvent, _, cx| {
                if event.click_count() >= 2 {
                    this.jump(pane);
                } else {
                    this.select(pane, cx);
                }
            }))
            .child(dot(format!("{id}-dot"), status, 8.))
            .child(
                div()
                    .flex_none()
                    .text(11.5, if picked { color::foreground() } else { color::muted_foreground() })
                    .child(agent.kind.clone()),
            )
            .child(div().fill().truncate().text(10.5, color::placeholder()).child(agent.folder().to_string()));
        if agent.here {
            row = row.child(div().flex_none().text(9.5, color::placeholder()).child("you"));
        }
        row.into_any_element()
    }

    fn top_bar(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .hrow()
            .flex_none()
            .gap(px(6.))
            .h(px(42.))
            .px(px(16.))
            .border_b_1()
            .border_color(color::border().opacity(0.55))
            .child(div().text(11.5, color::muted_foreground()).child("Agents"))
            .child(ui::icon("chevron-right", 10., color::placeholder()))
            .child(div().text(11.5, color::foreground()).child(self.filter.label()))
            .child(div().fill())
            .child(div().text(11., color::muted_foreground()).child(since(self.refreshed.elapsed())))
            .child(
                ui::Button::new("agent-overview-refresh")
                    .label("Refresh")
                    .primary()
                    .on_click(cx.listener(|this: &mut Dashboard, _: &ClickEvent, _, cx| this.refresh(cx))),
            )
            .into_any_element()
    }

    fn card(&self, title: &str, count: usize, of: usize, caption: &str, status: Status) -> AnyElement {
        let fraction = if of == 0 { 0. } else { count as f32 / of as f32 };
        let tint = tint(status);
        div()
            .vcol()
            .flex_1()
            .min_w(px(120.))
            .gap(px(6.))
            .p(px(12.))
            .rounded(px(color::radius_lg()))
            .border_1()
            .border_color(color::border().opacity(0.7))
            .child(
                div()
                    .hrow()
                    .gap(px(6.))
                    .child(dot(format!("agent-overview-card-{title}"), status, 8.))
                    .child(div().text(11., color::muted_foreground()).child(title.to_string())),
            )
            .child(
                div()
                    .text(24., color::foreground())
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(count.to_string()),
            )
            .child(bar(fraction, tint))
            .child(div().text(10.5, color::muted_foreground()).child(caption.to_string()))
            .into_any_element()
    }

    fn alert(&self, agent: &Agent) -> AnyElement {
        let pane = agent.pane;
        div()
            .id(SharedString::from(format!("agent-overview-alert-{pane}")))
            .class("agent-overview-alert")
            .vcol()
            .flex_none()
            .gap(px(3.))
            .px(px(12.))
            .py(px(9.))
            .rounded(px(color::radius()))
            .border_1()
            .border_color(tint(agent.status).opacity(0.4))
            .bg(tint(agent.status).opacity(0.06))
            .child(
                div()
                    .hrow()
                    .gap(px(7.))
                    .child(ui::icon(
                        if agent.status == Status::Error { "status-x" } else { "warning" },
                        ui::ICON_SMALL,
                        tint(agent.status),
                    ))
                    .child(
                        div()
                            .text(12., color::foreground())
                            .font_weight(FontWeight::MEDIUM)
                            .child(format!("{} {}", agent.kind, agent.why)),
                    )
                    .child(div().fill())
                    .child(div().text(10.5, color::muted_foreground()).child(agent.place())),
            )
            .child(
                div()
                    .pl(px(21.))
                    .truncate()
                    .text(11., color::muted_foreground())
                    .child(if agent.message.is_empty() { agent.path() } else { agent.message.clone() }),
            )
            .into_any_element()
    }

    fn column(&self, title: &str, count: usize, rows: Vec<AnyElement>) -> AnyElement {
        div()
            .vcol()
            .flex_1()
            .min_w(px(180.))
            .gap(px(6.))
            .child(heading(title.to_string(), count, None))
            .child(
                div()
                    .vcol()
                    .rounded(px(color::radius_lg()))
                    .border_1()
                    .border_color(color::border().opacity(0.7))
                    .when(rows.is_empty(), |box_| {
                        box_.px(px(12.)).py(px(12.)).child(
                            div()
                                .text(11., color::muted_foreground())
                                .child(if title.starts_with("Working") {
                                    "Nothing is working right now."
                                } else {
                                    "Nothing is waiting for you."
                                }),
                        )
                    })
                    .children(rows),
            )
            .into_any_element()
    }

    /// One agent in the two columns under the cards: who, where, and what it says.
    fn brief(&self, agent: &Agent, show: &str) -> AnyElement {
        let pane = agent.pane;
        div()
            .id(SharedString::from(format!("agent-overview-brief-{pane}")))
            .hrow()
            .flex_none()
            .gap(px(8.))
            .h(px(28.))
            .px(px(10.))
            .border_t_1()
            .border_color(color::border().opacity(0.4))
            .child(dot(format!("agent-overview-brief-{pane}-dot"), agent.status, 7.))
            .child(div().flex_none().text(11.5, color::foreground()).child(agent.kind.clone()))
            .child(
                div()
                    .fill()
                    .truncate()
                    .text(11., color::muted_foreground())
                    .child(if show.is_empty() { agent.place() } else { show.to_string() }),
            )
            .child(div().flex_none().text(10.5, color::placeholder()).child(agent.folder().to_string()))
            .into_any_element()
    }

    fn table(&self, cx: &mut Context<Self>, agents: &[Agent]) -> AnyElement {
        let cell = |text: String, size: f32| {
            div()
                .fill()
                .truncate()
                .text(size, color::muted_foreground())
                .child(text)
                .into_any_element()
        };
        let header = |text: &str, size: f32, weight: FontWeight| {
            div()
                .truncate()
                .text(size, color::muted_foreground())
                .font_weight(weight)
                .child(text.to_string())
                .into_any_element()
        };
        let mut rows: Vec<AnyElement> = Vec::new();
        for agent in agents {
            let pane = agent.pane;
            let picked = self.selected == Some(pane);
            rows.push(
                div()
                    .id(SharedString::from(format!("agent-overview-row-{pane}")))
                    .class("agent-overview-row")
                    .hrow()
                    .flex_none()
                    .gap(px(8.))
                    .h(px(32.))
                    .px(px(10.))
                    .border_t_1()
                    .border_color(color::border().opacity(0.4))
                    .when(picked, |row| row.bg(color::accent()))
                    .when(!picked, |row| row.hover(|row| row.bg(color::accent().opacity(0.45))))
                    .cursor_pointer()
                    .on_click(cx.listener(move |this: &mut Dashboard, event: &ClickEvent, _, cx| {
                        if event.click_count() >= 2 {
                            this.jump(pane);
                        } else {
                            this.select(pane, cx);
                        }
                    }))
                    .child(div().flex_none().w(px(10.)).child(dot(format!("agent-overview-row-{pane}-dot"), agent.status, 8.)))
                    .child(
                        div()
                            .hrow()
                            .gap(px(6.))
                            .w(px(120.))
                            .flex_none()
                            .child(ui::icon("agent", ui::ICON_SMALL, color::muted_foreground()))
                            .child(
                                div()
                                    .fill()
                                    .truncate()
                                    .text(11.5, color::foreground())
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(agent.kind.clone()),
                            ),
                    )
                    .child(
                        div()
                            .flex_none()
                            .w(px(74.))
                            .text(11., tint(agent.status))
                            .child(if agent.why.is_empty() {
                                agent.status.label().to_string()
                            } else {
                                agent.why.clone()
                            }),
                    )
                    .child(div().flex_none().w(px(150.)).child(cell(agent.place(), 11.)))
                    .child(div().flex_1().min_w(px(80.)).child(cell(agent.path(), 11.)))
                    .child(div().flex_none().w(px(110.)).child(cell(agent.command.clone(), 11.)))
                    .child(div().flex_none().w(px(16.)).child(ui::icon("chevron-right", ui::ICON_SMALL, color::placeholder())))
                    .into_any_element(),
            );
        }
        div()
            .vcol()
            .flex_none()
            .rounded(px(color::radius_lg()))
            .border_1()
            .border_color(color::border().opacity(0.7))
            .overflow_hidden()
            .child(
                div()
                    .hrow()
                    .flex_none()
                    .gap(px(8.))
                    .h(px(28.))
                    .px(px(10.))
                    .bg(color::popover().opacity(0.35))
                    .child(div().flex_none().w(px(10.)))
                    .child(div().w(px(120.)).flex_none().child(header("AGENT", 10., FontWeight::MEDIUM)))
                    .child(div().flex_none().w(px(74.)).child(header("STATUS", 10., FontWeight::MEDIUM)))
                    .child(div().flex_none().w(px(150.)).child(header("SESSION", 10., FontWeight::MEDIUM)))
                    .child(div().flex_1().min_w(px(80.)).child(header("DIRECTORY", 10., FontWeight::MEDIUM)))
                    .child(div().flex_none().w(px(110.)).child(header("PROGRAM", 10., FontWeight::MEDIUM)))
                    .child(div().flex_none().w(px(16.))),
            )
            .children(rows)
            .into_any_element()
    }

    fn legend(&self) -> AnyElement {
        let mut row = div().hrow().flex_none().gap(px(10.));
        for status in [Status::Working, Status::Blocked, Status::Error, Status::Done, Status::Idle] {
            row = row.child(
                div()
                    .hrow()
                    .gap(px(4.))
                    .child(dot(format!("agent-overview-legend-{}", status.word()), status, 6.))
                    .child(div().text(10., color::muted_foreground()).child(status.label())),
            );
        }
        row.into_any_element()
    }

    fn empty(&self) -> AnyElement {
        div()
            .vcol()
            .gap(px(8.))
            .p(px(16.))
            .rounded(px(color::radius_lg()))
            .border_1()
            .border_color(color::border().opacity(0.7))
            .child(
                div()
                    .text(13., color::foreground())
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("No agents yet"),
            )
            .child(
                div()
                    .text(11.5, color::muted_foreground())
                    .child("An agent says what it is doing itself, over OSC 7501 (docs/v2/23 §6)."),
            )
            .child(
                div()
                    .text(11.5, color::muted_foreground())
                    .child("Run `pumi skill setup` so pi, Claude and the rest report their state and their name."),
            )
            .into_any_element()
    }

    fn detail_bar(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let agent = self.selected_agent()?;
        let pane = agent.pane;
        Some(
            div()
                .hrow()
                .flex_none()
                .gap(px(8.))
                .h(px(40.))
                .px(px(16.))
                .border_t_1()
                .border_color(color::border().opacity(0.55))
                .bg(color::popover().opacity(0.4))
                .child(dot(format!("agent-overview-selected-{pane}"), agent.status, 8.))
                .child(div().flex_none().text(11.5, color::foreground()).child(agent.kind.clone()))
                .child(div().flex_none().text(11., color::muted_foreground()).child(agent.place()))
                .child(div().fill().truncate().text(11., color::placeholder()).child(agent.path()))
                .child(
                    ui::Button::new("agent-overview-go")
                        .label("Go to pane")
                        .on_click(cx.listener(move |_: &mut Dashboard, _: &ClickEvent, _, _| {
                            if let Err(err) = api::pumi_set_current_pane(pane) {
                                let _ = api::pumi_notify(&format!("agent overview: {}", err.message), Some("error"), json!({}));
                            }
                            let _ = api::pumi_pane_seen(pane);
                        })),
                )
                .into_any_element(),
        )
    }
}

impl Render for Dashboard {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let agents = self.visible(cx);
        let total = self.overview.total();
        let mut content: Vec<AnyElement> = Vec::new();

        // The heading: what this list is, and how much of it there is.
        content.push(
            div()
                .vcol()
                .flex_none()
                .gap(px(3.))
                .child(
                    div()
                        .text(20., color::foreground())
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(if self.filter == Filter::All {
                            "Agent overview".to_string()
                        } else {
                            self.filter.label().to_string()
                        }),
                )
                .child(
                    div().text(11.5, color::muted_foreground()).child(format!(
                        "{} of {} agents · {} sessions · {} need you",
                        agents.len(),
                        total,
                        self.overview.sessions(),
                        self.overview.needs_you()
                    )),
                )
                .into_any_element(),
        );

        // The cards: one per state the protocol has, each with its share of the whole.
        let cards: Vec<AnyElement> = vec![
            self.card("Working", self.overview.count(Status::Working), total, "running now", Status::Working),
            self.card("Needs you", self.overview.needs_you(), total, "blocked or failed", Status::Blocked),
            self.card("Done", self.overview.count(Status::Done), total, "finished, not yet seen", Status::Done),
            self.card("Idle", self.overview.count(Status::Idle), total, "waiting for a prompt", Status::Idle),
        ];
        content.push(div().flex().items_stretch().gap(px(10.)).children(cards).into_any_element());

        // What wants the user, in its own words.
        let alerts: Vec<AnyElement> =
            self.overview.agents.iter().filter(|agent| agent.status.needs_you()).map(|agent| self.alert(agent)).collect();
        if !alerts.is_empty() {
            content.push(
                div()
                    .vcol()
                    .flex_none()
                    .gap(px(6.))
                    .child(heading("Needs you", alerts.len(), None))
                    .children(alerts)
                    .into_any_element(),
            );
        }

        // Two columns, as a fleet page has: what runs, and what waits.
        let working: Vec<AnyElement> = self
            .overview
            .agents
            .iter()
            .filter(|agent| agent.status == Status::Working)
            .map(|agent| {
                let show = if agent.message.is_empty() { agent.title.clone() } else { agent.message.clone() };
                self.brief(agent, &show)
            })
            .collect();
        let waiting: Vec<AnyElement> = self
            .overview
            .agents
            .iter()
            .filter(|agent| agent.status.needs_you())
            .map(|agent| {
                let show = if agent.message.is_empty() { agent.why.clone() } else { agent.message.clone() };
                self.brief(agent, &show)
            })
            .collect();
        let working_count = working.len();
        let waiting_count = waiting.len();
        content.push(
            div()
                .flex()
                .items_start()
                .gap(px(16.))
                .child(self.column("Working now", working_count, working))
                .child(self.column("Waiting on you", waiting_count, waiting))
                .into_any_element(),
        );

        // The agents, one row each.
        if agents.is_empty() {
            content.push(self.empty());
        } else {
            content.push(
                div()
                    .vcol()
                    .flex_none()
                    .gap(px(6.))
                    .child(heading("Agents", agents.len(), Some(self.legend())))
                    .child(self.table(cx, &agents))
                    .into_any_element(),
            );
        }

        let detail = self.detail_bar(cx);
        div()
            .id("agent-overview")
            .class("agent-overview")
            .vcol()
            .size_full()
            .overflow_hidden()
            .text(12., color::foreground())
            .track_focus(&self.focus)
            .capture_key_down(cx.listener(Self::key))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h(px(0.))
                    .child(self.render_rail(cx))
                    .child(
                        div()
                            .vcol()
                            .flex_1()
                            .min_w(px(0.))
                            .h_full()
                            .child(self.top_bar(cx))
                            .child(
                                div()
                                    .id("agent-overview-main")
                                    .vcol()
                                    .flex_1()
                                    .min_h(px(0.))
                                    .gap(px(16.))
                                    .px(px(20.))
                                    .py(px(16.))
                                    .overflow_y_scroll()
                                    .track_scroll(&self.scroll)
                                    .children(content),
                            ),
                    ),
            )
            .children(detail)
    }
}
