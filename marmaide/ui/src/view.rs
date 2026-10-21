//! `marmaide.diagram`: one diagram, in the app's colours, fitted to the pane — and then moved and
//! zoomed like a canvas: drag it, scroll the wheel over it. Click a node to ask an agent about
//! it: a note goes with it to the agent's inbox, read with the next message the user sends it.
//!
//! The pane's Mermaid source lives in the option `marmaide.source` (pane-scoped), so it is what
//! `marmaide.draw` writes, what the view reads when it starts, and what survives a restart with
//! the layout. The SVG is rasterised here, at the size the pane wants (`raster`), and drawn as
//! an image: sharp while zooming in, because zooming asks for more pixels.

use pumi_plugin::gpui::{
    App, Bounds, ClickEvent, Context, CursorStyle, Entity, ImageSource, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, ObjectFit, PinchEvent, Pixels, Point, Render, RenderImage, ScrollDelta, ScrollWheelEvent, Size,
    Focusable, Subscription, Window, canvas, div, img, point, px, size,
};
use pumi_plugin::ui;
use pumi_plugin::prelude::*;
use pumi_plugin::ui::color;
use std::sync::Arc;

/// Room around the diagram, in points.
const PADDING: f32 = 12.;
/// How much one press of + or − changes the zoom.
const STEP: f32 = 1.25;
/// How much one notch of the wheel does: a trackpad's many small deltas add up to the same.
const WHEEL: f32 = 1.06;
/// A press that moves less than this, in points, is a click, not a drag.
const CLICK: f32 = 4.;
/// How much of the source goes to an agent with a node.
const SOURCE_LIMIT: usize = 4000;
/// The agents' inbox (the agents core plugin's `@agent_inbox`) and how much it keeps.
const INBOX: &str = "@agent_inbox";
const INBOX_LIMIT: usize = 20;
const SHELLS: [&str; 7] = ["zsh", "bash", "fish", "sh", "nu", "dash", "tcsh"];

/// A node the user clicked, and the note they are writing about it.
struct Asking {
    node: usize,
    input: Entity<ui::TextInput>,
    /// `(pane, label)`: the agents it can go to, those in this tab first.
    to: Vec<(u64, String)>,
    at: usize,
    _submitted: Subscription,
}

pub struct Diagram {
    source: String,
    kind: String,
    /// The diagram's own size, in points.
    size: (f32, f32),
    /// The SVG in the theme's colours, kept: zooming paints it again at more pixels.
    svg: Option<String>,
    fonts: Vec<String>,
    image: Option<Arc<RenderImage>>,
    /// The pixels-to-the-point the image was painted at, so it is not painted again for nothing.
    rastered: f32,
    /// 1 is fitted to the pane.
    zoom: f32,
    /// Points per pane point, from the last measure.
    fit: f32,
    /// The pane's room, as it was last drawn, and where it is in the window.
    bounds: Bounds<Pixels>,
    /// Where the diagram's top left corner is in that room: dragging moves it.
    pan: Point<Pixels>,
    /// Where the pointer went down, while it is down and moving the diagram.
    drag: Option<Point<Pixels>>,
    /// Where the pointer went down, to tell a click from a drag.
    down: Option<Point<Pixels>>,
    error: Option<String>,
    pane: u64,
    nodes: Vec<crate::nodes::Node>,
    asking: Option<Asking>,
    said: Option<String>,
}

impl Diagram {
    pub fn new(pane: u64, source: Option<String>, cx: &mut Context<Self>) -> Self {
        let mut diagram = Self {
            source: String::new(),
            kind: String::new(),
            size: (0., 0.),
            svg: None,
            fonts: Vec::new(),
            image: None,
            rastered: 0.,
            zoom: 1.,
            fit: 1.,
            bounds: Bounds::new(point(px(0.), px(0.)), size(px(0.), px(0.))),
            pan: point(px(0.), px(0.)),
            drag: None,
            down: None,
            error: None,
            pane,
            nodes: Vec::new(),
            asking: None,
            said: None,
        };
        // The pane's own option is the truth: `draw` sets it, and a pane coming back after a
        // restart has it. What the pane was opened with is the fallback.
        let stored = api::option("marmaide.source", json!({ "pane": pane, "scope": "pane" }))
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .filter(|source| !source.trim().is_empty());
        diagram.load(stored.or(source).unwrap_or_default(), cx);
        diagram
    }

