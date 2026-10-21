//! What `app.perf` answers, read into what the overlay draws, and how it is laid out: plain
//! data and arithmetic, so it is tested natively.

use pumi_plugin::{Value, json};

/// How wide a graph is, in characters.
pub const GRAPH: usize = 30;
/// A call still running after this long is shown as running.
pub const RUNNING_MS: f64 = 250.;

/// One character of the overlay's monospace, in pixels (at [`FONT`]).
pub const CHAR: f32 = 7.2;
pub const FONT: f32 = 12.;
/// A row's height, the gap between rows, a spacer between sections, the padding inside.
pub const LINE: f32 = 16.;
pub const GAP: f32 = 2.;
pub const SPACER: f32 = 4.;
pub const PAD: f32 = 8.;
/// The app's frame around a float: one pixel each side.
pub const FRAME: f32 = 2.;
/// How many threads are worth a row.
pub const THREADS_SHOWN: usize = 8;

/// The core plugins' table: a heading and how many characters wide each column is.
pub const EXTENSIONS: &[(&str, usize)] = &[
    ("ext", 10),
    ("busy 10s", 9),
    ("cpu 10s", 8),
    ("cpu 60s", 8),
    ("call/s", 7),
    ("queue", 6),
    ("ui/s", 8),
    ("mem", 9),
    ("call", 22),
    ("cpu, last 60s", GRAPH + 1),
];
pub const THREADS: &[(&str, usize)] =
    &[("thread", 27), ("now", 8), ("10s", 8), ("60s", 8), ("peak", 8), ("", 18), ("cpu, last 60s", GRAPH + 1)];

/// The thread the app counts CPU for that it has no thread of any more.
pub const EXITED: &str = "exited threads";

/// One series of samples, a second apart.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Series {
    pub now: f32,
    pub avg_10s: f32,
    pub avg_60s: f32,
    pub peak_60s: f32,
    pub last_60s: Vec<f32>,
}

fn number(v: &Value) -> f32 {
    v.as_f64().unwrap_or(0.) as f32
}

impl Series {
    pub fn of(v: &Value) -> Series {
        Series {
            now: number(&v["now"]),
            avg_10s: number(&v["avg_10s"]),
            avg_60s: number(&v["avg_60s"]),
            peak_60s: number(&v["peak_60s"]),
            last_60s: v["last_60s"].as_array().map(|l| l.iter().map(number).collect()).unwrap_or_default(),
        }
    }
}

/// How loud a row is drawn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// Not running.
    Off,
    Quiet,
    Busy,
    Hot,
}

/// A share of a CPU, as a level: a tenth is busy, a half is hot.
pub fn load(share: f32) -> Level {
    match share {
        s if s >= 50. => Level::Hot,
        s if s >= 10. => Level::Busy,
        _ => Level::Quiet,
    }
}

/// A core plugin's row.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Extension {
    pub name: String,
    pub running: bool,
    pub busy: Series,
    pub cpu: Series,
    pub calls: Series,
    pub ui_ms: Series,
    pub queued: u64,
    pub memory: u64,
    /// The call it is in now, when it has been for a while, else its slowest.
    pub call: String,
}

impl Extension {
    fn of(v: &Value) -> Extension {
        let current = v["current"].as_object().filter(|c| c["elapsed"].as_f64().unwrap_or(0.) >= RUNNING_MS);
        let call = match current {
            Some(c) => format!("▶ {} {}", c["kind"].as_str().unwrap_or("?"), duration(c["elapsed"].as_f64().unwrap_or(0.))),
            None if v["calls"].as_u64().unwrap_or(0) == 0 => String::new(),
            None => format!("max {} {}", v["max_kind"].as_str().unwrap_or("?"), duration(v["max"].as_f64().unwrap_or(0.))),
        };
        Extension {
            name: v["name"].as_str().unwrap_or("?").to_string(),
            running: v["running"].as_bool().unwrap_or(false),
            busy: Series::of(&v["busy_percent"]),
            cpu: Series::of(&v["cpu_percent"]),
            calls: Series::of(&v["calls_per_second"]),
            ui_ms: Series::of(&v["ui_ms_per_second"]),
            queued: v["queued"].as_u64().unwrap_or(0),
            memory: v["memory"].as_u64().unwrap_or(0),
            call,
        }
    }

