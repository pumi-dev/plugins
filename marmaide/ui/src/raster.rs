//! Pele draws SVG; a pane draws images. This is the step between them.
//!
//! gpui's own SVG renderer would do it, but it looks for the app's bundled faces in the app's
//! assets, which a package cannot reach — and a diagram with no text is not a diagram. So the
//! rasteriser here is given the faces `render.mjs` copied into the plugin's data directory
//! (`vendor/fonts` in the package, which WASI cannot read through the package's symlink).

use pumi_plugin::gpui::RenderImage;
use std::cell::RefCell;
use std::sync::Arc;

thread_local! {
    /// The faces a diagram is set in, and where they came from: loaded once, kept.
    static FACES: RefCell<Option<(Vec<String>, Arc<usvg::fontdb::Database>)>> = const { RefCell::new(None) };
}

/// The biggest picture made: a diagram zoomed past this is drawn from the same pixels, larger.
const MAX_PIXELS: f32 = 6000.;

fn database(files: &[String]) -> Arc<usvg::fontdb::Database> {
    FACES.with(|faces| {
        let mut faces = faces.borrow_mut();
        if let Some((cached, db)) = faces.as_ref()
            && cached == files
        {
            return db.clone();
        }
        let mut db = usvg::fontdb::Database::new();
        for file in files {
            if let Ok(bytes) = std::fs::read(file) {
                db.load_font_data(bytes);
            }
        }
        let db = Arc::new(db);
        *faces = Some((files.to_vec(), db.clone()));
        db
    })
}

/// The diagram as pixels, `scale` pixels to the point, on `background` (`#rrggbb`).
pub fn rasterize(svg: &str, files: &[String], scale: f32, background: &str) -> Option<Arc<RenderImage>> {
    let options = usvg::Options { fontdb: database(files), ..usvg::Options::default() };
    let tree = usvg::Tree::from_str(svg, &options).ok()?;
    let size = tree.size();
    if size.width() <= 0. || size.height() <= 0. {
        return None;
    }
    let scale = scale.clamp(0.25, MAX_PIXELS / size.width().max(size.height()));
    let width = (size.width() * scale).ceil().max(1.) as u32;
    let height = (size.height() * scale).ceil().max(1.) as u32;
    let mut pixmap = tiny_skia::Pixmap::new(width, height)?;
    pixmap.fill(colour(background).unwrap_or(tiny_skia::Color::TRANSPARENT));
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    let pixels = image::RgbaImage::from_raw(width, height, pixmap.take())?;
    Some(Arc::new(pixmap_to_image(pixels)))
}

fn pixmap_to_image(pixels: image::RgbaImage) -> RenderImage {
    let frame = image::Frame::new(pixels);
    let mut frames = smallvec::SmallVec::new();
    frames.push(frame);
    RenderImage::new(frames)
}

/// `#rrggbb`, or `rgba(r, g, b, a)` as [`crate::theme`] writes one.
fn colour(text: &str) -> Option<tiny_skia::Color> {
    let (red, green, blue, alpha) = parse(text)?;
    Some(tiny_skia::Color::from_rgba8(red, green, blue, alpha))
}

pub fn parse(text: &str) -> Option<(u8, u8, u8, u8)> {
    let text = text.trim();
    if let Some(hex) = text.strip_prefix('#') {
        let hex = hex.trim_start_matches('#');
        if hex.len() < 6 {
            return None;
        }
        let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok();
        return Some((channel(0)?, channel(2)?, channel(4)?, 255));
    }
    if let Some(rest) = text.strip_prefix("rgba(").or_else(|| text.strip_prefix("rgb(")) {
        let rest = rest.trim_end_matches(')');
        let mut parts = rest.split(',').map(str::trim);
        let red = parts.next()?.parse::<f32>().ok()?;
        let green = parts.next()?.parse::<f32>().ok()?;
        let blue = parts.next()?.parse::<f32>().ok()?;
        let alpha = parts.next().and_then(|alpha| alpha.parse::<f32>().ok()).unwrap_or(1.);
        let channel = |value: f32| (value.clamp(0., 1.) * 255.).round() as u8;
        return Some((channel(red), channel(green), channel(blue), channel(alpha)));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_read_both_ways() {
        assert_eq!(parse("#c8c8c8"), Some((0xc8, 0xc8, 0xc8, 255)));
        assert_eq!(parse("rgba(255, 128, 0, 0.5)"), Some((255, 128, 0, 128)));
        assert_eq!(parse("nonsense"), None);
    }

    #[test]
    fn the_package_has_the_faces() {
        let fonts = format!("{}/../vendor/fonts", env!("CARGO_MANIFEST_DIR"));
        let files: Vec<String> = std::fs::read_dir(fonts)
            .unwrap()
            .flatten()
            .map(|entry| entry.path().to_string_lossy().into_owned())
            .filter(|path| path.ends_with(".ttf"))
            .collect();
        assert_eq!(files.len(), 2, "{files:?}");
        // Both load, and they are the families the plugin asks Pele for.
        let db = database(&files);
        let families: Vec<String> = db.faces().flat_map(|face| face.families.iter().map(|(name, _)| name.clone())).collect();
        assert!(families.iter().any(|name| name == "IBM Plex Sans"), "{families:?}");
        assert!(families.iter().any(|name| name == "IBM Plex Mono"), "{families:?}");
    }

    #[test]
    fn text_paints() {
        let fonts = format!("{}/../vendor/fonts", env!("CARGO_MANIFEST_DIR"));
        let files: Vec<String> = std::fs::read_dir(fonts)
            .unwrap()
            .flatten()
            .map(|entry| entry.path().to_string_lossy().into_owned())
            .filter(|path| path.ends_with(".ttf"))
            .collect();
        // A box with a word in it: the word is the pixels in the middle.
        let svg = concat!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40">"#,
            r##"<rect width="120" height="40" fill="#101010"/>"##,
            r#"<text x="10" y="25" font-family="IBM Plex Sans" font-size="16" fill="white">hello</text>"#,
            "</svg>",
        );
        let image = rasterize(svg, &files, 2., "#101010").expect("pixels");
        assert_eq!(image.size(0).width.0, 240);
        let bytes = image.as_bytes(0).expect("bytes");
        let light = bytes.chunks(4).filter(|pixel| pixel[0] > 128).count();
        assert!(light > 50, "{light} lit pixels");
    }
}