    /// Draws `source`, or says why it cannot.
    pub fn load(&mut self, source: String, cx: &mut Context<Self>) {
        if source == self.source && (self.image.is_some() || self.error.is_some()) {
            return;
        }
        self.source = source;
        self.error = None;
        self.zoom = 1.;
        self.nodes.clear();
        self.asking = None;
        if self.source.trim().is_empty() {
            self.image = None;
            self.svg = None;
            self.error = Some("no diagram yet — `pumi call marmaide.draw '<mermaid>'`".to_string());
        } else {
            match crate::rendered(&self.source, true) {
                Ok(rendered) => {
                    self.kind = rendered.kind.clone();
                    self.size = (rendered.width, rendered.height);
                    self.svg = Some(rendered.svg.clone());
                    self.nodes = crate::nodes::nodes(&rendered.svg);
                    self.fonts = rendered.fonts.clone();
                    self.paint(cx);
                }
                Err(err) => {
                    self.image = None;
                    self.svg = None;
                    let first = self.source.lines().next().unwrap_or_default().to_string();
                    self.error = Some(format!("{}: {}", err.message, first));
                }
            }
        }
        self.centre();
        cx.notify();
    }

    /// The pane's room, as it was last drawn: what fitting is measured against.
    fn measured(&mut self, bounds: Bounds<Pixels>, cx: &mut Context<Self>) {
        let before = self.bounds.size;
        let changed = (f32::from(bounds.size.width) - f32::from(before.width)).abs() > 0.5
            || (f32::from(bounds.size.height) - f32::from(before.height)).abs() > 0.5;
        self.bounds = bounds;
        if !changed {
            return;
        }
        self.fit = self.fit_for(bounds.size);
        // A pane that grows or shrinks puts the diagram back in the middle of itself; a diagram
        // dragged off centre is only off centre at the size it was dragged at.
        self.centre();
        self.paint(cx);
        cx.notify();
    }

    fn fit_for(&self, room: Size<Pixels>) -> f32 {
        let (width, height) = self.size;
        if width <= 0. || height <= 0. {
            return 1.;
        }
        let across = f32::from(room.width) - PADDING * 2.;
        let down = f32::from(room.height) - PADDING * 2.;
        // A small diagram is not blown up past twice its size: it is a diagram, not a poster.
        (across.max(1.) / width).min(down.max(1.) / height).clamp(0.02, 2.)
    }

    /// Paints the SVG at the pixels the pane is about to want.
    fn paint(&mut self, cx: &App) {
        let Some(svg) = self.svg.clone() else { return };
        let scale = (self.fit * self.zoom * 2.).clamp(0.25, 6.);
        if self.image.is_some() && (scale - self.rastered).abs() < self.rastered * 0.3 {
            return;
        }
        match crate::raster::rasterize(&svg, &self.fonts, scale, &crate::theme::background()) {
            Some(image) => {
                self.image = Some(image);
                self.rastered = scale;
                self.error = None;
            }
            None => {
                self.image = None;
                self.error = Some("marmaide: the SVG Pele drew could not be painted".to_string());
            }
        }
        let _ = cx;
    }

    /// What is drawn, in points.
    fn shown(&self) -> (f32, f32) {
        if self.image.is_none() {
            return (0., 0.);
        }
        (self.size.0 * self.fit * self.zoom, self.size.1 * self.fit * self.zoom)
    }

    /// Puts the diagram in the middle of the pane.
    fn centre(&mut self) {
        let (width, height) = self.shown();
        let room = self.bounds.size;
        self.pan = point(
            px((f32::from(room.width) - width) * 0.5),
            px((f32::from(room.height) - height) * 0.5),
        );
    }

