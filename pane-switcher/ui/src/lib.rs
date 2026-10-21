//! pane-switcher: Alt-Tab for panes. Press the trigger and the tab's panes (or the session's,
//! or every session's) arrive as a row of cards over the window, dimming what is under them,
//! each showing what its pane holds — the terminal's last lines, the page's text — with the
//! pane's title under it. Left and right move the highlight, Enter goes there, Escape leaves
//! everything as it was, and `x` closes the pane that holds the highlight.
//!
//! `init` is the package's own half: the options it declares, and the key that opens the
//! `pane-switcher.switcher` float. The list is read when it opens (a switcher is momentary), and
//! in most-recently-used order by default, so the first card is where you were and the next one
//! is where you were before — what a task switcher does.

use std::cell::RefCell;

use pumi_plugin::gpui::{
    AnyElement, ClickEvent, Div, FocusHandle, FontWeight, KeyDownEvent, Rgba, ScrollHandle, WeakEntity,
};
use pumi_plugin::prelude::*;
use pumi_plugin::ui::{self, color};

/// The height of one line of a card's preview.
const LINE: f32 = 14.;

/// The gap between two cards, and the strip's padding around them.
const GAP: f32 = 10.;
const PAD: f32 = 12.;

/// How many cards are worth drawing, and how many are worth reading the text of: a switcher
/// with more panes than this is a picker's job.
const MAX_CARDS: usize = 40;
const MAX_PREVIEWS: usize = 20;

/// What the switcher is asked to show, read from its options when it opens.
#[derive(Debug, Clone, PartialEq)]
struct Settings {
    /// `tab`, `session` (its tabs) or `all`.
    scope: String,
    /// `recent` (most recently used first) or `layout`.
    order: String,
    /// The float: how wide a share of the window, and how many cells tall.
    width: u64,
    height: u64,
    /// How much it dims what is under it, 0 to 100.
    backdrop: u8,
    /// How wide one card is, in pixels.
    card_width: f32,
    /// Whether a card shows its pane's text, and how many lines of it.
    preview: bool,
    rows: usize,
}

impl Settings {
    fn current() -> Self {
        let text = |name: &str| {
            api::option(&format!("pane_switcher.{name}"), json!({}))
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
        };
        let number =
            |name: &str| api::option(&format!("pane_switcher.{name}"), json!({})).ok().and_then(|value| value.as_f64());
        let flag = |name: &str, default: bool| {
            api::option(&format!("pane_switcher.{name}"), json!({}))
                .ok()
                .and_then(|value| value.as_bool())
                .unwrap_or(default)
        };
        Settings {
            scope: text("scope").unwrap_or_else(|| "session".into()),
            order: text("order").unwrap_or_else(|| "recent".into()),
            width: number("width").unwrap_or(80.).clamp(20., 100.) as u64,
            height: number("height").unwrap_or(18.).clamp(8., 60.) as u64,
            backdrop: number("backdrop").unwrap_or(30.).clamp(0., 80.) as u8,
            card_width: number("card_width").unwrap_or(220.).clamp(120., 600.) as f32,
            preview: flag("preview", true),
            rows: number("preview_rows").unwrap_or(14.).clamp(1., 60.) as usize,
        }
    }
}

/// One pane, as a card shows it.
#[derive(Debug, Clone, PartialEq)]
struct Card {
    pane: u64,
    /// Its type (`terminal`, `browser`, …), which picks the card's icon.
    kind: String,
    /// Its title, or what it runs, or its type.
    title: String,
    /// Its `tab.pane` number and its directory, or its page.
    detail: String,
    /// An agent's state, when one reported its pane (`@agent_status`).
    status: String,
    /// What the pane holds: its screen in its own colours, or its text.
    preview: Preview,
}

/// A run of a preview line: text the pane's terminal drew in one style.
#[derive(Debug, Clone, PartialEq)]
struct Span {
    text: String,
    fg: Rgba,
    bg: Option<Rgba>,
    bold: bool,
    italic: bool,
    underline: bool,
}

/// A card's preview: the pane's screen as the app last drew it (`pane.cells`), its plain text
/// when the app has no screen of that pane (a pane it never drew, or a type that is not a
/// terminal), or nothing.
#[derive(Debug, Clone, PartialEq, Default)]
enum Preview {
    #[default]
    Nothing,
    /// Lines of runs, and the pane's background behind them.
    Cells { lines: Vec<Vec<Span>>, bg: Rgba },
    /// Lines as the core read them (`pumi_pane_call`'s `read`), styleless.
    Text(Vec<String>),
}

// ---------------------------------------------------------------- the model

