//! `marmaide`: Mermaid in a pane, drawn by [Pele](https://pele.run) — kepano's renderer, the
//! small synchronous one Obsidian draws with.
//!
//! Pele is JavaScript, and a component is wasm: this plugin keeps the renderer where it
//! belongs and asks it, over a pipe. `render.mjs` (beside this crate, in the package) is run
//! by `bun` or `node`, one JSON request on stdin, one JSON answer on stdout; the answer's
//! SVG is rasterised inside the plugin by gpui's own SVG renderer (`resvg`) and drawn in a
//! pane as an image, so it is coloured and sharp at any size.
//!
//! Everything an agent needs is a provided function — `marmaide.draw`, `marmaide.render`,
//! `marmaide.save`, reachable as `pumi call marmaide.draw …`:
//!
//! - `marmaide.draw {source}` renders the diagram and shows it in a pane beside this one,
//!   answering `{pane, type, width, height}`. Called again with a `pane`, it redraws that
//!   pane in place — the source is kept on the pane as the option `marmaide.source`, so a
//!   layout that comes back after a restart draws its diagram again.
//! - `marmaide.render {source}` answers Pele's own SVG (CSS variables and all: themeable
//!   anywhere), with the diagram's type and size.
//! - `marmaide.save {source, path}` writes that SVG to a file and answers its path.
//!
//! A diagram is drawn in the app's colours: the theme's tokens become Pele's `--pele-*`
//! variables, which `render.mjs` resolves into the SVG (a rasteriser knows no custom
//! properties). The view follows the theme as it follows its source — an option it is sent.

use pumi_plugin::prelude::*;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

mod nodes;
mod raster;
mod render;
mod theme;
mod view;

use render::Rendered;

const NAME: &str = "marmaide";
/// The option a diagram pane keeps its Mermaid source in. Declared `pane`-scoped, so a pane
/// can have its own: redrawing is setting it, and it survives a restart with the layout.
const SOURCE: &str = "marmaide.source";

thread_local! {
    /// What has been drawn, by source: the view is handed the same rendering `draw` answered
    /// with instead of asking Pele again, and a redrawn pane costs nothing until it changes.
    static DRAWN: RefCell<HashMap<String, Rc<Rendered>>> = RefCell::new(HashMap::new());
}

/// Pele's rendering of `source`, from the cache when it is there. `themed` resolves the
/// theme's colours into the SVG, which is what the rasteriser needs; without it the SVG keeps
/// Pele's `--pele-*` variables, which is what a file or another page wants.
pub fn rendered(source: &str, themed: bool) -> Result<Rc<Rendered>, api::Error> {
    let key = if themed { format!("t:{source}") } else { format!("r:{source}") };
    if let Some(hit) = DRAWN.with(|drawn| drawn.borrow().get(&key).cloned()) {
        return Ok(hit);
    }
    let made = Rc::new(render::run(source, themed)?);
    DRAWN.with(|drawn| {
        let mut drawn = drawn.borrow_mut();
        if drawn.len() >= 64 {
            drawn.clear();
        }
        drawn.insert(key, made.clone());
    });
    Ok(made)
}

/// The Mermaid text a call is about: `source`, or a `path` to read it from.
fn source_of(args: &Value) -> Result<String, api::Error> {
    if let Some(source) = args.get("source").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        return Ok(source.to_string());
    }
    let path = args.get("path").and_then(Value::as_str).filter(|p| !p.is_empty());
    let Some(path) = path else {
        return Err(api::Error::new("invalid_params", "give a diagram: `source` (Mermaid text) or `path`"));
    };
    std::fs::read_to_string(path)
        .map_err(|err| api::Error::new("not_found", format!("{path}: {err}")))
}