    /// Zooms, keeping what is under `at` (a point in the pane's room) under it.
    fn zoom_at(&mut self, factor: f32, at: Option<Point<Pixels>>, cx: &mut Context<Self>) {
        let before = self.zoom;
        self.zoom = (self.zoom * factor).clamp(0.05, 12.);
        if (self.zoom - before).abs() < f32::EPSILON {
            return;
        }
        let anchor = at.unwrap_or_else(|| {
            point(px(f32::from(self.bounds.size.width) * 0.5), px(f32::from(self.bounds.size.height) * 0.5))
        });
        let grown = self.zoom / before;
        let (ax, ay) = (f32::from(anchor.x), f32::from(anchor.y));
        let (left, top) = (f32::from(self.pan.x), f32::from(self.pan.y));
        self.pan = point(px(ax - (ax - left) * grown), px(ay - (ay - top) * grown));
        self.paint(cx);
        cx.notify();
    }

    fn fit(&mut self, cx: &mut Context<Self>) {
        self.zoom = 1.;
        self.centre();
        self.paint(cx);
        cx.notify();
    }

    /// The node under a point of the pane's room.
    fn node_at(&self, at: Point<Pixels>) -> Option<usize> {
        let scale = self.fit * self.zoom;
        if self.image.is_none() || scale <= 0. {
            return None;
        }
        let x = (f32::from(at.x) - f32::from(self.pan.x)) / scale;
        let y = (f32::from(at.y) - f32::from(self.pan.y)) / scale;
        crate::nodes::at(&self.nodes, x, y)
    }

    fn clicked(&mut self, at: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(node) = self.node_at(at) else {
            self.asking = None;
            return cx.notify();
        };
        let to = agents(self.pane);
        if to.is_empty() {
            self.said = Some("no agent is running in a pane (with pumi's hook) to ask".into());
            return cx.notify();
        }
        let label = &self.nodes[node].label;
        let input = cx.new(|cx| ui::TextInput::new("", format!("Ask about “{label}”… (Enter sends)"), window, cx).compact());
        let submitted = cx.subscribe_in(&input, window, |this, input, event: &ui::InputEvent, window, cx| {
            // Enter submits, and so does leaving the field: only Enter sends.
            if let ui::InputEvent::Submitted(_) = event
                && input.focus_handle(cx).is_focused(window)
            {
                this.send(cx);
            }
        });
        let focus = input.focus_handle(cx);
        window.focus(&focus, cx);
        self.asking = Some(Asking { node, input, to, at: 0, _submitted: submitted });
        self.said = None;
        cx.notify();
    }

    fn send(&mut self, cx: &mut Context<Self>) {
        let Some(asking) = self.asking.take() else { return };
        let Some((to, label)) = asking.to.get(asking.at).cloned() else { return };
        let node = &self.nodes[asking.node];
        let note = asking.input.read(cx).text().trim().to_string();
        let mut source = self.source.clone();
        if source.len() > SOURCE_LIMIT {
            let mut end = SOURCE_LIMIT;
            while !source.is_char_boundary(end) {
                end -= 1;
            }
            source.truncate(end);
            source.push_str("\n…");
        }
        let what = format!(
            "node `{}` (“{}”) of this {} diagram:\n```mermaid\n{}\n```",
            node.id, node.label, self.kind, source
        );
        let attachment = json!({ "from": "marmaide", "pane": format!("%{}", self.pane), "what": what, "note": note });
        let target = json!({ "pane": to });
        let mut inbox: Vec<Value> = api::pumi_get_option_value(INBOX, target.clone())
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        inbox.push(attachment);
        let extra = inbox.len().saturating_sub(INBOX_LIMIT);
        inbox.drain(..extra);
        self.said = Some(match api::pumi_set_option_value(INBOX, Value::Array(inbox), target) {
            Ok(()) => format!("sent to {label}: it sees it with your next message"),
            Err(err) => format!("{label}: {err}"),
        });
        cx.notify();
    }

    fn caption(&self) -> String {
        if self.kind.is_empty() {
            "marmaide".to_string()
        } else {
            format!(
                "{} · {:.0}×{:.0} · drag to move, scroll to zoom, click a node to ask an agent",
                self.kind, self.size.0, self.size.1
            )
        }
    }
}