    pub fn level(&self) -> Level {
        match () {
            _ if !self.running => Level::Off,
            _ if self.queued >= 10 => Level::Hot,
            _ if self.ui_ms.avg_10s >= 8. => Level::Busy,
            _ => load(self.busy.avg_10s.max(self.cpu.avg_10s)),
        }
    }

    /// Its cells, in [`EXTENSIONS`]' order (the graph is drawn apart).
    pub fn cells(&self) -> Vec<String> {
        vec![
            if self.running { self.name.clone() } else { format!("{} (off)", self.name) },
            percent(self.busy.avg_10s),
            percent(self.cpu.avg_10s),
            percent(self.cpu.avg_60s),
            format!("{:.1}", self.calls.avg_10s),
            self.queued.to_string(),
            format!("{:.1}ms", self.ui_ms.avg_10s),
            bytes(self.memory),
            self.call.clone(),
        ]
    }
}

/// A thread's row: its name (and how many have it), and its CPU.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Thread {
    pub name: String,
    pub count: u64,
    pub cpu: Series,
}

impl Thread {
    pub fn cells(&self) -> Vec<String> {
        let c = &self.cpu;
        let name = match self.count {
            0 | 1 => self.name.clone(),
            n => format!("{} ×{n}", self.name),
        };
        let note = if self.name == EXITED { "since gone" } else { "" };
        vec![name, percent(c.now), percent(c.avg_10s), percent(c.avg_60s), percent(c.peak_60s), note.into()]
    }
}

/// The whole report, as drawn.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Report {
    pub samples: u64,
    pub cpu: Series,
    pub rss: u64,
    pub threads_alive: u64,
    pub uptime: u64,
    pub ui: Series,
    pub fps: Series,
    pub frame_avg_ms: f64,
    pub frame_max_ms: f64,
    pub slow: u64,
    pub extensions: Vec<Extension>,
    pub threads: Vec<Thread>,
}

impl Report {
    pub fn of(v: &Value) -> Report {
        let p = &v["process"];
        let f = &v["frames"];
        let list = |key: &str| v[key].as_array().cloned().unwrap_or_default();
        Report {
            samples: v["samples"].as_u64().unwrap_or(0),
            cpu: Series::of(&p["cpu_percent"]),
            rss: p["rss"].as_u64().unwrap_or(0),
            threads_alive: p["threads"].as_u64().unwrap_or(0),
            uptime: p["uptime"].as_u64().unwrap_or(0),
            ui: Series::of(&f["ui_percent"]),
            fps: Series::of(&f["per_second"]),
            frame_avg_ms: f["avg"].as_f64().unwrap_or(0.),
            frame_max_ms: f["max"].as_f64().unwrap_or(0.),
            slow: f["slow"].as_u64().unwrap_or(0),
            extensions: list("extensions").iter().map(Extension::of).collect(),
            threads: list("threads")
                .iter()
                .take(THREADS_SHOWN)
                .map(|t| Thread {
                    name: t["name"].as_str().unwrap_or("?").to_string(),
                    count: t["count"].as_u64().unwrap_or(0),
                    cpu: Series::of(&t["cpu_percent"]),
                })
                .collect(),
        }
    }

    /// The app's own line: its CPU, now and averaged.
    pub fn app_line(&self) -> String {
        let c = &self.cpu;
        format!(
            "app    cpu {:>5} now {:>5} 10s {:>5} 60s  peak {:>5}  ",
            percent(c.now),
            percent(c.avg_10s),
            percent(c.avg_60s),
            percent(c.peak_60s)
        )
    }