/// Shows a diagram: opens a pane of this package's view, or redraws one it is given.
fn draw(args: &Value) -> Result<Value, api::Error> {
    let source = source_of(args)?;
    let rendered = rendered(&source, true)?;
    let place = args.get("place").cloned().filter(Value::is_object).unwrap_or_else(|| {
        let beside = api::pumi_get_current_pane().unwrap_or(0);
        json!({ "kind": "tiled", "beside": beside, "split": "right", "size": "45%" })
    });
    let opening = args.get("pane").and_then(Value::as_u64).is_none();
    let pane = match args.get("pane").and_then(Value::as_u64) {
        Some(pane) => pane,
        None => {
            let title = args.get("title").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| rendered.kind.clone());
            let args = json!({ "source": source });
            let open = api::pumi_open_pane(&format!("{NAME}.diagram"), args, place);
            match open {
                Ok(pane) => {
                    let _ = api::set_option("title", json!(title), json!({ "pane": pane }));
                    let _ = api::set_option("@icon", json!("package"), json!({ "pane": pane }));
                    pane
                }
                Err(err) => {
                    return Err(api::Error::new(&err.kind, format!("no pane for the diagram: {}", err.message)));
                }
            }
        }
    };
    // The view of that pane reads this, now and after a restart; setting it is what tells it
    // to draw again.
    api::set_option(SOURCE, json!(source), json!({ "pane": pane, "scope": "pane" }))?;
    Ok(json!({
        "pane": pane,
        "type": rendered.kind,
        "width": rendered.width,
        "height": rendered.height,
        "opened": opening,
    }))
}

