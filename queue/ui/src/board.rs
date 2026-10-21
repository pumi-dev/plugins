//! A bar under one pane: the jobs that pane waits for, and the one running in it — a title, then
//! a row a job, in the order they will run. It draws as many rows as the app gave it: one is the
//! whole queue in a line, more is the list (`@rows`, 06 §1).

use std::time::Duration;

use pumi_plugin::gpui::{AnyElement, ClickEvent, Rgba, WeakEntity};
use pumi_plugin::prelude::*;
use pumi_plugin::ui::color;

use crate::job::{Job, State};

/// A row of the bar, in pixels: a `chrome.regions` bar's row is 24, and so is a winbar's.
const ROW: f32 = 24.;
/// What the rows are drawn inside: the bar's own padding, top and bottom.
const PAD: f32 = 4.;

pub struct Board {
    /// The pane it is under.
    owner: u64,
}

impl Board {
    pub fn new(owner: u64, cx: &mut Context<Self>) -> Self {
        Self::tick(cx);
        Board { owner }
    }

    /// Look at the panes the queue waits for twice a second while it has work, and now and then
    /// when it has none: the clock on a running job, and the panes that never fired an event.
    fn tick(cx: &mut Context<Self>) {
        cx.spawn(async move |board: WeakEntity<Board>, cx| {
            loop {
                let wait = if crate::busy() { 500 } else { 2_000 };
                cx.background_executor()
                    .timer(Duration::from_millis(wait))
                    .await;
                let Ok(()) = board.update(cx, |_, cx| {
                    crate::advance();
                    cx.notify();
                }) else {
                    break;
                };
            }
        })
        .detach();
    }
}

impl Render for Board {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let now = crate::now_ms();
        let height = f32::from(pumi_plugin::view_size(window).height);
        let rows = (((height - PAD) / ROW).floor() as usize).max(1);
        let jobs = crate::jobs_of(self.owner);
        let mut column = div()
            .vcol()
            .size_full()
            .px(px(10.))
            .py(px(PAD / 2.))
            .overflow_hidden();
        if rows == 1 {
            // The app has one row for it: the whole queue in a line.
            return column.child(line(&jobs, now));
        }
        column = column.child(title(&jobs));
        let room = rows - 1;
        let shown = if jobs.len() > room {
            room.saturating_sub(1)
        } else {
            jobs.len()
        };
        for job in jobs.iter().take(shown) {
            column = column.child(row(job, now, cx));
        }
        if jobs.len() > shown {
            column = column.child(more(jobs.len() - shown));
        }
        column
    }
}

/// The one line a bar with a single row draws: the job that matters, and what is behind it.
fn line(jobs: &[Job], now: u64) -> AnyElement {
    let Some(job) = jobs
        .iter()
        .find(|job| job.state.running())
        .or_else(|| jobs.first())
    else {
        return div().h(px(ROW)).into_any_element();
    };
    let (glyph, tint) = mark(job);
    let behind = jobs.len().saturating_sub(1);
    div()
        .hrow()
        .h(px(ROW))
        .w_full()
        .gap_2()
        .child(div().w(px(12.)).flex_none().text(10.5, tint).child(glyph))
        .child(
            div()
                .fill()
                .text(11., color::foreground())
                .child(SharedString::from(job.label.clone())),
        )
        .when(behind > 0, |row| {
            row.child(
                div()
                    .flex_none()
                    .text(10., color::muted_foreground())
                    .child(SharedString::from(format!("+{behind}"))),
            )
        })
        .child(
            div()
                .flex_none()
                .text(10., color::muted_foreground())
                .child(SharedString::from(job.detail(now))),
        )
        .into_any_element()
}

