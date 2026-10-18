//! pumi-dog: a little pumi in the status bar. It walks back and forth, stops to wag and blink,
//! and barks when clicked or when `pumi_dog.bark` is called. `init` is the package's own half,
//! with no Lua left in it: the options it declares and the `pumi-dog.dog` pane in the
//! `statusline` slot, which `pumi_dog.toggle` takes away and brings back.

mod sprite;

use std::path::PathBuf;
use std::time::Duration;

use pumi_plugin::gpui::{ClickEvent, WeakEntity};
use pumi_plugin::prelude::*;
use sprite::Pose;

/// Catppuccin Mocha, for the bark bubble.
const MAUVE: u32 = 0xcba6f7;
const SURFACE0: u32 = 0x313244;

/// How far the dog moves per step, in art pixels.
const STEP: f32 = 1.;

#[derive(Debug, Clone, PartialEq)]
struct Settings {
    fps: f64,
    track: f32,
    height: f32,
}

impl Settings {
    /// Its options (`pumi_dog.*`), within the ranges they are declared with.
    fn read(number: impl Fn(&str) -> Option<f64>) -> Self {
        Settings {
            fps: number("speed").unwrap_or(8.).clamp(1., 20.),
            track: number("track").unwrap_or(140.).clamp(40., 600.) as f32,
            height: number("size").unwrap_or(20.).clamp(10., 48.) as f32,
        }
    }

    fn current() -> Self {
        Self::read(|key| {
            api::option(&format!("pumi_dog.{key}"), json!({}))
                .ok()?
                .as_f64()
        })
    }

    fn interval(&self) -> Duration {
        Duration::from_secs_f64(1. / self.fps)
    }

    /// Screen pixels per art pixel.
    fn scale(&self) -> f32 {
        self.height / sprite::H as f32
    }