impl Render for Diagram {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let image = self.image.clone();
        let error = self.error.clone();
        let caption = self.caption();
        let percent = format!("{:.0}%", self.zoom * 100.);
        let pan = self.pan;
        let dragging = self.drag.is_some();
        let muted = color::muted_foreground();
        let measuring = cx.entity().downgrade();
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .id("marmaide-canvas")
                    .relative()
                    .flex_1()
                    .w_full()
                    .overflow_hidden()
                    .when(dragging, |this| this.cursor(CursorStyle::ClosedHand))
                    .when(!dragging, |this| this.cursor(CursorStyle::OpenHand))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseDownEvent, _window, cx| {
                            if event.click_count >= 2 {
                                this.fit(cx);
                                return;
                            }
                            this.drag = Some(event.position);
                            this.down = Some(event.position);
                        }),
                    )
                    .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _window, cx| {
                        let Some(from) = this.drag else { return };
                        if event.pressed_button.is_none() {
                            this.drag = None;
                            return;
                        }
                        this.pan = point(
                            this.pan.x + (event.position.x - from.x),
                            this.pan.y + (event.position.y - from.y),
                        );
                        this.drag = Some(event.position);
                        cx.notify();
                    }))
                    .on_mouse_up(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseUpEvent, window, cx| {
                            this.drag = None;
                            let Some(down) = this.down.take() else { return };
                            let moved = (f32::from(event.position.x - down.x)).hypot(f32::from(event.position.y - down.y));
                            if moved < CLICK {
                                let room = this.bounds.origin;
                                this.clicked(point(event.position.x - room.x, event.position.y - room.y), window, cx);
                            }
                        }),
                    )
                    .on_mouse_up_out(
                        MouseButton::Left,
                        cx.listener(|this, _: &MouseUpEvent, _window, _cx| this.drag = None),
                    )
                    .on_scroll_wheel(cx.listener(|this, event: &ScrollWheelEvent, _window, cx| {
                        let turn = match event.delta {
                            ScrollDelta::Lines(delta) => delta.y,
                            ScrollDelta::Pixels(delta) => f32::from(delta.y),
                        };
                        if turn == 0. {
                            return;
                        }
                        let room = this.bounds.origin;
                        let at = Some(point(event.position.x - room.x, event.position.y - room.y));
                        this.zoom_at(WHEEL.powf(turn.clamp(-4., 4.)), at, cx);
                    }))
                    // A trackpad pinch: the app forwards it, the plugin's gpui says how much.
                    .on_pinch(cx.listener(|this, event: &PinchEvent, _window, cx| {
                        let room = this.bounds.origin;
                        let at = Some(point(event.position.x - room.x, event.position.y - room.y));
                        this.zoom_at((1. + event.delta).clamp(0.5, 2.), at, cx);
                    }))
                    .when_some(image, |this, image| {
                        let (width, height) = self.shown();
                        this.child(
                            div()
                                .absolute()
                                .left(pan.x)
                                .top(pan.y)
                                .w(px(width.max(1.)))
                                .h(px(height.max(1.)))
                                .child(img(ImageSource::Render(image)).size_full().object_fit(ObjectFit::Fill)),
                        )
                    })
                    .when_some(self.asking.as_ref().map(|a| a.node), |this, node| {
                        let n = &self.nodes[node];
                        let scale = self.fit * self.zoom;
                        this.child(
                            div()
                                .absolute()
                                .left(pan.x + px(n.x * scale - 3.))
                                .top(pan.y + px(n.y * scale - 3.))
                                .w(px(n.w * scale + 6.))
                                .h(px(n.h * scale + 6.))
                                .rounded(px(5.))
                                .border_2()
                                .border_color(color::ring()),
                        )
                    })
                    .when_some(error, |this, error| {
                        this.child(
                            div()
                                .absolute()
                                .size_full()
                                .flex()
                                .flex_col()
                                .items_center()
                                .justify_center()
                                .p_4()
                                .gap_1()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(color::danger())
                                        .child(error.lines().next().unwrap_or_default().to_string()),
                                )
                                .child(
                                    div()
                                        .text_xs()
                                        .text_color(muted)
                                        .child("marmaide draws Mermaid with Pele: `pumi call marmaide.draw '<mermaid>'`."),
                                ),
                        )
                    })
                    .child(
                        canvas(
                            move |bounds, _window, cx| {
                                let _ = measuring.update(cx, |this, cx| this.measured(bounds, cx));
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    ),
            )
            .when_some(self.asking.as_ref().map(|a| (a.input.clone(), a.to.get(a.at).map(|t| t.1.clone()), a.to.len())), |this, (input, to, many)| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .px_2()
                        .py_1()
                        .border_t_1()
                        .border_color(color::border())
                        .child(
                            div()
                                .id("marmaide-to")
                                .flex_none()
                                .text_xs()
                                .text_color(color::ring())
                                .when(many > 1, |d| d.cursor_pointer())
                                .child(format!("To {}{}", to.unwrap_or_default(), if many > 1 { " ⇄" } else { "" }))
                                .on_click(cx.listener(|this, _: &ClickEvent, _window, cx| {
                                    if let Some(a) = this.asking.as_mut() {
                                        a.at = (a.at + 1) % a.to.len().max(1);
                                        cx.notify();
                                    }
                                })),
                        )
                        .child(div().flex_1().child(input))
                        .child(control("send", cx.listener(|this, _: &ClickEvent, _window, cx| this.send(cx))))
                        .child(control("×", cx.listener(|this, _: &ClickEvent, _window, cx| {
                            this.asking = None;
                            cx.notify();
                        }))),
                )
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_2()
                    .py_1()
                    .border_t_1()
                    .border_color(color::border())
                    .child(div().text_xs().text_color(muted).child(self.said.clone().unwrap_or(caption)))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(control("−", cx.listener(|this, _: &ClickEvent, _window, cx| {
                                this.zoom_at(1. / STEP, None, cx);
                            })))
                            .child(div().text_xs().text_color(muted).child(percent))
                            .child(control("+", cx.listener(|this, _: &ClickEvent, _window, cx| {
                                this.zoom_at(STEP, None, cx);
                            })))
                            .child(control("fit", cx.listener(|this, _: &ClickEvent, _window, cx| {
                                this.fit(cx);
                            }))),
                    ),
            )
    }
}