fn title(jobs: &[Job]) -> AnyElement {
    let running = jobs.iter().filter(|job| job.state.running()).count();
    let waiting = jobs
        .iter()
        .filter(|job| job.state == State::Waiting)
        .count();
    let mut parts = Vec::new();
    if running > 0 {
        parts.push(format!("{running} running"));
    }
    if waiting > 0 {
        parts.push(format!("{waiting} waiting"));
    }
    let summary = match parts.is_empty() {
        true => format!("{} over", jobs.len()),
        false => parts.join(" · "),
    };
    div()
        .hrow()
        .h(px(ROW))
        .w_full()
        .gap_2()
        .child(
            div()
                .flex_none()
                .text(10.5, color::muted_foreground())
                .child("queue"),
        )
        .child(
            div()
                .fill()
                .text(10.5, color::muted_foreground().opacity(0.75))
                .child(SharedString::from(summary)),
        )
        .into_any_element()
}

fn mark(job: &Job) -> (&'static str, Rgba) {
    match &job.state {
        State::Running { .. } => ("▶", color::primary()),
        State::Waiting => ("·", color::muted_foreground().opacity(0.5)),
        State::Done {
            status: Some(0), ..
        } => ("✓", color::success()),
        State::Done { .. } => ("✗", color::danger()),
        State::Failed { .. } => ("✗", color::danger()),
        State::Cancelled => ("×", color::muted_foreground().opacity(0.5)),
    }
}

fn row(job: &Job, now: u64, cx: &mut Context<Board>) -> AnyElement {
    let (glyph, tint) = mark(job);
    let foreground = match job.state {
        State::Cancelled => color::muted_foreground().opacity(0.6),
        _ => color::foreground(),
    };
    // A row is a way to its pane: the one it runs in, the one it waits for, or the one it opened.
    let pane = match &job.state {
        State::Running {
            pane: Some(pane), ..
        } => Some(*pane),
        _ => job.opened.or(job.after.map(|(pane, _)| pane)),
    };
    let detail = match &job.state {
        State::Done { .. } | State::Failed { .. } if !job.tail.is_empty() => {
            format!("{} · {}", job.detail(now), job.tail)
        }
        _ => job.detail(now),
    };
    let cancellable = job.state == State::Waiting;
    let id = job.id;
    div()
        .id(SharedString::from(format!("queue-job-{id}")))
        .hrow()
        .h(px(ROW))
        .w_full()
        .gap_2()
        .px(px(2.))
        .rounded(px(4.))
        .cursor_pointer()
        .hover(|row| row.bg(color::list_hover()))
        .on_click(cx.listener(move |_: &mut Board, _: &ClickEvent, _, cx| {
            if let Some(pane) = pane {
                let _ = api::pumi_set_current_pane(pane);
            }
            cx.stop_propagation();
        }))
        .child(div().w(px(12.)).flex_none().text(10.5, tint).child(glyph))
        .child(
            div()
                .fill()
                .text(11., foreground)
                .child(SharedString::from(job.label.clone())),
        )
        .child(
            div()
                .flex_none()
                .text(10., color::muted_foreground())
                .child(SharedString::from(detail)),
        )
        .when(cancellable, |row| row.child(cancel(id, cx)))
        .into_any_element()
}

fn more(count: usize) -> AnyElement {
    div()
        .hrow()
        .h(px(ROW))
        .w_full()
        .px(px(2.))
        .child(
            div()
                .fill()
                .text(10., color::muted_foreground())
                .child(SharedString::from(format!(
                    "+{count} more · pumi call queue.list"
                ))),
        )
        .into_any_element()
}

fn cancel(id: u64, cx: &mut Context<Board>) -> AnyElement {
    div()
        .id(SharedString::from(format!("queue-cancel-{id}")))
        .flex_none()
        .px(px(4.))
        .rounded(px(3.))
        .text(10., color::muted_foreground())
        .hover(|button| button.bg(color::border()))
        .on_click(cx.listener(move |_: &mut Board, _: &ClickEvent, _, cx| {
            crate::cancel_job(id);
            cx.notify();
            cx.stop_propagation();
        }))
        .child("✕")
        .into_any_element()
}