    pub fn memory_line(&self) -> String {
        format!(
            "       rss {}  threads {}  up {}s  samples {}",
            bytes(self.rss),
            self.threads_alive,
            self.uptime,
            self.samples
        )
    }

    pub fn ui_line(&self) -> String {
        format!(
            "ui     thread {:>5} 10s {:>5} 60s  {:.0} frames/s  avg {}  max {}  slow {}  ",
            percent(self.ui.avg_10s),
            percent(self.ui.avg_60s),
            self.fps.avg_10s,
            duration(self.frame_avg_ms),
            duration(self.frame_max_ms),
            self.slow
        )
    }

    /// How many rows it draws, and how many spacers between its sections.
    pub fn rows(&self) -> (usize, usize) {
        // The title, the app's three lines, the table's heading and its rows (or the line that
        // says there are none).
        let mut rows = 5 + self.extensions.len().max(1);
        let mut spacers = 1;
        if !self.threads.is_empty() {
            rows += 1 + self.threads.len();
            spacers += 1;
        }
        if self.samples == 0 {
            rows += 1;
        }
        (rows, spacers)
    }

    /// The float's height in pixels, so it is as tall as what it draws.
    pub fn height(&self) -> f32 {
        let (rows, spacers) = self.rows();
        let children = rows + spacers;
        2. * PAD + FRAME + rows as f32 * LINE + spacers as f32 * SPACER + (children - 1) as f32 * GAP
    }
}

/// The float's width in pixels: the wider table, and the padding.
pub fn width() -> f32 {
    let chars = |columns: &[(&str, usize)]| columns.iter().map(|(_, w)| w).sum::<usize>();
    let widest = chars(EXTENSIONS).max(chars(THREADS));
    (widest as f32 * CHAR + 2. * PAD + FRAME).ceil()
}

/// A share as a whole percentage.
pub fn percent(p: f32) -> String {
    format!("{p:.0}%")
}

pub fn bytes(n: u64) -> String {
    match n {
        n if n >= 1 << 30 => format!("{:.1} GB", n as f64 / (1u64 << 30) as f64),
        n if n >= 1 << 20 => format!("{:.1} MB", n as f64 / (1u64 << 20) as f64),
        n if n >= 1 << 10 => format!("{} KB", n >> 10),
        n => format!("{n} B"),
    }
}

/// Milliseconds, in the unit that reads best.
pub fn duration(ms: f64) -> String {
    match ms / 1e3 {
        t if t >= 1. => format!("{t:.2}s"),
        t if t >= 1e-3 => format!("{:.1}ms", t * 1e3),
        t => format!("{:.0}µs", t * 1e6),
    }
}

/// The last minute as block characters, right-aligned and always [`GRAPH`] wide: each
/// character the mean of its share of the samples, against 100% or the peak if higher.
pub fn graph_line(series: &Series) -> String {
    const BLOCKS: [char; 9] = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    let values = &series.last_60s;
    let scale = series.peak_60s.max(100.);
    let per = values.len().div_ceil(GRAPH).max(1);
    let mut line: String = " ".repeat(GRAPH.saturating_sub(values.len().div_ceil(per)));
    for chunk in values.rchunks(per).rev() {
        let mean = chunk.iter().sum::<f32>() / chunk.len() as f32;
        let level = if mean <= 0.05 { 0 } else { ((mean / scale) * 8.).ceil().clamp(1., 8.) as usize };
        line.push(BLOCKS[level]);
    }
    line
}

