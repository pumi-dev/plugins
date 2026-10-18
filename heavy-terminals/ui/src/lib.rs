//! heavy-terminals: notice terminals whose processes eat the machine, and put them to sleep: the
//! foreground job is suspended as ctrl+z would, and woken with fg (05 §5).
//!
//! No view: it declares its options, measures every terminal on a timer of its own, and provides
//! `heavy_terminals.sleep`/`heavy_terminals.wake` (the user commands `HeavySleep`/`HeavyWake`).

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use pumi_plugin::gpui::{App, AsyncApp};
use pumi_plugin::prelude::*;

/// Every process, by pid: what its parent is, the CPU time it has used, the memory it holds.
struct Proc {
    ppid: u64,
    /// CPU seconds.
    cpu: f64,
    /// Bytes.
    rss: f64,
}

/// What the last checks found of a pane.
#[derive(Default)]
struct Watch {
    /// When it was measured last (milliseconds), and the CPU seconds spent by then.
    at: f64,
    cpu: f64,
    /// How many checks in a row it was heavy, and whether that has been said.
    strikes: u32,
    alerted: bool,
}

thread_local! {
    static WATCHES: RefCell<HashMap<u64, Watch>> = RefCell::new(HashMap::new());
    /// The panes whose foreground job was suspended.
    static SLEEPING: RefCell<BTreeSet<u64>> = RefCell::new(BTreeSet::new());
}

/// Declare one of its options.
fn declare_option(name: &str, spec: Value) {
    if let Err(err) = api::pumi_create_option(&format!("heavy_terminals.{name}"), spec) {
        eprintln!("heavy-terminals: {err}");
    }
}

fn number(name: &str, default: f64) -> f64 {
    api::option(&format!("heavy_terminals.{name}"), json!({}))
        .ok()
        .and_then(|value| value.as_f64())
        .unwrap_or(default)
}

fn flag(name: &str, default: bool) -> bool {
    api::option(&format!("heavy_terminals.{name}"), json!({}))
        .ok()
        .and_then(|value| value.as_bool())
        .unwrap_or(default)
}

/// `ps`'s TIME as seconds: `MM:SS`, `HH:MM:SS`, or `D-HH:MM:SS`.
fn seconds(text: &str) -> f64 {
    let (days, rest) = match text.split_once('-') {
        Some((days, rest)) => (days.parse::<f64>().unwrap_or(0.), rest),
        None => (0., text),
    };
    let mut total = days * 86_400.;
    let mut mult = 1.;
    for part in rest.rsplit(':') {
        total += part.parse::<f64>().unwrap_or(0.) * mult;
        mult *= 60.;
    }
    total
}

/// Every process: pid → what it costs.
fn processes() -> HashMap<u64, Proc> {
    let mut procs = HashMap::new();
    let output = match system::Command::new("ps").args(["-A", "-o", "pid=,ppid=,time=,rss="]).run() {
        Ok(output) => output,
        Err(err) => {
            eprintln!("heavy-terminals: ps: {err}");
            return procs;
        }
    };
    for line in output.stdout_text().lines() {
        let mut fields = line.split_whitespace();
        let (Some(pid), Some(ppid), Some(time), Some(rss)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let (Ok(pid), Ok(ppid), Ok(rss)) = (pid.parse(), ppid.parse(), rss.parse::<f64>()) else {
            continue;
        };
        procs.insert(pid, Proc { ppid, cpu: seconds(time), rss: rss * 1024. });
    }
    procs
}

/// A pane's processes together: its program's, and theirs, down the tree.
fn usage(procs: &HashMap<u64, Proc>, root: u64) -> (f64, f64) {
    let mut children: HashMap<u64, Vec<u64>> = HashMap::new();
    for (pid, process) in procs {
        children.entry(process.ppid).or_default().push(*pid);
    }
    let (mut cpu, mut rss) = (0., 0.);
    let mut todo = vec![root];
    while let Some(pid) = todo.pop() {
        if let Some(process) = procs.get(&pid) {
            cpu += process.cpu;
            rss += process.rss;
        }
        if let Some(kids) = children.get(&pid) {
            todo.extend(kids);
        }
    }
    (cpu, rss)
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as f64)
        .unwrap_or(0.)
}