fn ids(list: &Value) -> Vec<u64> {
    list.as_array().map(|items| items.iter().filter_map(Value::as_u64).collect()).unwrap_or_default()
}

/// `panes` in the order to show them: the most recent first when `recent` is the order, and the
/// rest as they came (a tab's layout order). Sorting is stable, so a pane nobody has visited
/// keeps its place.
fn ordered(panes: &[(u64, u64)], recent: &[u64], by_recent: bool) -> Vec<(u64, u64)> {
    let mut panes = panes.to_vec();
    if by_recent {
        let rank = |pane: u64| recent.iter().position(|seen| *seen == pane).unwrap_or(usize::MAX);
        panes.sort_by_key(|(pane, _)| rank(*pane));
    }
    panes
}

/// `/Users/me/x` as `~/x`, for a card's detail line.
fn tilde(path: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    match path.strip_prefix(&home) {
        Some(rest) if !home.is_empty() => format!("~{rest}"),
        _ => path.to_string(),
    }
}

/// A line of a preview as a card draws it: control characters out, and no more than `width`
/// characters (the card clips the rest regardless, but shaping a 4 KB line for nothing is waste).
fn clip(line: &str, width: usize) -> String {
    let mut out = String::new();
    for character in line.chars() {
        if out.chars().count() >= width {
            break;
        }
        if character == '\t' || !character.is_control() {
            out.push(if character == '\t' { ' ' } else { character });
        }
    }
    out
}

/// A pane's text as a card's preview: its last `rows` lines, without the blank ones trailing it.
fn preview_lines(text: &str, rows: usize, width: usize) -> Vec<String> {
    let mut lines: Vec<&str> = text.lines().collect();
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    let from = lines.len().saturating_sub(rows);
    lines[from..].iter().map(|line| clip(line, width)).collect()
}

/// The family of the terminal's font (`guifont`, `JetBrains_Mono:h14`), so a preview is set as
/// the pane it shows is: `None` when no guifont is set, and the card's own font is used.
fn mono_family() -> Option<SharedString> {
    let guifont = api::option("guifont", json!({})).ok()?.as_str()?.to_string();
    let family = guifont.split(':').next().unwrap_or_default().trim().replace('_', " ");
    (!family.is_empty()).then(|| SharedString::from(family))
}