fn save(args: &Value) -> Result<Value, api::Error> {
    let source = source_of(args)?;
    let Some(path) = args.get("path").and_then(Value::as_str).filter(|p| !p.is_empty()) else {
        return Err(api::Error::new("invalid_params", "`save` needs a `path` to write"));
    };
    if let Some(dir) = std::path::Path::new(path).parent().filter(|d| !d.as_os_str().is_empty()) {
        let _ = std::fs::create_dir_all(dir);
    }
    // A PNG is what the pane draws, at the scale asked for: the theme's colours, painted.
    if path.to_ascii_lowercase().ends_with(".png") {
        let scale = args.get("scale").and_then(Value::as_f64).unwrap_or(2.) as f32;
        let rendered = rendered(&source, true)?;
        let image = raster::rasterize(&rendered.svg, &rendered.fonts, scale, &theme::background())
            .ok_or_else(|| api::Error::new("paint", "the diagram could not be painted"))?;
        let size = image.size(0);
        let (width, height) = (size.width.0.max(1) as u32, size.height.0.max(1) as u32);
        let pixels = image::RgbaImage::from_raw(width, height, image.as_bytes(0).unwrap_or_default().to_vec())
            .ok_or_else(|| api::Error::new("paint", "the diagram's pixels were the wrong size"))?;
        pixels.save(path).map_err(|err| api::Error::new("io", format!("{path}: {err}")))?;
        return Ok(json!({ "path": path, "type": rendered.kind, "width": width, "height": height }));
    }
    if !path.to_ascii_lowercase().ends_with(".svg") {
        return Err(api::Error::new("invalid_params", "marmaide writes `.svg` (themeable anywhere) or `.png`"));
    }
    let rendered = rendered(&source, false)?;
    std::fs::write(path, rendered.svg.as_bytes()).map_err(|err| api::Error::new("io", format!("{path}: {err}")))?;
    Ok(json!({ "path": path, "type": rendered.kind, "width": rendered.width, "height": rendered.height }))
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    declare(
        "runtime",
        json!({
            "type": "string", "default": "", "label": "JavaScript runtime", "placeholder": "bun",
            "desc": "The program that runs Pele. Empty finds `bun`, then `node`.",
        }),
    );
    declare(
        "font",
        json!({
            "type": "string", "default": "", "label": "Font", "placeholder": "IBM Plex Sans",
            "desc": "The diagram's text. Empty is the face this package ships, IBM Plex Sans.",
        }),
    );
    declare(
        "font_mono",
        json!({
            "type": "string", "default": "", "label": "Monospace font", "placeholder": "IBM Plex Mono",
            "desc": "What a diagram's code and constants are set in. Empty is IBM Plex Mono, shipped beside it.",
        }),
    );
    declare(
        "font_size",
        json!({
            "type": "number", "default": 16, "min": 8, "max": 32, "step": 1, "unit": "px",
            "label": "Font size", "desc": "Pele lays a diagram out at this size.",
        }),
    );
    // Per pane: `marmaide.draw` writes it, the pane's view reads it. It is an option so the
    // view can be told to draw again, and so a layout that survives a restart brings its
    // diagram back with it.
    declare(
        "source",
        json!({
            "type": "string", "default": "", "scope": "pane",
            "label": "Diagram source", "desc": "The Mermaid text this diagram pane draws.",
        }),
    );

    plugin.view("diagram", |open, _window, cx| {
        let pane = open.pane;
        let source = open.args.get("source").and_then(Value::as_str).map(str::to_string);
        let diagram = cx.new(|cx| view::Diagram::new(pane, source, cx));
        // The source is the pane's to change: whoever sets it, this draws it.
        let weak = diagram.downgrade();
        if let Err(err) = api::autocmd(
            "OptionSet",
            json!({ "pattern": SOURCE, "desc": "marmaide draws a diagram as its source changes" }),
            move |event, cx| {
                let data = &event["data"];
                if data["scope"] != "pane" || data["id"].as_u64() != Some(pane) {
                    return;
                }
                let source = data["new"].as_str().unwrap_or_default().to_string();
                let _ = weak.update(cx, |diagram, cx| diagram.load(source, cx));
            },
        ) {
            eprintln!("marmaide: {err}");
        }
        diagram.into()
    });


    // `pumi call marmaide.draw …`: an agent's pen.
    let draw_spec = json!({
        "desc": "Draw a Mermaid diagram in a pane: one opens beside this pane, or the one `pane` names is redrawn. Answers where it is.",
        "parameters": [["string", "source"], ["table", "opts"]],
        "examples": [
            { "args": ["flowchart LR\n  ask --> draw --> look"], "desc": "Show a flowchart beside this pane." },
            { "args": [{ "source": "sequenceDiagram\n  A->>B: hi", "pane": 7 }], "desc": "Redraw pane 7 with another diagram." },
            { "args": [{ "path": "diagram.mmd", "title": "How it works" }], "desc": "Draw the Mermaid in a file." },
        ],
        "notes": ["Mermaid's flowchart, sequence, class, state, ER, gantt, pie, mindmap, timeline and the rest of Mermaid 12 are Pele's to draw."],
    });
    if let Err(err) = api::provide(&format!("{NAME}.draw"), draw_spec, |args| draw(&args)) {
        eprintln!("marmaide: {err}");
    }
    let render_spec = json!({
        "desc": "Pele's SVG for a Mermaid diagram: CSS variables and all, so it themes wherever it is put. Nothing is shown.",
        "parameters": [["string", "source"]],
        "examples": [{ "args": ["flowchart LR\n  a --> b"], "desc": "Answers {svg, type, width, height}." }],
    });
    if let Err(err) = api::provide(&format!("{NAME}.render"), render_spec, |args| {
        let source = source_of(&args)?;
        let rendered = rendered(&source, false)?;
        Ok(json!({
            "svg": rendered.svg,
            "type": rendered.kind,
            "width": rendered.width,
            "height": rendered.height,
        }))
    }) {
        eprintln!("marmaide: {err}");
    }
    let save_spec = json!({
        "desc": "Write a diagram to a file, answering its path: `.svg` is Pele's own (themeable anywhere), `.png` is the picture the pane draws, in the app's colours.",
        "parameters": [["string", "source"], ["string", "path"]],
        "examples": [
            { "args": ["flowchart LR\n  a --> b", "diagram.svg"] },
            { "args": [{ "source": "sequenceDiagram\n  A->>B: hi", "path": "diagram.png", "scale": 3 }], "desc": "Three pixels to the point." },
        ],
    });
    if let Err(err) = api::provide(&format!("{NAME}.save"), save_spec, |args| save(&args)) {
        eprintln!("marmaide: {err}");
    }
}

fn declare(key: &str, spec: Value) {
    if let Err(err) = api::pumi_create_option(&format!("{NAME}.{key}"), spec) {
        eprintln!("marmaide: {NAME}.{key}: {err}");
    }
}

pumi_plugin::plugin!(init, api = 1);
