//! The dog, as pixel art. Each frame is a grid of characters, one per pixel, drawn facing
//! right; left-facing frames are the same rows reversed. Frames become small SVG files of
//! crisp rects, which the view shows with `img`.

/// Width and height of every frame, in art pixels.
pub const W: usize = 22;
pub const H: usize = 15;

/// Character → colour, from Catppuccin Mocha. `.` is transparent.
const PALETTE: &[(char, &str)] = &[
    ('o', "#585b70"), // outline, the darkest fur (Surface 2)
    ('d', "#7f849c"), // shaded fur, the ears (Overlay 1)
    ('g', "#a6adc8"), // fur (Subtext 0)
    ('l', "#cdd6f4"), // light fur: muzzle, brows, chest (Text)
    ('e', "#11111b"), // eye (Crust)
    ('w', "#f5e0dc"), // the eye's glint (Rosewater)
    ('n', "#181825"), // nose (Mantle)
    ('t', "#f38ba8"), // tongue (Red)
    ('m', "#45475a"), // open mouth (Surface 1)
];

/// The head, body and curled tail, rows 0..=10.
const BODY: [&str; 11] = [
    "............d...d.....",
    "...........dd..dd.....",
    "...........dggggggd...",
    "..gg......dgglglgggd..",
    ".gllg.....dgllllllllg.",
    ".glllg....dglllewlllll",
    "..ggl.....dgllleelllnn",
    "....ggggggdggllllllt..",
    "....dglglglgglllllgg..",
    "....dglllllllllllgg...",
    ".....dgllllllllllg....",
];

/// The tail swung back, drawn over the body's columns 0..6, rows 3..=7.
const TAIL_SIDE: [&str; 5] = ["......", ".gg...", "gllg..", "glllg.", ".ggggg"];

/// Legs, rows 11..=14.
const LEGS_STAND: [&str; 4] = [
    "......gg..gg..gg..gg..",
    "......gg..gg..gg..gg..",
    "......gl..gl..gl..gl..",
    "......oo..oo..oo..oo..",
];
const LEGS_STRIDE: [&str; 4] = [
    ".....gg..gg...gg..gg..",
    "....gg....gg.gg....gg.",
    "....gl.....glgl.....gl",
    "....oo.....oooo.....oo",
];
const LEGS_TUCK: [&str; 4] = [
    "......gg.gg....gg.gg..",
    "......gg.gg....gg.gg..",
    "......gl.gl....gl.gl..",
    "......oo.oo....oo.oo..",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pose {
    WalkA,
    WalkB,
    WagA,
    WagB,
    Blink,
    Bark,
}

pub const POSES: [Pose; 6] = [
    Pose::WalkA,
    Pose::WalkB,
    Pose::WagA,
    Pose::WagB,
    Pose::Blink,
    Pose::Bark,
];

impl Pose {
    pub fn name(self) -> &'static str {
        match self {
            Pose::WalkA => "walk-a",
            Pose::WalkB => "walk-b",
            Pose::WagA => "wag-a",
            Pose::WagB => "wag-b",
            Pose::Blink => "blink",
            Pose::Bark => "bark",
        }
    }
}

/// The frame's pixels, facing right.
pub fn grid(pose: Pose) -> Vec<Vec<char>> {
    let mut rows: Vec<Vec<char>> = BODY.iter().map(|row| row.chars().collect()).collect();
    let legs = match pose {
        Pose::WalkA => LEGS_STRIDE,
        Pose::WalkB => LEGS_TUCK,
        _ => LEGS_STAND,
    };
    rows.extend(legs.iter().map(|row| row.chars().collect::<Vec<_>>()));
    if pose == Pose::WagB {
        for (i, tail) in TAIL_SIDE.iter().enumerate() {
            for (x, c) in tail.chars().enumerate() {
                rows[3 + i][x] = c;
            }
        }
    }
    match pose {
        Pose::Blink => {
            rows[5][15] = 'l';
            rows[5][16] = 'l';
            rows[6][15] = 'o';
            rows[6][16] = 'o';
        }
        Pose::Bark => {
            // Mouth open, tongue out.
            rows[7][17] = 'm';
            rows[7][18] = 'm';
            rows[7][19] = 't';
            rows[7][20] = 't';
            rows[8][18] = 't';
        }
        _ => {}
    }
    rows
}

/// An SVG of a frame, `scale` screen pixels per art pixel, facing left or right.
pub fn svg(pose: Pose, left: bool) -> String {
    let rows = grid(pose);
    let mut out = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\" shape-rendering=\"crispEdges\">",
        w = W,
        h = H
    );
    for (y, row) in rows.iter().enumerate() {
        // Runs of one colour become one rect, which keeps the files small.
        let mut x = 0;
        while x < W {
            let c = row[if left { W - 1 - x } else { x }];
            let mut end = x + 1;
            while end < W && row[if left { W - 1 - end } else { end }] == c {
                end += 1;
            }
            if let Some((_, colour)) = PALETTE.iter().find(|(key, _)| *key == c) {
                out.push_str(&format!(
                    "<rect x=\"{x}\" y=\"{y}\" width=\"{}\" height=\"1\" fill=\"{colour}\"/>",
                    end - x
                ));
            }
            x = end;
        }
    }
    out.push_str("</svg>");
    out
}

/// A short tag that changes whenever the art does, so the app's image cache never shows an
/// older dog after an update.
pub fn version() -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for pose in POSES {
        for c in svg(pose, false).bytes() {
            hash = (hash ^ c as u64).wrapping_mul(0x100_0000_01b3);
        }
    }
    format!("{:08x}", hash as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_frame_is_the_same_size() {
        for pose in POSES {
            let rows = grid(pose);
            assert_eq!(rows.len(), H, "{pose:?}");
            for (i, row) in rows.iter().enumerate() {
                assert_eq!(row.len(), W, "{pose:?} row {i}");
            }
        }
    }

    #[test]
    fn every_pixel_has_a_colour() {
        for pose in POSES {
            for c in grid(pose).into_iter().flatten() {
                assert!(
                    c == '.' || PALETTE.iter().any(|(k, _)| *k == c),
                    "{pose:?}: {c}"
                );
            }
        }
    }

    /// `PUMI_DOG_PREVIEW=dir cargo test` writes every frame there, to look at.
    #[test]
    fn preview() {
        let Ok(dir) = std::env::var("PUMI_DOG_PREVIEW") else {
            return;
        };
        for pose in POSES {
            for left in [false, true] {
                let side = if left { "left" } else { "right" };
                std::fs::write(format!("{dir}/{}-{side}.svg", pose.name()), svg(pose, left))
                    .unwrap();
            }
        }
    }
}