/// The option of `pane`, as text; empty when unset.
fn pane_text(pane: u64, name: &str) -> String {
    api::option(name, json!({ "pane": pane }))
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Where a pane is, as its place's kind: `tiled`, `float`, `slot` or `detached`.
fn place_kind(pane: u64) -> String {
    api::pumi_pane_get_place(pane)
        .ok()
        .and_then(|place| place["kind"].as_str().map(str::to_string))
        .unwrap_or_else(|| "tiled".into())
}

/// The panes the settings ask for, by tab: laid out in the tab, never its chrome (a slot) or a
/// detached pane, and never one of ours.
fn panes(settings: &Settings) -> Vec<(u64, u64)> {
    let tabs: Vec<u64> = match settings.scope.as_str() {
        "tab" => api::pumi_get_current_tab().ok().into_iter().collect(),
        "all" => {
            let sessions = api::pumi_list_sessions().ok().map(|list| ids(&list)).unwrap_or_default();
            sessions
                .iter()
                .flat_map(|session| api::pumi_list_tabs(*session).ok().map(|list| ids(&list)).unwrap_or_default())
                .collect()
        }
        _ => api::pumi_get_current_session()
            .ok()
            .and_then(|session| api::pumi_list_tabs(session).ok())
            .map(|list| ids(&list))
            .unwrap_or_default(),
    };
    let mut found = Vec::new();
    for tab in tabs {
        let listed = api::pumi_list_panes(json!({ "tab": tab })).ok().map(|list| ids(&list)).unwrap_or_default();
        for pane in listed {
            let kind = place_kind(pane);
            if kind != "tiled" && kind != "float" {
                continue;
            }
            if pane_text(pane, "pane_type") == "pane-switcher.switcher" {
                continue;
            }
            found.push((pane, tab));
        }
    }
    found
}

/// A pane's card, or `None` when it cannot be shown (a pane closed between the listing and now).
fn card(pane: u64, settings: &Settings, numbered: bool, read: bool) -> Option<Card> {
    let kind = pane_text(pane, "pane_type");
    let command = pane_text(pane, "pane_current_command");
    let title = pane_text(pane, "title");
    let title = [title, command, kind.clone()].into_iter().find(|text| !text.is_empty())?;
    let mut detail = String::new();
    if numbered {
        detail.push_str(
            &api::pumi_eval_format("#{window_index}.#{pane_index}", json!({ "pane": pane })).unwrap_or_default(),
        );
    }
    let cwd = tilde(&pane_text(pane, "pane_current_path"));
    if !cwd.is_empty() {
        if !detail.is_empty() {
            detail.push_str("  ");
        }
        detail.push_str(&cwd);
    }
    let preview = match settings.preview && read {
        false => Preview::Nothing,
        // The app's own screen of the pane, in the colours its terminal gave it; nothing is
        // resized to take it, and a pane the app never drew has none.
        true => cells(pane, settings.rows).unwrap_or_else(|| Preview::Text(text_of(pane, settings))),
    };
    Some(Card { pane, kind, title, detail, status: pane_text(pane, "@agent_status"), preview })
}

/// The pane's screen as the app parsed it (`pane.cells`): its last lines, as runs of styled
/// cells. `None` when the app has no screen of that pane, so the caller falls back to its text.
fn cells(pane: u64, rows: usize) -> Option<Preview> {
    screen_preview(&api::call("pane.cells", json!({ "pane": pane, "lines": rows })).ok()?)
}

/// What `pane.cells` answered, as a card draws it.
fn screen_preview(screen: &Value) -> Option<Preview> {
    let lines = screen["lines"]
        .as_array()?
        .iter()
        .map(|line| line.as_array().map(|runs| runs.iter().filter_map(runs_of).collect()).unwrap_or_default())
        .collect();
    Some(Preview::Cells { lines, bg: colour(&screen["default_bg"]).unwrap_or_else(color::background) })
}

/// One run of a screen's line, as a card draws it.
fn runs_of(run: &Value) -> Option<Span> {
    Some(Span {
        text: run["text"].as_str()?.to_string(),
        fg: colour(&run["fg"]).unwrap_or_else(color::foreground),
        bg: colour(&run["bg"]),
        bold: run["bold"].as_bool().unwrap_or(false),
        italic: run["italic"].as_bool().unwrap_or(false),
        underline: run["underline"].as_bool().unwrap_or(false),
    })
}

/// `#rrggbb` as a colour.
fn colour(value: &Value) -> Option<Rgba> {
    let text = value.as_str()?.trim_start_matches('#');
    (text.len() == 6).then(|| u32::from_str_radix(text, 16).ok()).flatten().map(rgb)
}

/// The pane's text, as the core read it: what a card shows when the app has no screen of it.
fn text_of(pane: u64, settings: &Settings) -> Vec<String> {
    // One line is as wide as the card, at a guess: the card clips what is left over.
    let width = (settings.card_width / 6.).max(10.) as usize;
    api::pumi_pane_call(pane, "read", json!({ "lines": settings.rows + 40 }))
        .ok()
        .and_then(|value| value.as_str().map(|text| preview_lines(text, settings.rows, width)))
        .unwrap_or_default()
}

/// Every card the switcher shows, in order.
fn cards(settings: &Settings) -> Vec<Card> {
    let mut panes = panes(settings);
    let recent = RECENT.with(|recent| recent.borrow().clone());
    panes = ordered(&panes, &recent, settings.order == "recent");
    panes.truncate(MAX_CARDS);
    panes
        .iter()
        .enumerate()
        .filter_map(|(i, (pane, _))| card(*pane, settings, settings.scope != "tab", i < MAX_PREVIEWS))
        .collect()
}

/// The icon a pane type's card is drawn with.
fn kind_icon(kind: &str) -> &'static str {
    match kind {
        "terminal" => "terminal",
        "browser" => "globe",
        "editor" | "files" => "code",
        "agents" => "sparkle",
        _ if kind.ends_with(".agents") => "sparkle",
        _ => "blocks",
    }
}

/// A digit chord as the card it picks (`1` is the first), for a quick pick.
fn digit(chord: &str) -> Option<usize> {
    let (first, rest) = (chord.chars().next()?, chord.len());
    (rest == 1).then(|| first.to_digit(10)).flatten().filter(|n| (1..=9).contains(n)).map(|n| n as usize - 1)
}

// ---------------------------------------------------------------- the state it keeps

