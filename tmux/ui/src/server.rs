//! What was the process (17 §6), in the app (23 §3): tmux's functions are provided through
//! the app (`api::provide`) instead of registered over a socket; the mirror follows the core's
//! events through an autocmd on `*` instead of a subscription; jobs are the app's processes
//! (`system::Command`) instead of threads; timers are a task on the plugin's executor instead
//! of the loop's timeout.
//!
//! The mirror and the registry live as long as the plugin, on its one thread. A call to
//! another plugin's function (a script's user command) may call back (`pumi_cmd` again): the SDK
//! answers it while the first call waits, on the same stack, as `call_serving` did, so the
//! function that answers reaches the same kernel the waiting one holds — what `Kernel::serve`
//! was handed in pumi-tmux.

use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use pumi_api::{Caller, Registry};
use pumi_plugin::gpui::App;
use pumi_plugin::{api, system};
use serde_json::{Value, json};

use crate::cmd::{Cmd, Job};
use crate::kernel::core::Core;
use crate::kernel::events::{About, Event, SUBSCRIPTION, flush};
use crate::kernel::{Config as KernelConfig, Kernel, SERVER};

/// How long the timer task sleeps with nothing due.
const IDLE: Duration = Duration::from_millis(250);

thread_local! {
    /// The registry and the kernel, made once by [`start`] and never freed.
    static STATE: Cell<Option<(&'static Registry, *mut Kernel)>> = const { Cell::new(None) };
    /// How deep provided calls nest: only the outermost runs the turn after it.
    static DEPTH: Cell<u32> = const { Cell::new(0) };
}

pub fn log(message: &str) {
    crate::kernel::log(message);
}

/// The registry and the kernel, for one piece of work. A nested call (a provided function
/// answered while tmux waits on `api::call`) gets the kernel the waiting call holds, as
/// `Kernel::serve` got it in pumi-tmux: the waiting call does not touch it until the nested
/// one returns.
fn with<R>(f: impl FnOnce(&'static Registry, &mut Kernel) -> R) -> Option<R> {
    let (registry, kernel) = STATE.get()?;
    // SAFETY: one thread; the kernel is leaked, so it lives as long as the plugin. See above
    // for why a nested call may reach it while an outer one waits.
    Some(f(registry, unsafe { &mut *kernel }))
}

fn server_caller() -> Caller {
    Caller { channel: SERVER, ..Caller::default() }
}

/// `$HOME`, as the app gave it.
pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// Starts tmux: the mirror, the registry, the functions, the events, the timers, the defaults.
pub fn start(cx: &mut App) {
    crate::kernel::set_name("tmux");
    let plugin = api::plugin();
    let mut kernel = Kernel::new(KernelConfig {
        name: "tmux".into(),
        socket: std::env::var_os("PUMI").map(PathBuf::from).unwrap_or_default(),
        // The app's environment is what its processes (the jobs) start with.
        base_env: std::env::vars().collect(),
        bin_dir: std::env::var_os("PUMI_BIN_DIR").map(PathBuf::from),
        data: plugin["data"].as_str().map(PathBuf::from).unwrap_or_default(),
    });
    kernel.ext.insert(crate::cmd::State::default());
    kernel.core = Some(Arc::new(Core));
    let kernel: &'static mut Kernel = Box::leak(Box::new(kernel));
    let registry: &'static Registry = Box::leak(Box::new(Registry::new()));
    // What the registry does not have is the core's, or another plugin's: through the app.
    registry.set_remote(Rc::new(|cx: &mut pumi_api::Cx, name: &str, args: Value| {
        let caller = cx.caller().clone();
        cx.host::<Kernel>()?.call_core(&caller, name, args)
    }));
    let specs = crate::api::specs();
    for spec in &specs {
        let Some(handler) = crate::api::handler(&spec.name) else {
            log(&format!("{}: no handler", spec.name));
            continue;
        };
        if let Err(err) = registry.create_function(spec.clone(), handler) {
            log(&format!("{}: {}", spec.name, err.message));
        }
    }
    STATE.set(Some((registry, kernel as *mut Kernel)));

    with(|_, kernel| introduce(kernel, &specs));
    let subscribed = api::autocmd("*", json!({ "desc": SUBSCRIPTION }), |args, _cx| arrived(args));
    if let Err(err) = subscribed {
        log(&format!("the core's events: {}", err.message));
    }
    for spec in specs {
        let name = spec.name.clone();
        let wire = serde_json::to_value(&spec).unwrap_or(Value::Null);
        let provided = api::provide(&spec.name, wire, move |args| serve(&name, args));
        if let Err(err) = provided {
            log(&format!("providing {}: {}", spec.name, err.message));
        }
    }
    crate::defaults::declare_options();
    crate::defaults::install();
    with(|registry, kernel| turn(registry, kernel));
    timers(cx);
    log("serving tmux's functions");
}

/// Reads the model, and which functions only read (calling one does not move the mirror).
fn introduce(kernel: &mut Kernel, mine: &[pumi_api::FunctionInfo]) {
    kernel.stale = true;
    kernel.sync();
    let Ok(core) = kernel.core() else { return };
    let theirs = core.call("pumi_get_api_info", json!([]), None).unwrap_or(Value::Null);
    let read = |effect: &Value| effect == "read";
    kernel.reads = theirs["functions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| read(&f["effect"]))
        .filter_map(|f| f["name"].as_str().map(str::to_string))
        .chain(mine.iter().filter(|f| f.effect == pumi_api::Effect::Read).map(|f| f.name.clone()))
        .chain(["pumi_get_api_info".to_string(), "pumi_call_atomic".to_string()])
        .collect();
}

/// Who called a provided function, as the app says (`{"chan", "name", "pane", "client"}`).
fn caller_of(caller: Option<Value>) -> Caller {
    let c = caller.unwrap_or(Value::Null);
    let client = match &c["client"] {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        _ => None,
    };
    Caller { channel: c["chan"].as_u64().unwrap_or(SERVER), client, pane: c["pane"].as_u64(), source: None }
}

fn wire_error(err: pumi_api::Error) -> api::Error {
    api::Error::new(err.kind.name(), err.message)
}

/// Answers a call to one of tmux's functions.
fn serve(name: &str, args: Value) -> Result<Value, api::Error> {
    let caller = caller_of(api::caller());
    let depth = DEPTH.get();
    DEPTH.set(depth + 1);
    let result = with(|registry, kernel| {
        // A call that comes back while one waits: the model moved under the waiting one.
        if depth > 0 {
            kernel.stale = true;
        }
        let outer = (kernel.rpc.take(), kernel.defer.take());
        kernel.sync();
        kernel.rpc = Some(caller.channel);
        let result = registry.with_cx(kernel, &caller, |cx| cx.call(name, args));
        (kernel.rpc, kernel.defer) = outer;
        if depth == 0 {
            turn(registry, kernel);
        }
        result
    });
    DEPTH.set(depth);
    match result {
        Some(result) => result.map_err(wire_error),
        None => Err(api::Error::new("provider_unavailable", "tmux has not started")),
    }
}

/// An event of the core's, as the autocmd's callback gets it.
fn event_of(args: &Value) -> Option<Event> {
    if let Ok(event) = serde_json::from_value::<Event>(args.clone()) {
        return Some(event);
    }
    let id = |key: &str| args[key].as_u64();
    Some(Event {
        seq: args["seq"].as_u64().unwrap_or(0),
        event: args["event"].as_str()?.to_string(),
        matched: args["match"].as_str().unwrap_or_default().to_string(),
        about: About { session: id("session"), tab: id("tab"), pane: id("pane") },
        data: args["data"].clone(),
    })
}

/// An event arrived: the mirror follows it, and tmux's own autocmds (queues waiting on it) run.
fn arrived(args: Value) {
    with(|registry, kernel| {
        match event_of(&args) {
            Some(event) => {
                kernel.mirror_event(&event);
                kernel.events.arrived(event);
            }
            None => kernel.stale = true,
        }
        if DEPTH.get() == 0 {
            turn(registry, kernel);
        }
    });
}

/// After anything happened: run the autocmds of the events that arrived, send what is owed to
/// other channels (`pumi_attach`, …), and start the jobs no call waits on.
fn turn(registry: &'static Registry, kernel: &mut Kernel) {
    let server = server_caller();
    for _ in 0..1000 {
        if kernel.events.has_pending()
            && let Err(err) = registry.with_cx(kernel, &server, flush)
        {
            log(&format!("events: {}", err.message));
        }
        let out = std::mem::take(&mut kernel.out);
        if let Ok(core) = kernel.core() {
            for (chan, message) in out {
                let parsed: Value = serde_json::from_str(&message).unwrap_or(Value::Null);
                match parsed.get("method").and_then(Value::as_str) {
                    Some(method) => core.notify("pumi_chan_notify", json!([chan, method, parsed["params"]])),
                    None => core.write(&message),
                }
            }
        }
        let jobs = std::mem::take(&mut kernel.cmd().pending_jobs);
        for job in jobs {
            spawn(registry, kernel, job);
        }
        if !kernel.events.has_pending() && kernel.cmd().pending_jobs.is_empty() {
            break;
        }
    }
}

// ---- jobs

/// The job as a program: `shell -c command`, under `env -u` for what it removes.
fn command(job: &Job) -> system::Command {
    let mut command = if job.unset.is_empty() {
        system::Command::new(&job.shell)
    } else {
        let unset = job.unset.iter().flat_map(|name| ["-u".to_string(), name.clone()]);
        system::Command::new("/usr/bin/env").args(unset).arg(&job.shell)
    };
    command = command.arg("-c").arg(&job.command).cwd(&job.cwd).stdin(Vec::new());
    for (name, value) in &job.env {
        command = command.env(name, value);
    }
    command
}

/// Runs a job to its end, for the call that waits on it (`cmd::drive`): its status and what it
/// printed, stdout then stderr.
pub fn run_job(job: &Job) -> (Option<i32>, String) {
    match command(job).run() {
        Ok(output) => {
            let mut text = output.stdout_text();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            (Some(output.status), text)
        }
        Err(err) => (Some(127), format!("{}: {err}\n", job.shell)),
    }
}

/// Starts a job no call waits on (`run-shell -b`, a hook's, a key's): its queue goes on when it
/// exits.
fn spawn(registry: &'static Registry, kernel: &mut Kernel, job: Job) {
    let id = job.id;
    let output = Rc::new(RefCell::new(String::new()));
    let collected = output.clone();
    let started = command(&job).spawn(move |message, _cx| {
        for stream in ["stdout", "stderr"] {
            if let Some(text) = message[stream].as_str() {
                collected.borrow_mut().push_str(text);
            }
        }
        if let Some(exit) = message.get("exit") {
            let status = exit.as_i64().map(|s| s as i32);
            let text = std::mem::take(&mut *collected.borrow_mut());
            with(|registry, kernel| {
                registry.with_cx(kernel, &server_caller(), |cx| crate::cmd::job_done(cx, id, status, text));
                if DEPTH.get() == 0 {
                    turn(registry, kernel);
                }
            });
        }
    });
    if let Err(err) = started {
        drop(output);
        let text = format!("{}: {err}\n", job.shell);
        registry.with_cx(kernel, &server_caller(), |cx| crate::cmd::job_done(cx, id, Some(127), text));
    }
}

// ---- timers

/// Due timers fire (`wait-pane --for`, `-d` delays), and the monitors are looked at once a
/// second: a task that sleeps until the next deadline.
fn timers(cx: &mut App) {
    cx.spawn(async move |cx| {
        loop {
            let Some(next) = with(|_, kernel| kernel.cmd().next_deadline()) else { break };
            let wait = next.map(|at| at.saturating_duration_since(Instant::now())).unwrap_or(IDLE).min(IDLE);
            cx.background_executor().timer(wait).await;
            with(|registry, kernel| {
                if kernel.cmd().next_deadline().is_some_and(|at| at <= Instant::now()) {
                    registry.with_cx(kernel, &server_caller(), crate::cmd::tick);
                    turn(registry, kernel);
                }
            });
        }
    })
    .detach();
}