    fn width(&self) -> f32 {
        sprite::W as f32 * self.scale()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Mode {
    Walk,
    /// Standing still for this many more ticks.
    Sit(u32),
    /// Barking for this many more ticks.
    Bark(u32),
}

/// A tiny xorshift, enough to make the dog's mind up.
struct Rng(u64);

impl Rng {
    fn seeded() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0x9e37_79b9, |d| d.as_nanos() as u64);
        Rng(nanos | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    /// True one time in `n`.
    fn one_in(&mut self, n: u64) -> bool {
        self.next() % n == 0
    }

    fn between(&mut self, low: u32, high: u32) -> u32 {
        low + (self.next() % u64::from(high - low + 1)) as u32
    }
}

/// Where the dog is and what it is doing, apart from the view so it can be tested.
struct Walker {
    /// Left edge, in screen pixels from the track's start.
    x: f32,
    left: bool,
    mode: Mode,
    pose: Pose,
    tick: u64,
}

impl Walker {
    fn new() -> Self {
        Walker {
            x: 0.,
            left: false,
            mode: Mode::Sit(12),
            pose: Pose::WagA,
            tick: 0,
        }
    }

    fn step(&mut self, settings: &Settings, rng: &mut Rng) {
        self.tick += 1;
        let room = (settings.track - settings.width()).max(0.);
        self.x = self.x.clamp(0., room);
        self.mode = match self.mode {
            Mode::Walk => {
                let step = STEP * settings.scale();
                self.x += if self.left { -step } else { step };
                if self.x <= 0. || self.x >= room {
                    self.x = self.x.clamp(0., room);
                    self.left = !self.left;
                }
                self.pose = if self.tick % 2 == 0 {
                    Pose::WalkA
                } else {
                    Pose::WalkB
                };
                if rng.one_in(40) {
                    Mode::Sit(rng.between(16, 48))
                } else {
                    Mode::Walk
                }
            }
            Mode::Sit(0) => {
                if rng.one_in(3) {
                    self.left = !self.left;
                }
                self.pose = Pose::WalkA;
                Mode::Walk
            }
            Mode::Sit(left) => {
                self.pose = if rng.one_in(25) {
                    Pose::Blink
                } else if (self.tick / 2) % 2 == 0 {
                    Pose::WagA
                } else {
                    Pose::WagB
                };
                Mode::Sit(left - 1)
            }
            Mode::Bark(0) => {
                self.pose = Pose::WagA;
                Mode::Sit(rng.between(8, 20))
            }
            Mode::Bark(left) => {
                // Mouth opens and shuts: two barks.
                self.pose = if (left / 2) % 2 == 1 {
                    Pose::Bark
                } else {
                    Pose::WagA
                };
                Mode::Bark(left - 1)
            }
        };
    }

    fn bark(&mut self) {
        self.mode = Mode::Bark(8);
        self.pose = Pose::Bark;
    }

    fn barking(&self) -> bool {
        matches!(self.mode, Mode::Bark(_))
    }
}

/// The view in the status bar.
struct Dog {
    walker: Walker,
    settings: Settings,
    rng: Rng,
    frames: PathBuf,
}

impl Dog {
    fn frame(&self) -> String {
        let side = if self.walker.left { "left" } else { "right" };
        self.frames
            .join(format!("{}-{side}.svg", self.walker.pose.name()))
            .to_string_lossy()
            .into_owned()
    }

    /// One step every frame interval, for as long as the view is open.
    fn walk(cx: &mut Context<Self>) {
        cx.spawn(async move |dog: WeakEntity<Dog>, cx| {
            loop {
                let Ok(interval) = dog.update(cx, |dog, _| dog.settings.interval()) else {
                    break;
                };
                cx.background_executor().timer(interval).await;
                let stepped = dog.update(cx, |dog, cx| {
                    let settings = dog.settings.clone();
                    dog.walker.step(&settings, &mut dog.rng);
                    cx.notify();
                });
                if stepped.is_err() {
                    break;
                }
            }
        })
        .detach();
    }
}

/// Writes every frame where the view can load it, once per version of the art.
fn write_frames() -> PathBuf {
    let data = api::plugin()["data"]
        .as_str()
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = data.join(format!("frames-{}", sprite::version()));
    if !dir.join("done").exists() {
        let _ = std::fs::create_dir_all(&dir);
        for pose in sprite::POSES {
            for (left, side) in [(false, "right"), (true, "left")] {
                let path = dir.join(format!("{}-{side}.svg", pose.name()));
                if let Err(err) = std::fs::write(&path, sprite::svg(pose, left)) {
                    eprintln!("pumi-dog: writing {}: {err}", path.display());
                }
            }
        }
        let _ = std::fs::write(dir.join("done"), "");
    }
    dir
}

impl Render for Dog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let s = &self.settings;
        let (x, width) = (self.walker.x, s.width());
        let bubble = self.walker.barking().then(|| {
            // Say it on the side the dog faces, unless that runs off the track.
            let room_right = s.track - (x + width);
            let at_right = !self.walker.left && room_right >= 40. || self.walker.left && x < 40.;
            let bubble = div()
                .absolute()
                .top(px(0.))
                .px(px(4.))
                .rounded_sm()
                .bg(rgb(SURFACE0))
                .text_color(rgb(MAUVE))
                .text_xs()
                .whitespace_nowrap()
                .child("woof!");
            if at_right {
                bubble.left(px(x + width))
            } else {
                bubble.left(px((x - 40.).max(0.)))
            }
        });
        div().size_full().flex().items_center().justify_end().child(
            div()
                .id("pumi-dog")
                .class("pumi-dog")
                .relative()
                .flex_shrink_0()
                .w(px(s.track))
                .h(px(s.height))
                .cursor_pointer()
                .on_click(cx.listener(|dog: &mut Dog, _: &ClickEvent, _, cx| {
                    dog.walker.bark();
                    cx.notify();
                }))
                .child(
                    img(self.frame())
                        .absolute()
                        .top(px(0.))
                        .left(px(x))
                        .w(px(width))
                        .h(px(s.height)),
                )
                .children(bubble),
        )
    }
}

/// Declare one of its options, in its heading in Settings.
fn declare_option(name: &str, mut spec: Value) {
    spec["group"] = json!("Pumi dog");
    if let Err(err) = api::pumi_create_option(&format!("pumi_dog.{name}"), spec) {
        eprintln!("pumi-dog: {err}");
    }
}

/// The dog's pane, if it is out.
fn pane() -> Option<u64> {
    let panes = api::pumi_list_panes(json!({ "type": "pumi-dog.dog" })).ok()?;
    panes.as_array()?.first()?.as_u64()
}

fn show() {
    if pane().is_some() {
        return;
    }
    let place = json!({ "kind": "slot", "slot": "statusline", "order": 1000, "focus": false });
    if let Err(err) = api::pumi_open_pane("pumi-dog.dog", json!({}), place) {
        eprintln!("pumi-dog: {err}");
    }
}