thread_local! {
    /// The panes used lately, the most recent first: what `order = "recent"` sorts by.
    static RECENT: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
    /// The switcher on screen, so the trigger pressed again moves it on instead of replacing it.
    static LIVE: RefCell<Option<WeakEntity<Switcher>>> = const { RefCell::new(None) };
    /// The key the trigger is bound to now, so the last one can be unbound.
    static BOUND: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Remember that `pane` is the one being used, so the switcher opens on the last few.
fn remember(event: &Value) {
    let Some(pane) = event["pane"].as_u64() else {
        return;
    };
    RECENT.with(|recent| {
        let mut recent = recent.borrow_mut();
        recent.retain(|seen| *seen != pane);
        recent.insert(0, pane);
        recent.truncate(64);
    });
}

// ---------------------------------------------------------------- the view

/// The switcher: the cards, the one the highlight is on, and the keys that move it.
struct Switcher {
    /// The float itself, closed when a pane is picked or the switcher is dismissed.
    own: u64,
    settings: Settings,
    cards: Vec<Card>,
    at: usize,
    focus: FocusHandle,
    scroll: ScrollHandle,
}

impl Switcher {
    fn new(own: u64, settings: Settings, focus: FocusHandle) -> Self {
        let cards = cards(&settings);
        let current = api::pumi_get_current_pane().ok();
        let at = cards.iter().position(|card| Some(card.pane) == current).unwrap_or(0);
        Self { own, settings, cards, at, focus, scroll: ScrollHandle::new() }
    }

    /// Read the panes again, after one left: the highlight stays on the same card.
    fn reload(&mut self, cx: &mut Context<Self>) {
        let pane = self.cards.get(self.at).map(|card| card.pane);
        self.cards = cards(&self.settings);
        self.at = pane
            .and_then(|pane| self.cards.iter().position(|card| card.pane == pane))
            .unwrap_or_else(|| self.at.min(self.cards.len().saturating_sub(1)));
        self.scroll.scroll_to_item(self.at);
        cx.notify();
    }

    fn go(&mut self, at: usize, cx: &mut Context<Self>) {
        if self.cards.is_empty() {
            return;
        }
        self.at = at.min(self.cards.len() - 1);
        self.scroll.scroll_to_item(self.at);
        cx.notify();
    }

    fn step(&mut self, by: i64, cx: &mut Context<Self>) {
        if self.cards.is_empty() {
            return;
        }
        let len = self.cards.len() as i64;
        self.at = (self.at as i64 + by).rem_euclid(len) as usize;
        self.scroll.scroll_to_item(self.at);
        cx.notify();
    }

    /// The trigger pressed again while it is up: on to the next card, as a held Alt-Tab does.
    fn advance(&mut self, cx: &mut Context<Self>) {
        self.step(1, cx);
    }

    /// Go to the highlighted pane, and close.
    fn commit(&mut self) {
        if let Some(card) = self.cards.get(self.at)
            && let Err(err) = api::pumi_set_current_pane(card.pane)
        {
            let _ = api::pumi_notify(&format!("pane-switcher: {}", err.message), Some("error"), json!({}));
        }
        self.close();
    }

    /// Close the highlighted pane (its `PaneClosePre` may refuse) and read the rest again.
    fn close_card(&mut self, cx: &mut Context<Self>) {
        let Some(card) = self.cards.get(self.at) else {
            return;
        };
        if let Err(err) = api::pumi_pane_close(card.pane, None) {
            let _ = api::pumi_notify(&format!("pane-switcher: {}", err.message), Some("error"), json!({}));
        }
        self.reload(cx);
        if self.cards.is_empty() {
            self.close();
        }
    }

    fn close(&self) {
        let _ = api::pumi_pane_close(self.own, Some(true));
    }

    fn key(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let chord = ui::keys::chord(&event.keystroke);
        match chord.as_str() {
            "enter" | "return" => self.commit(),
            "left" | "up" | "ctrl+p" | "ctrl+k" | "shift+tab" | "shift+alt+tab" | "ctrl+shift+tab" => self.step(-1, cx),
            "right" | "down" | "tab" | "alt+tab" | "ctrl+tab" | "ctrl+n" | "ctrl+j" => self.step(1, cx),
            "home" => self.go(0, cx),
            "end" => self.go(usize::MAX, cx),
            "x" => self.close_card(cx),
            _ => match digit(&chord) {
                Some(at) => self.go(at, cx),
                None => return,
            },
        }
        cx.stop_propagation();
    }

    /// One card: its pane's screen above, its title and agent below.
    fn card(&self, cx: &mut Context<Self>, i: usize, card: &Card, mono: Option<&SharedString>) -> AnyElement {
        let selected = i == self.at;
        let foreground = if selected { color::foreground() } else { color::muted_foreground() };
        let preview = preview(card, selected, mono);
        let icon = kind_icon(&card.kind);
        let detail = card.detail.clone();
        let status = card.status.clone();
        div()
            .id(SharedString::from(format!("pane-switcher-card-{i}")))
            .class("pane-switcher-card")
            .vcol()
            .flex_none()
            .w(px(self.settings.card_width))
            .rounded(px(ui::color::radius_lg()))
            .overflow_hidden()
            .border_1()
            .border_color(if selected { color::primary() } else { color::border() })
            .bg(if selected { color::list_hover() } else { color::background() })
            .cursor_pointer()
            .when(!selected, |card| card.hover(|card| card.bg(color::accent())))
            .on_hover(cx.listener(move |this: &mut Switcher, hovered: &bool, _, cx| {
                if *hovered && this.at != i {
                    this.at = i;
                    this.scroll.scroll_to_item(i);
                    cx.notify();
                }
            }))
            .on_click(cx.listener(move |this: &mut Switcher, _: &ClickEvent, _, cx| {
                this.go(i, cx);
                this.commit();
            }))
            .child(preview)
            .child(
                div()
                    .vcol()
                    .flex_none()
                    .gap(px(1.))
                    .px(px(10.))
                    .pt(px(5.))
                    .pb(px(6.))
                    .border_t_1()
                    .border_color(color::border().opacity(0.55))
                    .child(
                        div()
                            .hrow()
                            .gap(px(7.))
                            .child(ui::icon(icon, ui::ICON, foreground))
                            .child(
                                div()
                                    .fill()
                                    .text(12., foreground)
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(SharedString::from(card.title.clone())),
                            )
                            .when(!status.is_empty(), |row| {
                                row.child(ui::state_mark(
                                    SharedString::from(format!("pane-switcher-state-{i}")),
                                    &status,
                                    "",
                                    None,
                                    ui::Marks::Icons,
                                    ui::ICON_SMALL,
                                ))
                            }),
                    )
                    .when(!detail.is_empty(), |footer| {
                        footer.child(
                            div()
                                .h(px(13.))
                                .truncate()
                                .text(10.5, color::muted_foreground().opacity(if selected { 0.85 } else { 0.6 }))
                                .child(SharedString::from(detail)),
                        )
                    }),
            )
            .into_any_element()
    }
}

/// The pane's own monospace when there is one: a preview's runs line up in columns only in a
/// font whose glyphs all take the same width.
fn mono(row: Div, family: Option<&SharedString>) -> Div {
    match family {
        Some(family) => row.font_family(family.clone()),
        None => row,
    }
}

/// A card's preview: the pane's screen in the colours its terminal gave it, its plain text when
/// the app has no screen of it, or an icon when there is nothing to show.
fn preview(card: &Card, selected: bool, family: Option<&SharedString>) -> AnyElement {
    match &card.preview {
        Preview::Cells { lines, bg } if !lines.is_empty() => {
            let rows = lines.iter().map(|runs| {
                mono(div().flex_none().h(px(LINE)).whitespace_nowrap().truncate().flex(), family).children(runs.iter().map(
                    |run| {
                        let span = mono(div().flex_none().text(11., run.fg).child(SharedString::from(run.text.clone())), family)
                            .when_some(run.bg, |span, bg| span.bg(bg))
                            .when(run.bold, |span| span.font_weight(FontWeight::BOLD))
                            .when(run.italic, |span| span.italic())
                            .when(run.underline, |span| span.underline());
                        span
                    },
                ))
            });
            div()
                .vcol()
                .flex_1()
                .min_h(px(0.))
                .p(px(8.))
                .overflow_hidden()
                .bg(*bg)
                .opacity(if selected { 1. } else { 0.9 })
                .children(rows)
                .into_any_element()
        }
        Preview::Text(lines) if !lines.is_empty() => div()
            .vcol()
            .flex_1()
            .min_h(px(0.))
            .p(px(8.))
            .overflow_hidden()
            .children(lines.iter().map(|line| {
                mono(
                    div()
                        .flex_none()
                        .h(px(LINE))
                        .whitespace_nowrap()
                        .truncate()
                        .text(11., color::muted_foreground().opacity(if selected { 0.9 } else { 0.55 }))
                        .child(SharedString::from(line.clone())),
                    family,
                )
            }))
            .into_any_element(),
        _ => div()
            .flex_1()
            .center()
            .child(ui::icon(kind_icon(&card.kind), 28., color::muted_foreground().opacity(0.35)))
            .into_any_element(),
    }
}

impl Render for Switcher {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mono = mono_family();
        let mut cards: Vec<AnyElement> = Vec::with_capacity(self.cards.len());
        for i in 0..self.cards.len() {
            let card = self.cards[i].clone();
            cards.push(self.card(cx, i, &card, mono.as_ref()));
        }
        let count = self.cards.len();
        let empty = cards.is_empty().then(|| {
            div()
                .flex_1()
                .center()
                .text(12., color::muted_foreground())
                .child("No panes to switch to")
                .into_any_element()
        });
        // The cards sit in the middle of the float while they fit in it, and start at its left
        // edge when they have to scroll: centring them as they overflow would clip the first
        // ones (`justify_center` leaves the overhang off both ends). The float's own width is
        // the app's, so it is read from the view it gave this one.
        let room = f32::from(pumi_plugin::view_size(window).width);
        let fits = count as f32 * self.settings.card_width
            + count.saturating_sub(1) as f32 * GAP
            + 2. * PAD
            <= room;
        div()
            .id("pane-switcher")
            .class("pane-switcher")
            .vcol()
            .size_full()
            .bg(color::popover())
            .track_focus(&self.focus)
            .capture_key_down(cx.listener(Self::key))
            .child(
                div()
                    .hrow()
                    .flex_none()
                    .gap(px(8.))
                    .px(px(14.))
                    .pt(px(10.))
                    .pb(px(6.))
                    .text(12., color::muted_foreground())
                    .child(ui::icon("blocks", ui::ICON_SMALL, color::placeholder()))
                    .child(
                        div()
                            .flex_none()
                            .text_color(color::foreground())
                            .font_weight(FontWeight::MEDIUM)
                            .child("Switch pane"),
                    )
                    .child(div().flex_none().text_color(color::placeholder()).child(format!("{count}")))
                    .child(div().fill())
                    .child(
                        div().flex_none().text_color(color::placeholder()).child("← → choose · enter go · esc close"),
                    ),
            )
            .child(
                div()
                    .id("pane-switcher-strip")
                    .flex()
                    .items_stretch()
                    .flex_1()
                    .min_h(px(0.))
                    .px(px(PAD))
                    .pb(px(PAD))
                    .gap(px(GAP))
                    .track_scroll(&self.scroll)
                    .overflow_x_scroll()
                    .when(fits, |strip| strip.justify_center())
                    .children(empty)
                    .children(cards),
            )
    }
}

