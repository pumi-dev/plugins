//! The app's theme, said the way Pele's SVG says it.
//!
//! Pele colours a diagram with CSS custom properties (`--pele-fg`, `--pele-surface`, …), which
//! a browser inherits from the page it sits in. A diagram drawn here is not in a page, so the
//! app's own colours are handed over instead: `render.mjs` resolves them into the SVG, and the
//! rasteriser paints what a browser would.
//!
//! The fills and lines are mixed from the theme's background and text rather than taken from
//! tokens of the same name: a theme is free to paint a surface almost the colour of its
//! background, and a diagram of invisible boxes is no diagram.

use pumi_plugin::gpui::Rgba;
use pumi_plugin::ui::color;
use pumi_plugin::Value;
use serde_json::json;

/// A colour as CSS says one: `#rrggbb`, or `rgba(…)` when it is not opaque.
fn css(colour: Rgba) -> String {
    let (r, g, b) = (
        (colour.r.clamp(0., 1.) * 255.).round() as u8,
        (colour.g.clamp(0., 1.) * 255.).round() as u8,
        (colour.b.clamp(0., 1.) * 255.).round() as u8,
    );
    if colour.a >= 0.999 {
        format!("#{r:02x}{g:02x}{b:02x}")
    } else {
        format!("rgba({r}, {g}, {b}, {:.3})", colour.a.clamp(0., 1.))
    }
}

/// `t` of the way from `from` to `to`, alpha included.
fn mix(from: Rgba, to: Rgba, t: f32) -> Rgba {
    let t = t.clamp(0., 1.);
    Rgba {
        r: from.r + (to.r - from.r) * t,
        g: from.g + (to.g - from.g) * t,
        b: from.b + (to.b - from.b) * t,
        a: from.a + (to.a - from.a) * t,
    }
}

/// The pane's own colour, which a diagram is painted on.
pub fn background() -> String {
    css(color::background())
}

/// Every variable Pele reads, from the theme the app is wearing.
pub fn vars() -> Value {
    let background = color::background();
    let text = color::foreground();
    json!({
        "--pele-bg": css(background),
        "--pele-fg": css(text),
        "--pele-muted": css(mix(background, text, 0.62)),
        "--pele-line": css(mix(background, text, 0.58)),
        "--pele-surface": css(mix(background, text, 0.08)),
        "--pele-surface-alt": css(mix(background, text, 0.15)),
        "--pele-border": css(mix(background, text, 0.32)),
        "--pele-accent": css(color::primary()),
        "--pele-radius": format!("{}px", color::radius_sm()),
        "--pele-font": font(),
        "--pele-font-mono": mono(),
    })
}

fn option(key: &str) -> Option<Value> {
    pumi_plugin::api::option(&format!("marmaide.{key}"), json!({})).ok()
}

fn named(key: &str) -> Option<String> {
    option(key).and_then(|value| value.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
}

/// What a diagram's text is set in: the faces the package ships, which `render.mjs` puts where
/// the rasteriser can read them. A theme's font name would name a face nobody has.
pub fn font() -> String {
    named("font").unwrap_or_else(|| "IBM Plex Sans".to_string())
}

pub fn mono() -> String {
    named("font_mono").unwrap_or_else(|| "IBM Plex Mono".to_string())
}

pub fn font_size() -> f64 {
    option("font_size").and_then(|value| value.as_f64()).unwrap_or(16.)
}