/// A report with nothing in it yet, for a view that has not read one.
pub fn empty() -> Value {
    json!({ "samples": 0, "process": {}, "frames": {}, "extensions": [], "threads": [] })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series(now: f32) -> Value {
        json!({ "now": now, "avg_10s": now, "avg_60s": now, "peak_60s": now, "last_60s": [now, now] })
    }

    fn sample() -> Value {
        json!({
            "samples": 12,
            "process": { "cpu_percent": series(14.), "rss": 300 << 20, "threads": 40, "uptime": 12 },
            "frames": { "per_second": series(60.), "ui_percent": series(5.), "avg": 2.5, "max": 16.25, "slow": 1 },
            "extensions": [
                { "name": "git", "running": true, "busy_percent": series(60.), "cpu_percent": series(3.),
                  "calls_per_second": series(1.), "ui_ms_per_second": series(0.), "queued": 0, "memory": 2048,
                  "calls": 4, "max": 31.5, "max_kind": "refresh", "current": null },
                { "name": "files", "running": true, "busy_percent": series(1.), "cpu_percent": series(1.),
                  "calls_per_second": series(1.), "ui_ms_per_second": series(0.), "queued": 0, "memory": 0,
                  "calls": 9, "max": 1., "max_kind": "key", "current": { "kind": "refresh", "elapsed": 900. } },
                { "name": "palette", "running": false, "calls": 0 }
            ],
            "threads": [{ "name": "plugin perf", "count": 1, "cpu_percent": series(2.) }, { "name": "exited threads", "count": 0, "cpu_percent": series(1.) }]
        })
    }

    #[test]
    fn a_report_reads_as_drawn() {
        let r = Report::of(&sample());
        assert_eq!((r.samples, r.rss, r.extensions.len(), r.threads.len()), (12, 300 << 20, 3, 2));
        let git = &r.extensions[0];
        assert_eq!(git.call, "max refresh 31.5ms");
        assert_eq!(git.level(), Level::Hot, "busy for more than half of the last 10s");
        assert_eq!(r.extensions[1].call, "▶ refresh 900.0ms", "a call running for a while is shown running");
        assert_eq!(r.extensions[2].level(), Level::Off);
        assert_eq!(r.extensions[2].cells()[0], "palette (off)");
        assert_eq!(git.cells().len() + 1, EXTENSIONS.len(), "every column but the graph");
        assert_eq!(r.threads[1].cells()[5], "since gone");
        assert!(r.app_line().starts_with("app    cpu   14% now"));
        assert!(r.memory_line().contains("rss 300.0 MB"));
        assert!(r.ui_line().contains("60 frames/s  avg 2.5ms  max 16.2ms  slow 1"));
    }

    #[test]
    fn a_report_is_as_tall_as_its_rows() {
        let r = Report::of(&sample());
        // Title, three lines, a heading, three plugins; a heading and two threads.
        assert_eq!(r.rows(), (11, 2));
        let first = Report::of(&empty());
        assert_eq!(first.rows(), (7, 1), "the 'none yet' line and the 'a second away' line");
        assert!(r.height() > first.height());
        assert_eq!(first.height(), 2. * PAD + FRAME + 7. * LINE + SPACER + 7. * GAP);
        assert!(width() > 800. && width() < 900.);
    }

    #[test]
    fn a_graph_is_right_aligned_and_always_as_wide() {
        let young = Series { last_60s: vec![100., 50.], peak_60s: 100., ..Series::default() };
        assert_eq!(graph_line(&young).chars().count(), GRAPH);
        assert!(graph_line(&young).ends_with("█▄"));
        let full = Series { last_60s: vec![0.; 60], ..Series::default() };
        assert_eq!(graph_line(&full).chars().count(), GRAPH);
    }

    #[test]
    fn units_read_well() {
        assert_eq!((bytes(512), bytes(4096), bytes(3 << 20)), ("512 B".into(), "4 KB".into(), "3.0 MB".into()));
        assert_eq!((duration(1500.), duration(2.5), duration(0.04)), ("1.50s".into(), "2.5ms".into(), "40µs".into()));
        assert_eq!(load(9.), Level::Quiet);
        assert_eq!(load(10.), Level::Busy);
    }
}