/// Suspend a pane's foreground job: ctrl+z, as a person would type it.
fn sleep(pane: u64) {
    let _ = api::pumi_pane_call(pane, "input", json!({ "bytes": [0x1a] }));
    SLEEPING.with(|s| s.borrow_mut().insert(pane));
    let _ = api::set_option("@heavy", json!("asleep"), json!({ "pane": pane }));
}

/// Wake it: `fg` and Enter.
fn wake(pane: u64) {
    let _ = api::pumi_pane_call(pane, "input", json!({ "text": "fg\r" }));
    SLEEPING.with(|s| s.borrow_mut().remove(&pane));
    let _ = api::set_option("@heavy", Value::Null, json!({ "pane": pane }));
}

/// Measures every terminal once; a heavy one is marked `@heavy`, and slept when asked.
fn check() {
    let procs = processes();
    let now = now_ms();
    let cpu_bar = number("cpu", 150.);
    let memory_bar = number("memory", 4096.) * 1_048_576.;
    let sustain = number("sustain", 3.).max(1.) as u32;
    let auto_sleep = flag("auto_sleep", false);
    let mut watches = WATCHES.with(|w| std::mem::take(&mut *w.borrow_mut()));
    let panes = api::pumi_list_panes(json!({ "type": "terminal" })).unwrap_or(Value::Null);
    let mut seen: Vec<u64> = Vec::new();
    for pane in panes.as_array().into_iter().flatten().filter_map(Value::as_u64) {
        seen.push(pane);
        let pid = api::option("pane_pid", json!({ "pane": pane }))
            .ok()
            .and_then(|value| value.as_u64());
        let Some(pid) = pid else { continue };
        let (cpu, rss) = usage(&procs, pid);
        let sleeping = SLEEPING.with(|s| s.borrow().contains(&pane));
        let watch = watches.entry(pane).or_default();
        let percent = if watch.at > 0. {
            (cpu - watch.cpu) / ((now - watch.at) / 1000.) * 100.
        } else {
            0.
        };
        (watch.at, watch.cpu) = (now, cpu);
        let heavy = percent > cpu_bar || rss > memory_bar;
        if heavy && !sleeping {
            watch.strikes += 1;
            if watch.strikes >= sustain && !watch.alerted {
                watch.alerted = true;
                let (percent, mb) = (percent.round() as i64, (rss / 1_048_576.).round() as i64);
                let cost = format!("{percent}% cpu, {mb} MB");
                let _ = api::set_option("@heavy", json!(cost), json!({ "pane": pane }));
                let _ = api::pumi_notify(&format!("%{pane} is heavy: {cost}"), Some("warn"), json!({}));
                if auto_sleep {
                    sleep(pane);
                }
            }
        } else if !heavy {
            (watch.strikes, watch.alerted) = (0, false);
        }
    }
    watches.retain(|pane, _| seen.contains(pane));
    WATCHES.with(|w| *w.borrow_mut() = watches);
    SLEEPING.with(|s| s.borrow_mut().retain(|pane| seen.contains(pane)));
}

/// Measure now, then every `heavy_terminals.interval` seconds: the option is read each round,
/// so changing it needs no new timer.
fn start(cx: &mut App) {
    cx.spawn(async move |cx: &mut AsyncApp| {
        loop {
            check();
            let interval = number("interval", 5.).max(0.1);
            cx.background_executor().timer(Duration::from_secs_f64(interval)).await;
        }
    })
    .detach();
}

