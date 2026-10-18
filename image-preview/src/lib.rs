use pumi_plugin::gpui::{self, ActiveTheme, Context, Place, Render, Window, WindowHandle, div, img, prelude::*, px};
use pumi_plugin::{Plugin, Value, runtime};

mod size;

const PAD: f32 = 4.;

struct Card {
    path: String,
    size: (f32, f32),
}

impl Render for Card {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (width, height) = self.size;
        div()
            .id("card")
            .class("image-preview")
            .p(px(PAD))
            .rounded_md()
            .border_1()
            .border_color(theme.border)
            .bg(theme.surface)
            .shadow_lg()
            .child(img(self.path.as_str()).w(px(width)).h(px(height)))
    }
}

struct Shown {
    key: (String, u64, String),
    window: WindowHandle<Card>,
}

struct Preview {
    shown: Option<Shown>,
}

fn limits() -> (f32, f32) {
    let settings = runtime::settings();
    let read = |key: &str, default: f64| settings[key].as_f64().filter(|n| *n >= 16.).unwrap_or(default) as f32;
    (read("max_width", 360.), read("max_height", 280.))
}

impl Preview {
    fn show(&mut self, payload: &Value) {
        let Some(path) = payload["path"].as_str() else { return };
        let key = (
            payload["pane_id"].as_str().unwrap_or_default().to_string(),
            payload["row"].as_u64().unwrap_or_default(),
            path.to_string(),
        );
        if self.shown.as_ref().is_some_and(|shown| shown.key == key) {
            return;
        }
        self.hide();
        let (max_width, max_height) = limits();
        let size = match size::of(std::path::Path::new(path)) {
            Some((width, height)) => match size::fit(width as f32, height as f32, max_width, max_height) {
                Some(size) => size,
                None => return,
            },
            None => (max_width, max_height),
        };
        let place = Place::popover(payload["anchor"].clone()).dismiss(["key", "scroll", "press"]);
        let path = path.to_string();
        let opened = gpui::app::update(|cx| cx.open_window(place, |_, cx| cx.new(|_| Card { path, size })));
        match opened {
            Ok(window) => self.shown = Some(Shown { key, window }),
            Err(err) => eprintln!("image-preview: {err}"),
        }
    }

    fn hide(&mut self) {
        if let Some(shown) = self.shown.take() {
            gpui::app::update(|cx| shown.window.close(cx));
        }
    }
}

impl Plugin for Preview {
    fn activate() -> Self {
        Preview { shown: None }
    }

    fn event(&mut self, topic: &str, payload: Value) {
        match topic {
            "terminal.match" if payload["matcher"] == "image" => match payload["trigger"].as_str() {
                Some("rest") => self.show(&payload),
                Some("left") => self.hide(),
                _ => {}
            },
            "ui.unmounted" => {
                if self.shown.as_ref().is_some_and(|s| payload["view"] == s.window.view()) {
                    self.shown = None;
                }
            }
            _ => {}
        }
    }
}

pumi_plugin::plugin!(Preview);