// ---------------------------------------------------------------- opening it

/// Declare one of its options, in its heading in Settings.
fn declare_option(name: &str, mut spec: Value) {
    spec["group"] = json!("Pane switcher");
    if let Err(err) = api::pumi_create_option(&format!("pane_switcher.{name}"), spec) {
        eprintln!("pane-switcher: {err}");
    }
}

/// `pane_switcher.trigger`: the key that opens it.
fn trigger() -> String {
    api::option("pane_switcher.trigger", json!({}))
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|key| !key.is_empty())
        .unwrap_or_else(|| "<M-Tab>".into())
}

/// The switcher's pane, if one is open.
fn open_panes() -> Vec<u64> {
    api::pumi_list_panes(json!({ "type": "pane-switcher.switcher" })).ok().map(|list| ids(&list)).unwrap_or_default()
}

/// Where its float goes (06 §1): over the whole window, whichever tab of the session shows, so
/// a switch from another tab still shows it; centred by its anchor, dimming what is under it by
/// `backdrop`, and closed by the app on Escape or a press outside it (`dismiss`), so the view
/// itself handles neither. `focus: false`: the switcher must not become the pane it is
/// switching from.
fn place(settings: &Settings) -> Value {
    json!({
        "kind": "float",
        "relative": "client",
        "anchor": "center",
        "width": format!("{}%", settings.width),
        "height": settings.height,
        "backdrop": settings.backdrop,
        "dismiss": ["escape", "press"],
        "zindex": 70,
        "focus": false,
    })
}