/// The pane a caller asked about: an id, a table naming one, a user command's `"%3"`, or the
/// current pane.
fn pane_of(args: &Value) -> Option<u64> {
    args.as_u64()
        .or_else(|| args.get("pane").and_then(Value::as_u64))
        .or_else(|| {
            let text = args.get("args").and_then(Value::as_str)?.trim().to_string();
            text.trim_start_matches('%').parse::<u64>().ok()
        })
        .or_else(|| api::pumi_get_current_pane().ok())
}

fn init(_plugin: &mut Plugin, cx: &mut App) {
    declare_option(
        "interval",
        json!({ "type": "number", "default": 5, "desc": "How often every terminal is measured, in seconds." }),
    );
    declare_option(
        "cpu",
        json!({ "type": "number", "default": 150, "desc": "A terminal using more CPU than this (100 is one core) is heavy." }),
    );
    declare_option(
        "memory",
        json!({ "type": "number", "default": 4096, "desc": "A terminal holding more memory than this, in MB, is heavy." }),
    );
    declare_option(
        "sustain",
        json!({ "type": "number", "default": 3, "desc": "How many checks in a row it must be heavy for." }),
    );
    declare_option(
        "auto_sleep",
        json!({ "type": "boolean", "default": false, "desc": "Suspend its foreground job right away." }),
    );
    let sleep_spec = json!({
        "desc": "Suspend a terminal's foreground job, as ctrl+z would.",
        "parameters": [["number", "pane"]],
        "examples": [{ "args": [] }],
    });
    if let Err(err) = api::provide("heavy_terminals.sleep", sleep_spec, |args| match pane_of(&args) {
        Some(pane) => {
            sleep(pane);
            Ok(Value::Null)
        }
        None => Err(api::Error::new("invalid_params", "no pane to put to sleep")),
    }) {
        eprintln!("heavy-terminals: {err}");
    }
    let wake_spec = json!({
        "desc": "Wake a terminal put to sleep.",
        "parameters": [["number", "pane"]],
        "examples": [{ "args": [] }],
    });
    if let Err(err) = api::provide("heavy_terminals.wake", wake_spec, |args| match pane_of(&args) {
        Some(pane) => {
            wake(pane);
            Ok(Value::Null)
        }
        None => Err(api::Error::new("invalid_params", "no pane to wake")),
    }) {
        eprintln!("heavy-terminals: {err}");
    }
    // Its user commands, the way tmux's are called (`HeavyWake %3`); best effort, since user
    // commands are tmux's to serve.
    let _ = api::pumi_create_user_command(
        "HeavySleep",
        Value::Null,
        json!({ "call": "heavy_terminals.sleep", "nargs": "?", "desc": "Suspend a terminal's foreground job, as ctrl+z would." }),
    );
    let _ = api::pumi_create_user_command(
        "HeavyWake",
        Value::Null,
        json!({ "call": "heavy_terminals.wake", "nargs": "?", "desc": "Wake a terminal put to sleep." }),
    );
    start(cx);
}

pumi_plugin::plugin!(init);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ps_times_are_seconds() {
        assert_eq!(seconds("0:05"), 5.);
        assert_eq!(seconds("1:00:00"), 3_600.);
        assert_eq!(seconds("2-03:04:05"), 2. * 86_400. + 3. * 3_600. + 4. * 60. + 5.);
        assert_eq!(seconds("0:00.50"), 0.5);
    }

    #[test]
    fn a_pane_costs_what_it_and_its_children_cost() {
        let mut procs = HashMap::new();
        procs.insert(10, Proc { ppid: 1, cpu: 2., rss: 1000. });
        procs.insert(11, Proc { ppid: 10, cpu: 3., rss: 2000. });
        procs.insert(12, Proc { ppid: 11, cpu: 4., rss: 3000. });
        procs.insert(13, Proc { ppid: 1, cpu: 9., rss: 9000. });
        assert_eq!(usage(&procs, 10), (9., 6000.));
        assert_eq!(usage(&procs, 13), (9., 9000.));
        assert_eq!(usage(&procs, 99), (0., 0.));
    }
}