fn toggle() {
    match pane() {
        Some(pane) => {
            let _ = api::pumi_pane_close(pane, Some(true));
        }
        None => show(),
    }
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    declare_option(
        "speed",
        json!({ "type": "number", "default": 8, "min": 2, "max": 16, "step": 1, "unit": "fps", "label": "Speed", "control": "slider", "desc": "Animation frames per second. Lower is calmer and cheaper." }),
    );
    declare_option(
        "track",
        json!({ "type": "number", "default": 140, "min": 40, "max": 600, "unit": "px", "label": "Walking room", "desc": "How much of the status bar the dog walks along." }),
    );
    declare_option(
        "size",
        json!({ "type": "number", "default": 20, "min": 12, "max": 32, "step": 1, "unit": "px", "label": "Size", "control": "slider", "desc": "The dog's height." }),
    );
    plugin.view("dog", |_open, _window, cx| {
        let frames = write_frames();
        let dog = cx.new(|cx| {
            Dog::walk(cx);
            Dog {
                walker: Walker::new(),
                settings: Settings::current(),
                rng: Rng::seeded(),
                frames,
            }
        });
        // Its options, followed as they change.
        let weak = dog.downgrade();
        let followed = api::autocmd(
            "OptionSet",
            json!({ "pattern": "pumi_dog.*", "desc": "pumi-dog's options" }),
            {
                move |_, cx| {
                    let _ = weak.update(cx, |dog, cx| {
                        dog.settings = Settings::current();
                        cx.notify();
                    });
                }
            },
        );
        // `pumi call pumi_dog.bark`, from anywhere.
        let weak = dog.downgrade();
        let bark = api::create_function(
            "pumi_dog.bark",
            json!({ "desc": "The dog says hi." }),
            move |_, cx| {
                let _ = weak.update(cx, |dog, cx| {
                    dog.walker.bark();
                    cx.notify();
                });
            },
        );
        if let Err(err) = followed.map(|_| ()).and(bark) {
            eprintln!("pumi-dog: {err}");
        }
        dog.into()
    });
    // `pumi call pumi_dog.toggle`: takes the dog away and brings it back.
    let spec = json!({ "desc": "Show or hide the dog.", "examples": [{ "args": [] }] });
    if let Err(err) = api::provide("pumi_dog.toggle", spec, |_| {
        toggle();
        Ok(Value::Null)
    }) {
        eprintln!("pumi-dog: {err}");
    }
    show();
}

pumi_plugin::plugin!(init);

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Settings {
        Settings::read(|_| None)
    }

    #[test]
    fn stays_on_the_track() {
        let s = settings();
        let (mut walker, mut rng) = (Walker::new(), Rng(42));
        for _ in 0..10_000 {
            walker.step(&s, &mut rng);
            assert!(
                walker.x >= 0. && walker.x + s.width() <= s.track + 0.01,
                "x = {}",
                walker.x
            );
        }
    }

    #[test]
    fn walks_both_ways_and_rests() {
        let s = settings();
        let (mut walker, mut rng) = (Walker::new(), Rng(7));
        let (mut lefts, mut rights, mut sits) = (0, 0, 0);
        for _ in 0..5_000 {
            walker.step(&s, &mut rng);
            match walker.mode {
                Mode::Walk if walker.left => lefts += 1,
                Mode::Walk => rights += 1,
                Mode::Sit(_) => sits += 1,
                Mode::Bark(_) => {}
            }
        }
        assert!(
            lefts > 0 && rights > 0 && sits > 0,
            "{lefts} {rights} {sits}"
        );
    }

    #[test]
    fn a_bark_ends_in_a_sit() {
        let s = settings();
        let (mut walker, mut rng) = (Walker::new(), Rng(1));
        walker.bark();
        assert!(walker.barking());
        for _ in 0..9 {
            walker.step(&s, &mut rng);
        }
        assert!(!walker.barking());
        assert!(matches!(walker.mode, Mode::Sit(_)));
    }

    #[test]
    fn settings_are_clamped() {
        let s = Settings::read(|key| {
            Some(match key {
                "speed" => 500.,
                "track" => 1.,
                _ => 2.,
            })
        });
        assert_eq!((s.fps, s.track, s.height), (20., 40., 10.));
    }
}