/// Open it over the window; `false` when it could not open.
fn open() -> bool {
    for pane in open_panes() {
        let _ = api::pumi_pane_close(pane, Some(true));
    }
    let place = place(&Settings::current());
    match api::pumi_open_pane("pane-switcher.switcher", json!({}), place) {
        Ok(_) => true,
        Err(err) => {
            let _ = api::pumi_notify(&format!("pane-switcher: {}", err.message), Some("error"), json!({}));
            false
        }
    }
}

/// The trigger: on to the next card if it is already up, otherwise open it.
fn show(cx: &mut App) {
    let live = LIVE.with(|live| live.borrow().clone());
    if let Some(weak) = live
        && weak.update(cx, |switcher, cx| switcher.advance(cx)).is_ok()
    {
        return;
    }
    LIVE.with(|live| *live.borrow_mut() = None);
    open();
}

/// Bind `pane_switcher.trigger` in the global key table, and unbind the last one.
fn bind() {
    let key = trigger();
    if BOUND.with(|bound| bound.borrow().as_deref() == Some(key.as_str())) {
        return;
    }
    if let Some(last) = BOUND.with(|bound| bound.borrow_mut().take()) {
        let _ = api::pumi_del_keymap("global", &last, json!({}));
    }
    let rhs = api::callback(|_, cx| show(cx));
    let opts = json!({ "desc": "Switch pane" });
    match api::pumi_set_keymap("global", &key, rhs, opts) {
        Ok(()) => BOUND.with(|bound| *bound.borrow_mut() = Some(key)),
        Err(err) => eprintln!("pane-switcher: {err}"),
    }
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    declare_option(
        "trigger",
        json!({ "type": "string", "default": "<M-Tab>", "label": "Trigger", "placeholder": "<M-Tab>", "desc": "The key that opens the switcher, from any pane. Alt-Tab on a Mac; a chord such as <C-Space> works too." }),
    );
    declare_option(
        "scope",
        json!({ "type": "string", "default": "session", "choices": ["tab", "session", "all"], "labels": ["This tab", "This session", "Every session"], "label": "Which panes", "desc": "The panes the switcher shows: the tab's, the session's (every tab), or every session's." }),
    );
    declare_option(
        "order",
        json!({ "type": "string", "default": "recent", "choices": ["recent", "layout"], "labels": ["Most recently used", "Layout order"], "label": "Order", "desc": "How the cards are ordered. Recently used puts the last pane first, as a task switcher does." }),
    );
    declare_option(
        "width",
        json!({ "type": "number", "default": 80, "min": 20, "max": 100, "step": 5, "unit": "%", "label": "Width", "desc": "How much of the window's width the switcher takes." }),
    );
    declare_option(
        "backdrop",
        json!({ "type": "number", "default": 30, "min": 0, "max": 80, "step": 5, "unit": "%", "control": "slider", "label": "Dim behind it", "desc": "How much the switcher dims the window under it, and takes the presses there: a press outside closes it." }),
    );
    declare_option(
        "height",
        json!({ "type": "number", "default": 18, "min": 8, "max": 60, "step": 1, "unit": "rows", "label": "Height", "desc": "How many terminal rows tall the switcher is." }),
    );
    declare_option(
        "card_width",
        json!({ "type": "number", "default": 220, "min": 120, "max": 600, "step": 10, "unit": "px", "label": "Card width", "desc": "How wide one pane's card is." }),
    );
    declare_option(
        "preview",
        json!({ "type": "boolean", "default": true, "label": "Show pane text", "desc": "Draw each pane's last lines in its card, as a task switcher shows a window. Off makes the cards just their titles." }),
    );
    declare_option(
        "preview_rows",
        json!({ "type": "number", "default": 14, "min": 1, "max": 60, "step": 1, "unit": "lines", "label": "Preview lines", "desc": "How many lines of a pane its card shows." }),
    );
    plugin.view("switcher", |open, window, cx| {
        let focus = cx.focus_handle();
        let settings = Settings::current();
        let view = cx.new(|_| Switcher::new(open.pane, settings, focus.clone()));
        LIVE.with(|live| *live.borrow_mut() = Some(view.downgrade()));
        window.focus(&focus, cx);
        view.into()
    });
    bind();
    if let Err(err) = api::autocmd(
        "OptionSet",
        json!({ "pattern": "pane_switcher.*", "desc": "pane-switcher follows its options" }),
        |_, _| bind(),
    ) {
        eprintln!("pane-switcher: {err}");
    }
    if let Err(err) =
        api::autocmd("PaneEnter", json!({ "desc": "pane-switcher remembers the panes used" }), |event, _| {
            remember(&event)
        })
    {
        eprintln!("pane-switcher: {err}");
    }
    // `pumi call pane_switcher.open`, from anywhere: opens the switcher over the window.
    let spec = json!({ "desc": "Open the pane switcher over the window.", "examples": [{ "args": [] }] });
    if let Err(err) = api::provide("pane_switcher.open", spec, |_| Ok(json!(open()))) {
        eprintln!("pane-switcher: {err}");
    }
}

