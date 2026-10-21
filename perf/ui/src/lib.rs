//! perf: how the app is doing, floating in a corner of the window. The app keeps the numbers
//! (`app.perf`: its CPU and memory, its frames, each core plugin's calls, the busiest threads,
//! sampled every second); this package draws them, as the app's own overlay did.
//!
//! The overlay is a float over the whole window (`relative = "client"`), pinned to a corner by
//! its anchor so it stays there as the window changes size. It takes neither the keyboard nor
//! the pointer, so the terminal under it goes on working, and it grows and shrinks with what it
//! has to show by moving its own pane (`pumi_pane_set_place`).

mod report;

use pumi_plugin::gpui::{AnyElement, Div, FontWeight, Rgba, WeakEntity};
use pumi_plugin::prelude::*;
use pumi_plugin::ui::color;

use report::{EXTENSIONS, Level, Report, Series, THREADS};

const VIEW: &str = "perf.overlay";
/// The app's function that answers with the numbers.
const REPORT: &str = "app.perf";

std::thread_local! {
    /// The key bound to the toggle now, to unbind when the option changes.
    static BOUND: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

// ---------------------------------------------------------------- the view

struct Overlay {
    /// The float itself, moved when it needs another height.
    own: u64,
    report: Report,
    /// The height it was last placed at.
    height: f32,
    family: SharedString,
}

impl Overlay {
    fn new(own: u64) -> Self {
        let report = read();
        let height = report.height();
        Self { own, report, height, family: mono_family() }
    }

    /// Read the numbers again, every second, for as long as the view is open.
    fn tick(cx: &mut Context<Self>) {
        cx.spawn(async move |this: WeakEntity<Overlay>, cx| {
            loop {
                cx.background_executor().timer(std::time::Duration::from_secs(1)).await;
                if this.update(cx, |this, cx| this.refresh(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.report = read();
        let height = self.report.height();
        if height != self.height {
            self.height = height;
            if let Err(err) = api::pumi_pane_set_place(self.own, place(height)) {
                eprintln!("perf: {err}");
            }
        }
        cx.notify();
    }
}

/// The report now, or an empty one when the app does not answer (a build without it).
fn read() -> Report {
    match api::call(REPORT, json!([])) {
        Ok(value) => Report::of(&value),
        Err(err) => {
            eprintln!("perf: {REPORT}: {err}");
            Report::of(&report::empty())
        }
    }
}

fn tone(level: Level) -> Rgba {
    match level {
        Level::Off => color::placeholder(),
        Level::Quiet => color::muted_foreground(),
        Level::Busy => color::warning(),
        Level::Hot => color::danger(),
    }
}

fn line() -> Div {
    div().flex().flex_row().flex_none().h(px(report::LINE)).line_height(px(report::LINE)).whitespace_nowrap()
}

fn spacer() -> Div {
    div().flex_none().h(px(report::SPACER))
}

fn graph(series: &Series) -> AnyElement {
    div().text_color(color::primary()).child(report::graph_line(series)).into_any_element()
}

/// One table row: its cells in their columns, then its graph.
fn row(columns: &[(&str, usize)], cells: Vec<String>, graph: Option<AnyElement>, tone: Rgba) -> Div {
    let mut row = line().text_color(tone);
    for ((_, width), cell) in columns.iter().zip(cells) {
        row = row.child(div().flex_none().w(px(*width as f32 * report::CHAR)).overflow_hidden().child(cell));
    }
    row.children(graph)
}

fn heading(columns: &[(&str, usize)]) -> Div {
    row(columns, columns.iter().map(|(name, _)| name.to_string()).collect(), None, color::placeholder())
}

impl Render for Overlay {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let r = &self.report;
        let mut list = div()
            .flex()
            .flex_col()
            .gap(px(report::GAP))
            .child(line().text_color(color::foreground()).font_weight(FontWeight::SEMIBOLD).child("performance"))
            .child(line().child(div().text_color(tone(report::load(r.cpu.avg_10s / 2.))).child(r.app_line())).child(graph(&r.cpu)))
            .child(line().text_color(color::muted_foreground()).child(r.memory_line()))
            .child(line().child(div().text_color(tone(report::load(r.ui.avg_10s))).child(r.ui_line())).child(graph(&r.ui)))
            .child(spacer())
            .child(heading(EXTENSIONS));
        for e in &r.extensions {
            list = list.child(row(EXTENSIONS, e.cells(), Some(graph(&e.cpu)), tone(e.level())));
        }
        if r.extensions.is_empty() {
            list = list.child(line().text_color(color::placeholder()).child("no extension has run yet"));
        }
        if !r.threads.is_empty() {
            list = list.child(spacer()).child(heading(THREADS));
            for t in &r.threads {
                list = list.child(row(THREADS, t.cells(), Some(graph(&t.cpu)), tone(report::load(t.cpu.avg_10s))));
            }
        }
        if r.samples == 0 {
            list = list.child(line().text_color(color::placeholder()).child("the first sample is a second away"));
        }
        let bg = color::popover();
        div()
            .class("perf")
            .size_full()
            .overflow_hidden()
            .p(px(report::PAD))
            .bg(Rgba { a: 0.92, ..bg })
            .font_family(self.family.clone())
            .text_size(px(report::FONT))
            .child(list)
    }
}

/// The terminal's font (`guifont`, `JetBrains_Mono:h14`) when one is set, else the system's
/// monospace: the tables line up only in a font whose glyphs all take the same width.
fn mono_family() -> SharedString {
    let guifont = api::option("guifont", json!({})).ok().and_then(|v| v.as_str().map(str::to_string));
    let family = guifont.unwrap_or_default().split(':').next().unwrap_or_default().trim().replace('_', " ");
    if family.is_empty() { system::select([("macos", "Menlo")], "monospace").into() } else { family.into() }
}

// ---------------------------------------------------------------- opening it

fn declare_option(name: &str, mut spec: Value) {
    spec["group"] = json!("Performance overlay");
    if let Err(err) = api::pumi_create_option(&format!("perf.{name}"), spec) {
        eprintln!("perf: {err}");
    }
}

fn text_option(name: &str, default: &str) -> String {
    api::option(&format!("perf.{name}"), json!({}))
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.into())
}

/// Where it goes: over the whole window, in `perf.corner`, `height` pixels tall. Clear of the
/// header at the top and the status bar at the bottom; it takes neither the keyboard nor the
/// pointer, and opening it does not make it the current pane.
fn place(height: f32) -> Value {
    let corner = text_option("corner", "NE");
    let from_top = !corner.starts_with('S');
    json!({
        "kind": "float",
        "relative": "client",
        "anchor": corner,
        "row": if from_top { "44px" } else { "32px" },
        "col": "12px",
        "width": format!("{}px", report::width()),
        "height": format!("{height}px"),
        "focusable": false,
        "mouse": false,
        "zindex": 90,
        "focus": false,
    })
}

fn open_panes() -> Vec<u64> {
    let list = api::pumi_list_panes(json!({ "type": VIEW })).unwrap_or_default();
    list.as_array().map(|l| l.iter().filter_map(Value::as_u64).collect()).unwrap_or_default()
}

/// Shows it, or takes it away; whether it is shown now.
fn toggle() -> bool {
    let open = open_panes();
    if !open.is_empty() {
        for pane in open {
            let _ = api::pumi_pane_close(pane, Some(true));
        }
        return false;
    }
    let height = read().height();
    match api::pumi_open_pane(VIEW, json!({}), place(height)) {
        Ok(_) => true,
        Err(err) => {
            let _ = api::pumi_notify(&format!("perf: {}", err.message), Some("error"), json!({}));
            false
        }
    }
}

/// An open overlay moves to the corner the option says now.
fn replace() {
    for pane in open_panes() {
        let height = read().height();
        if let Err(err) = api::pumi_pane_set_place(pane, place(height)) {
            eprintln!("perf: {err}");
        }
    }
}

/// Bind `perf.trigger` in the global key table, and unbind the last one.
fn bind() {
    let key = text_option("trigger", "<D-M-p>");
    if BOUND.with(|bound| bound.borrow().as_deref() == Some(key.as_str())) {
        return;
    }
    if let Some(last) = BOUND.with(|bound| bound.borrow_mut().take()) {
        let _ = api::pumi_del_keymap("global", &last, json!({}));
    }
    let rhs = api::callback(|_, _| {
        toggle();
    });
    match api::pumi_set_keymap("global", &key, rhs, json!({ "desc": "Toggle the performance overlay" })) {
        Ok(()) => BOUND.with(|bound| *bound.borrow_mut() = Some(key)),
        Err(err) => eprintln!("perf: {err}"),
    }
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    declare_option(
        "trigger",
        json!({ "type": "string", "default": "<D-M-p>", "label": "Trigger", "placeholder": "<D-M-p>", "desc": "The key that shows and hides the overlay, from anywhere. Cmd-Alt-P by default." }),
    );
    declare_option(
        "corner",
        json!({ "type": "string", "default": "NE", "choices": ["NE", "NW", "SE", "SW"], "labels": ["Top right", "Top left", "Bottom right", "Bottom left"], "label": "Corner", "desc": "The corner of the window it floats in." }),
    );

    plugin.view("overlay", |open, _window, cx| {
        let overlay = cx.new(|cx| {
            Overlay::tick(cx);
            Overlay::new(open.pane)
        });
        overlay.into()
    });

    let spec = json!({ "desc": "Show or hide the performance overlay; whether it is shown now.", "examples": [{ "args": [], "result": true }] });
    if let Err(err) = api::provide("perf.toggle", spec, |_| Ok(json!(toggle()))) {
        eprintln!("perf: {err}");
    }
    if let Err(err) = api::pumi_menu_add(
        "View.Performance Overlay",
        json!({ "call": "perf.toggle" }),
        json!({ "desc": "How the app is doing: CPU, memory, frames, core plugins, threads." }),
    ) {
        eprintln!("perf: {err}");
    }
    bind();
    let followed = api::autocmd("OptionSet", json!({ "pattern": "perf.*", "desc": "perf follows its options" }), |_, _| {
        bind();
        replace();
    });
    if let Err(err) = followed {
        eprintln!("perf: {err}");
    }
}

pumi_plugin::plugin!(init, api = 1);