/// The agents a node can be sent to: panes an agent's hook marked (`@agent`) whose program is
/// not a shell again, those in `pane`'s tab first.
fn agents(pane: u64) -> Vec<(u64, String)> {
    let tab_of = |p: u64| api::pumi_pane_get_place(p).ok().map(|place| place["tab"].clone());
    let here = tab_of(pane);
    let ids: Vec<u64> = api::pumi_list_panes(json!({}))
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_u64)
        .collect();
    let mut found: Vec<(bool, u64, String)> = ids
        .into_iter()
        .filter_map(|id| {
            let at = json!({ "pane": id });
            let agent = api::pumi_get_option_value("@agent", at.clone()).ok()?.as_str()?.to_string();
            let command = api::pumi_get_option_value("pane_current_command", at).ok();
            let command = command.as_ref().and_then(Value::as_str).unwrap_or_default();
            (!agent.is_empty() && !SHELLS.contains(&command)).then(|| (tab_of(id) != here, id, format!("{agent} %{id}")))
        })
        .collect();
    found.sort_by_key(|(elsewhere, ..)| *elsewhere);
    found.into_iter().map(|(_, id, label)| (id, label)).collect()
}

/// A small button of the footer's own: pumi-ui's buttons are for forms, not for a caption row.
fn control(label: &str, on: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> impl IntoElement {
    div()
        .id(format!("marmaide-{label}"))
        .px_1()
        .text_xs()
        .text_color(color::muted_foreground())
        .cursor_pointer()
        .hover(|this| this.text_color(color::foreground()))
        .on_click(on)
        .child(label.to_string())
}