pumi_plugin::plugin!(init, api = 1);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_recent_order_comes_first_and_the_rest_keep_their_place() {
        let panes = [(1, 10), (2, 10), (3, 11), (4, 11)];
        assert_eq!(ordered(&panes, &[], false), panes.to_vec(), "layout order is as it came");
        assert_eq!(
            ordered(&panes, &[4, 2], true),
            vec![(4, 11), (2, 10), (1, 10), (3, 11)],
            "the last two used first, then the rest in layout order"
        );
        assert_eq!(ordered(&panes, &[9, 4], true), vec![(4, 11), (1, 10), (2, 10), (3, 11)]);
    }

    #[test]
    fn a_preview_is_the_last_lines_without_the_blank_ones_after_them() {
        assert_eq!(preview_lines("a\nb\nc\n\n\n", 2, 80), vec!["b", "c"]);
        assert_eq!(preview_lines("a\nb", 10, 80), vec!["a", "b"]);
        assert_eq!(preview_lines("", 3, 80), Vec::<String>::new());
        assert_eq!(preview_lines("\n\n", 3, 80), Vec::<String>::new());
    }

    #[test]
    fn a_long_line_is_clipped_and_never_carries_a_tab() {
        assert_eq!(clip("0123456789", 4), "0123");
        assert_eq!(clip("a\tb", 10), "a b");
        assert_eq!(clip("a\u{1b}[0mb", 10), "a[0mb", "the escape goes, the rest of it stays");
    }

    #[test]
    fn a_directory_under_home_is_shown_with_a_tilde() {
        let home = std::env::var("HOME").unwrap_or_default();
        if !home.is_empty() {
            assert_eq!(tilde(&format!("{home}/kitchen")), "~/kitchen");
        }
        assert_eq!(tilde("/elsewhere"), "/elsewhere");
    }

    #[test]
    fn a_digit_chord_picks_that_card_and_nothing_else_does() {
        assert_eq!(digit("1"), Some(0));
        assert_eq!(digit("9"), Some(8));
        assert_eq!(digit("0"), None);
        assert_eq!(digit("10"), None);
        assert_eq!(digit("alt+1"), None);
        assert_eq!(digit("escape"), None);
    }

    #[test]
    fn a_pane_types_icon_is_the_one_that_says_what_it_is() {
        assert_eq!(kind_icon("terminal"), "terminal");
        assert_eq!(kind_icon("browser"), "globe");
        assert_eq!(kind_icon("editor"), "code");
        assert_eq!(kind_icon("files"), "code");
        assert_eq!(kind_icon("agents"), "sparkle");
        assert_eq!(kind_icon("insert-path.picker"), "blocks", "a plugin's pane");
    }

    #[test]
    fn a_settings_table_says_what_to_show() {
        let settings = Settings {
            scope: "tab".into(),
            order: "layout".into(),
            width: 50,
            height: 12,
            backdrop: 40,
            card_width: 200.,
            preview: false,
            rows: 4,
        };
        assert_eq!((settings.scope.as_str(), settings.preview, settings.rows), ("tab", false, 4));
    }

    #[test]
    fn its_float_is_the_apps_to_place_and_dismiss() {
        let settings = Settings {
            scope: "session".into(),
            order: "recent".into(),
            width: 50,
            height: 12,
            backdrop: 40,
            card_width: 200.,
            preview: true,
            rows: 4,
        };
        let place = place(&settings);
        assert_eq!(place["kind"], "float");
        assert_eq!(place["relative"], "client", "over the window, not just its tab");
        assert_eq!(place["anchor"], "center");
        assert_eq!((place["width"].as_str(), place["height"].as_i64()), (Some("50%"), Some(12)));
        assert_eq!(place["backdrop"], 40);
        assert_eq!(place["dismiss"], json!(["escape", "press"]), "the app closes it, not the view");
        assert_eq!(place["focus"], false, "it is not the pane being switched from");
    }

    #[test]
    fn a_screen_becomes_lines_of_runs_in_its_own_colours() {
        let screen = json!({
            "pane": "%3",
            "cols": 80,
            "rows": 24,
            "from": 20,
            "default_fg": "#c0c0c0",
            "default_bg": "#101010",
            "lines": [
                [
                    { "text": "$ ", "fg": "#50fa7b", "bg": null, "bold": true, "italic": false, "underline": false, "strike": false, "link": false },
                    { "text": "ls", "fg": "#f8f8f2", "bg": null, "bold": false, "italic": false, "underline": false, "strike": false, "link": false },
                ],
                [
                    { "text": "M  Cargo.toml", "fg": "#f8f8f2", "bg": "#44475a", "bold": false, "italic": false, "underline": false, "strike": false, "link": false },
                ],
            ],
        });
        let preview = screen_preview(&screen).unwrap_or_else(|| panic!("a screen is a preview"));
        match preview {
            Preview::Cells { lines, bg } => {
                assert_eq!(lines.len(), 2, "two lines as the app sent them");
                assert_eq!(lines[0].len(), 2, "a prompt and what it ran are two runs");
                assert_eq!((lines[0][0].text.as_str(), lines[0][0].bold), ("$ ", true));
                assert_eq!(lines[0][1].text, "ls");
                assert_eq!(lines[1][0].bg, colour(&json!("#44475a")), "the run keeps its background");
                assert_eq!(bg, colour(&json!("#101010")).unwrap_or_else(color::background));
            }
            other => panic!("a screen is cells, not {other:?}"),
        }
    }

    #[test]
    fn a_screen_without_lines_is_no_preview() {
        assert!(screen_preview(&json!({ "error": "provider_unavailable" })).is_none());
    }
}
