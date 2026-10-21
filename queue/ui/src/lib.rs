//! queue: commands that run one at a time, each after the pane it waits for is done.
//!
//! The waiting is pumi's own events — a pane's `@agent_status` (OSC 7501, so an agent's turn),
//! its `pane_foreground_pgid` back to its shell (a plain command finished), `pane_dead` (its
//! program exited) — and what the queue does with them is here. Each pane that has work gets a
//! bar under it (`winbar.bottom`, `@rows` high): the jobs waiting for that pane, and the one
//! running in it.
//!
//! ```sh
//! pumi call queue.add '{"command":"cargo test","after":"%3"}'   # under %3, after %3 is done
//! pumi call queue.add '{"command":"make deploy","run":"shell"}' # under this pane, headless
//! pumi call queue.list
//! ```
//!
//! A package's component runs in the app (23), so the queue lives while the app is open; a
//! component that traps and restarts loses what it held (a job's pane is its record).

use std::cell::{Cell, RefCell};
use std::time::{SystemTime, UNIX_EPOCH};

use pumi_plugin::gpui::{App, WeakEntity};
use pumi_plugin::prelude::*;

mod board;
mod job;

use board::Board;
pub use job::{Armed, Facts, Job, On, Run, State};

/// The bar's pane type: one under each pane that has work.
const VIEW: &str = "queue.board";
/// The most jobs a queue keeps; the oldest settled go past it.
const LIMIT: usize = 50;

thread_local! {
    static JOBS: RefCell<Vec<Job>> = RefCell::new(Vec::new());
    static NEXT: Cell<u64> = const { Cell::new(1) };
    static DIRTY: Cell<bool> = const { Cell::new(true) };
    static BOARDS: RefCell<Vec<WeakEntity<Board>>> = RefCell::new(Vec::new());
    static ARMED: RefCell<Armed> = RefCell::new(Armed::default());
    /// Nothing opens or closes a bar while a bar is being opened or closed.
    static SYNCING: Cell<bool> = const { Cell::new(false) };
}

// ---- options

fn declare(name: &str, spec: Value) {
    if let Err(err) = api::pumi_create_option(&format!("queue.{name}"), spec) {
        eprintln!("queue: {err}");
    }
}

fn flag(name: &str, default: bool) -> bool {
    api::option(&format!("queue.{name}"), json!({}))
        .ok()
        .and_then(|value| value.as_bool())
        .unwrap_or(default)
}

fn rows() -> u64 {
    api::option("queue.rows", json!({}))
        .ok()
        .and_then(|value| value.as_u64())
        .unwrap_or(4)
        .clamp(2, 12)
}

// ---- what a pane says of itself (23 §6)

fn option_of(pane: u64, name: &str) -> Value {
    api::option(name, json!({ "pane": pane })).unwrap_or(Value::Null)
}

fn text_of(pane: u64, name: &str) -> Option<String> {
    option_of(pane, name).as_str().map(str::to_string)
}

fn number_of(pane: u64, name: &str) -> Option<u64> {
    option_of(pane, name).as_u64()
}

/// A pane's facts, as the host keeps them: its program's report, whether it exited, and whether
/// its first process (its shell) has the terminal again.
fn facts(pane: u64) -> Facts {
    let agent = text_of(pane, "@agent_status").and_then(|word| job::Agent::parse(&word));
    let (foreground, shell) = (
        number_of(pane, "pane_foreground_pgid"),
        number_of(pane, "pane_pid"),
    );
    Facts {
        dead: option_of(pane, "pane_dead") == json!(true),
        agent,
        at_rest: foreground.is_some() && foreground == shell,
    }
}

fn exit_of(pane: u64) -> Option<i32> {
    number_of(pane, "pane_dead_status").map(|status| status as i32)
}

/// Whether a pane is still there.
fn present(pane: u64) -> bool {
    api::pumi_list_panes(json!({}))
        .ok()
        .and_then(|list| list.as_array().map(|list| list.contains(&json!(pane))))
        .unwrap_or(false)
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---- the queue

/// Every job, oldest first.
pub(crate) fn jobs() -> Vec<Job> {
    JOBS.with(|jobs| jobs.borrow().clone())
}

/// The jobs a pane's bar shows, in the order they will run.
pub(crate) fn jobs_of(owner: u64) -> Vec<Job> {
    let now = now_ms();
    let mine: Vec<Job> = jobs()
        .into_iter()
        .filter(|job| job.home() == owner && job.shown(now))
        .collect();
    let pick = |wanted: fn(&Job) -> bool| {
        mine.iter()
            .filter(|job| wanted(job))
            .cloned()
            .collect::<Vec<Job>>()
    };
    let mut list = pick(|job| job.state.running());
    list.extend(pick(|job| job.state == State::Waiting));
    let mut over = pick(Job::over);
    over.reverse();
    list.extend(over);
    list
}

/// Whether anything is waiting or running (the bars tick faster then).
pub(crate) fn busy() -> bool {
    JOBS.with(|jobs| jobs.borrow().iter().any(|job| !job.over()))
}

fn find(id: u64) -> Option<Job> {
    JOBS.with(|jobs| jobs.borrow().iter().find(|job| job.id == id).cloned())
}

fn put(id: u64, f: impl FnOnce(&mut Job)) {
    let mut done = false;
    JOBS.with(|jobs| {
        if let Some(job) = jobs.borrow_mut().iter_mut().find(|job| job.id == id) {
            f(job);
            done = true;
        }
    });
    if done {
        DIRTY.set(true);
    }
}

/// End a job: what it became, and when.
fn settle(job: &mut Job, state: State, now: u64) {
    job.state = state;
    job.ended = Some(now);
}

fn ready(job: &Job) -> bool {
    let Some((pane, on)) = job.after else {
        return true;
    };
    if ARMED.with(|armed| armed.borrow().held(pane)) {
        return false;
    }
    facts(pane).holds(on)
}

/// Put the first job whose wait is over to work, or finish the one that is.
pub(crate) fn advance() {
    let now = now_ms();
    let mut list = JOBS.with(|jobs| jobs.borrow().clone());
    let mut dirty = false;

    // A pane typed into is not done until it was seen busy, or long enough that its command was
    // over before anyone looked.
    for pane in ARMED.with(|armed| armed.borrow().panes()) {
        let at_rest = facts(pane).at_rest;
        ARMED.with(|armed| armed.borrow_mut().observe(pane, at_rest, now));
    }

    // A pane that closed while the queue held a job for it is done with whatever it was doing.
    if list
        .iter()
        .any(|job| job.state == State::Waiting && job.after.is_some())
    {
        let panes = api::pumi_list_panes(json!({}))
            .ok()
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();
        for job in list.iter_mut() {
            if job.state == State::Waiting
                && job
                    .after
                    .is_some_and(|(pane, _)| !panes.contains(&json!(pane)))
            {
                job.after = None;
                dirty = true;
            }
        }
    }

    // A job run in a pane is finished when that pane is at rest again, or its program exited.
    for job in list.iter_mut() {
        let State::Running {
            pane: Some(pane),
            at,
        } = job.state
        else {
            continue;
        };
        if ARMED.with(|armed| armed.borrow().held(pane)) {
            continue;
        }
        // A pane the queue opened runs one command: it is over when that program exits. A pane
        // it typed into is a terminal whose shell we can only watch.
        let wanted = match job.opened {
            Some(_) => On::Exit,
            None => On::Done,
        };
        if facts(pane).holds(wanted) {
            let status = exit_of(pane);
            settle(
                job,
                State::Done {
                    status,
                    took: now.saturating_sub(at),
                },
                now,
            );
            dirty = true;
            say(job);
        }
    }

    // One at a time, in the order they were added.
    if !list.iter().any(|job| job.state.running()) {
        if let Some(job) = list
            .iter_mut()
            .find(|job| job.state == State::Waiting && ready(job))
        {
            start(job);
            dirty = true;
        }
    }

    if dirty {
        JOBS.with(|jobs| *jobs.borrow_mut() = list);
        DIRTY.set(true);
        sync_views();
    }
}

/// Start a job: in a pane of its own, in the app, or typed into a terminal it named.
fn start(job: &mut Job) {
    let now = now_ms();
    match job.run.clone() {
        Run::Pane(pane) => match api::pumi_pane_call(
            pane,
            "input",
            json!({ "text": format!("{}\r", job.command) }),
        ) {
            Ok(_) => {
                ARMED.with(|armed| armed.borrow_mut().stamp(pane, now));
                job.state = State::Running {
                    pane: Some(pane),
                    at: now,
                };
            }
            Err(err) => settle(
                job,
                State::Failed {
                    why: format!("%{pane}: {err}"),
                },
                now,
            ),
        },
        Run::New => {
            let cwd = job.cwd.clone().or_else(|| {
                job.after
                    .and_then(|(pane, _)| text_of(pane, "pane_current_path"))
            });
            let mut args = json!({ "command": job.command.clone() });
            if let Some(cwd) = &cwd {
                args["cwd"] = json!(cwd);
            }
            let place = json!({ "kind": "tiled", "split": "down", "focus": false });
            match api::pumi_open_pane("terminal", args, place) {
                Ok(pane) => {
                    // Its output stays for the user when it is over, until the queue is cleared.
                    let _ = api::set_option("remain_on_exit", json!(true), json!({ "pane": pane }));
                    job.opened = Some(pane);
                    job.state = State::Running {
                        pane: Some(pane),
                        at: now,
                    };
                }
                Err(err) => settle(
                    job,
                    State::Failed {
                        why: format!("{err}"),
                    },
                    now,
                ),
            }
        }
        Run::Shell => {
            let mut command = system::Command::new("sh");
            command = command.arg("-c").arg(&job.command);
            if let Some(cwd) = &job.cwd {
                command = command.cwd(cwd);
            }
            let id = job.id;
            match command.spawn(move |event, cx| heard(id, &event, cx)) {
                Ok(_) => {
                    job.state = State::Running {
                        pane: None,
                        at: now,
                    }
                }
                Err(err) => settle(
                    job,
                    State::Failed {
                        why: format!("sh: {err}"),
                    },
                    now,
                ),
            }
        }
    }
}

/// A headless job's output: its last line, and the end of it.
fn heard(id: u64, event: &Value, cx: &mut App) {
    let text = event
        .get("stdout")
        .and_then(Value::as_str)
        .or_else(|| event.get("stderr").and_then(Value::as_str));
    if let Some(text) = text {
        if let Some(line) = text
            .lines()
            .rev()
            .map(str::trim)
            .find(|line| !line.is_empty())
        {
            put(id, |job| job.tail = line.to_string());
        }
    }
    if let Some(status) = event.get("exit").and_then(Value::as_i64) {
        let now = now_ms();
        put(id, |job| {
            if let State::Running { at, .. } = job.state {
                settle(
                    job,
                    State::Done {
                        status: Some(status as i32),
                        took: now.saturating_sub(at),
                    },
                    now,
                );
            }
        });
        if let Some(job) = find(id) {
            say(&job);
        }
        advance();
        pulse(cx);
    }
}

/// Say a job is over, as the OS says it (`pumi_notify`, 23 §5).
fn say(job: &Job) {
    if !flag("notify", true) {
        return;
    }
    let (level, message) = match &job.state {
        State::Done {
            status: Some(0),
            took,
        } => (
            "info",
            format!("queue: {} ✓ {}", job.label, job::clock(*took)),
        ),
        State::Done { status, took } => (
            "warn",
            format!(
                "queue: {} exited {} after {}",
                job.label,
                status.map(|s| s.to_string()).unwrap_or_else(|| "?".into()),
                job::clock(*took)
            ),
        ),
        State::Failed { why } => ("error", format!("queue: {} failed: {why}", job.label)),
        _ => return,
    };
    let _ = api::pumi_notify(&message, Some(level), json!({}));
}

/// A pane closed: the job that ran in it is over, whatever its status was.
pub(crate) fn vanished(pane: u64) {
    let now = now_ms();
    ARMED.with(|armed| armed.borrow_mut().forget(pane));
    let mut finished = Vec::new();
    JOBS.with(|jobs| {
        for job in jobs.borrow_mut().iter_mut() {
            match job.state.clone() {
                State::Running {
                    pane: Some(open),
                    at,
                } if open == pane => {
                    let status = exit_of(pane);
                    settle(
                        job,
                        State::Done {
                            status,
                            took: now.saturating_sub(at),
                        },
                        now,
                    );
                    finished.push(job.clone());
                }
                // A pane that is gone is done with whatever it was doing: the wait is over.
                State::Waiting if job.after.is_some_and(|(waited, _)| waited == pane) => {
                    job.after = None;
                }
                _ => {}
            }
        }
    });
    for job in finished {
        say(&job);
    }
    DIRTY.set(true);
}

/// Cancel a job that has not started (`queue.cancel`).
pub(crate) fn cancel_job(id: u64) -> bool {
    let mut cancelled = false;
    put(id, |job| {
        if job.state == State::Waiting {
            job.state = State::Cancelled;
            job.ended = Some(now_ms());
            cancelled = true;
        }
    });
    cancelled
}

/// Forget the jobs that are over, and the panes they opened (`queue.clear`).
fn clear() -> usize {
    let panes: Vec<u64> = JOBS.with(|jobs| {
        jobs.borrow()
            .iter()
            .filter(|job| job.over())
            .filter_map(|job| job.opened)
            .collect()
    });
    for pane in panes {
        if present(pane) {
            let _ = api::pumi_pane_close(pane, Some(true));
        }
    }
    let before = JOBS.with(|jobs| jobs.borrow().len());
    JOBS.with(|jobs| jobs.borrow_mut().retain(|job| !job.over()));
    let after = JOBS.with(|jobs| jobs.borrow().len());
    DIRTY.set(true);
    sync_views();
    before - after
}

/// The queue as other surfaces read it (`queue.list`).
fn public(job: &Job, now: u64) -> Value {
    let (state, status) = match &job.state {
        State::Waiting => ("waiting", Value::Null),
        State::Running { .. } => ("running", Value::Null),
        State::Done { status, .. } => ("done", json!(status)),
        State::Failed { .. } => ("failed", Value::Null),
        State::Cancelled => ("cancelled", Value::Null),
    };
    json!({
        "id": job.id,
        "command": job.command,
        "name": job.label,
        "state": state,
        "status": status,
        "detail": job.detail(now),
        "after": job.after.map(|(pane, on)| json!({ "pane": pane, "on": on.word() })),
        "run": match job.run {
            Run::New => json!("new"),
            Run::Shell => json!("shell"),
            Run::Pane(pane) => json!(format!("%{pane}")),
        },
        "pane": match job.state {
            State::Running { pane, .. } => json!(pane),
            _ => json!(job.opened),
        },
        "bar": job.home(),
        "tail": job.tail,
    })
}

/// Run the queue up to now, and redraw the bars when it changed.
pub(crate) fn pulse(cx: &mut App) {
    advance();
    if DIRTY.replace(false) {
        notify(cx);
    }
}

/// Redraw every bar that is still there; the ones that are gone drop out.
pub(crate) fn notify(cx: &mut App) {
    BOARDS.with(|boards| {
        boards
            .borrow_mut()
            .retain(|board| board.update(cx, |_, cx| cx.notify()).is_ok())
    });
}

/// Keep a bar for every pane that has work, and none for the rest.
fn sync_views() {
    if SYNCING.get() {
        return;
    }
    SYNCING.set(true);
    let now = now_ms();
    let mut wanted: std::collections::BTreeMap<u64, usize> = std::collections::BTreeMap::new();
    for job in jobs() {
        if job.shown(now) {
            *wanted.entry(job.home()).or_default() += 1;
        }
    }
    // The bars there are: which pane each is on.
    let mut bars: Vec<(u64, u64)> = Vec::new();
    if let Some(list) = api::pumi_list_panes(json!({ "type": VIEW }))
        .ok()
        .and_then(|value| value.as_array().cloned())
    {
        for pane in list.iter().filter_map(Value::as_u64) {
            let place = api::pumi_pane_get_place(pane).unwrap_or(Value::Null);
            match place["owner"].as_u64() {
                Some(owner) if place["name"] == "winbar.bottom" => bars.push((pane, owner)),
                // One left somewhere else (an older version's bar) is nobody's now.
                _ => {
                    let _ = api::pumi_pane_close(pane, Some(true));
                }
            }
        }
    }
    for (bar, owner) in bars {
        match wanted.remove(&owner) {
            Some(jobs) => fit(bar, jobs),
            None => {
                let _ = api::pumi_pane_close(bar, Some(true));
            }
        }
    }
    for (owner, jobs) in wanted {
        if !present(owner) {
            continue;
        }
        let place = json!({ "kind": "slot", "slot": "winbar.bottom", "owner": owner, "order": 10, "focus": false });
        match api::pumi_open_pane(VIEW, json!({ "pane": owner }), place) {
            Ok(bar) => fit(bar, jobs),
            Err(err) => eprintln!("queue: %{owner}: {err}"),
        }
    }
    SYNCING.set(false);
}

/// A bar's height: its title and a row a job, never as many as the setting allows.
fn fit(bar: u64, jobs: usize) {
    let rows = ((jobs as u64).saturating_add(1)).min(rows());
    if number_of(bar, "@rows") == Some(rows) {
        return;
    }
    if let Err(err) = api::set_option("@rows", json!(rows), json!({ "pane": bar })) {
        eprintln!("queue: %{bar}: {err}");
    }
}

fn init(plugin: &mut Plugin, cx: &mut App) {
    declare(
        "rows",
        json!({
            "type": "number", "default": 4, "min": 2, "max": 12, "step": 1,
            "label": "Rows", "group": "Queue",
            "desc": "The most rows a pane's bar takes: its title and this many jobs.",
        }),
    );
    declare(
        "keep",
        json!({
            "type": "boolean", "default": true, "label": "Keep a finished job's pane",
            "desc": "A job that ran in a pane of its own leaves that pane (and its output) open when it is done.",
        }),
    );
    declare(
        "notify",
        json!({
            "type": "boolean", "default": true, "label": "Say when a job finishes",
            "desc": "A notification when a job is over, as the OS gives one.",
        }),
    );

    let add = json!({
        "desc": "Add a command to the queue: it runs when the pane it waits for is done, and when everything before it is.",
        "parameters": [["table", "spec"]],
        "examples": [
            { "args": [{ "command": "cargo test", "after": "%3" }] },
            { "args": [{ "command": "say done", "run": "shell" }] },
            { "args": [{ "command": "make deploy", "after": { "pane": 5, "on": "done" }, "run": "pane:%7" }] },
        ],
    });
    if let Err(err) = api::provide("queue.add", add, |args| {
        let id = NEXT.with(|next| {
            let id = next.get();
            next.set(id + 1);
            id
        });
        let origin = api::pumi_get_current_pane().unwrap_or(0);
        let job = Job::parse(id, &args, now_ms(), origin)
            .map_err(|why| api::Error::new("invalid_params", why))?;
        if let Some((pane, _)) = job.after {
            if !present(pane) {
                return Err(api::Error::new("not_found", format!("no pane %{pane}")));
            }
        }
        JOBS.with(|jobs| {
            let mut jobs = jobs.borrow_mut();
            jobs.push(job);
            if jobs.len() > LIMIT {
                let gone = jobs.len() - LIMIT;
                let mut removed = 0;
                jobs.retain(|job| {
                    if removed < gone && job.over() {
                        removed += 1;
                        false
                    } else {
                        true
                    }
                });
            }
        });
        DIRTY.set(true);
        advance();
        sync_views();
        Ok(json!(id))
    }) {
        eprintln!("queue: {err}");
    }

    let list = json!({
        "desc": "The queue: every job, its state, what it waits for and where it runs.",
        "parameters": [],
        "examples": [{ "args": [] }],
    });
    if let Err(err) = api::provide("queue.list", list, |_| {
        let now = now_ms();
        Ok(json!(
            jobs()
                .iter()
                .map(|job| public(job, now))
                .collect::<Vec<Value>>()
        ))
    }) {
        eprintln!("queue: {err}");
    }

    let cancel = json!({
        "desc": "Cancel a job that has not started.",
        "parameters": [["number", "id"]],
        "examples": [{ "args": [{ "id": 3 }] }],
    });
    if let Err(err) = api::provide("queue.cancel", cancel, |args| {
        let id = job::pane_id(args.get("id").unwrap_or(&args))
            .ok_or_else(|| api::Error::new("invalid_params", "queue.cancel needs an `id`"))?;
        if !cancel_job(id) {
            return Err(api::Error::new(
                "invalid_params",
                format!("job {id} is not waiting"),
            ));
        }
        advance();
        sync_views();
        Ok(json!(true))
    }) {
        eprintln!("queue: {err}");
    }

    let clear_spec = json!({
        "desc": "Forget the jobs that are over, and close the panes they opened.",
        "parameters": [],
        "examples": [{ "args": [] }],
    });
    if let Err(err) = api::provide("queue.clear", clear_spec, |_| Ok(json!(clear()))) {
        eprintln!("queue: {err}");
    }

    plugin.view("board", |open, _window, cx| {
        let owner = open.args["pane"].as_u64().unwrap_or(open.pane);
        let board = cx.new(|cx| Board::new(owner, cx));
        BOARDS.with(|boards| boards.borrow_mut().push(board.downgrade()));
        board.into()
    });

    // A pane's report, its shell coming back, its program ending: any of them can end a wait.
    let following = json!({
        "pattern": ["@agent_status", "pane_current_command", "pane_foreground_pgid", "pane_dead"],
        "desc": "the queue follows the panes it waits for",
    });
    if let Err(err) = api::autocmd("OptionSet", following, |_, cx| pulse(cx)) {
        eprintln!("queue: {err}");
    }
    if let Err(err) = api::autocmd("TermClose", json!({}), |_, cx| pulse(cx)) {
        eprintln!("queue: {err}");
    }
    if let Err(err) = api::autocmd("PaneClosed", json!({}), |event, cx| {
        if let Some(pane) =
            job::pane_id(&event["pane"]).or_else(|| job::pane_id(&event["data"]["pane"]))
        {
            vanished(pane);
        }
        pulse(cx);
    }) {
        eprintln!("queue: {err}");
    }

    // The bar this package used to put in `chrome.regions` is a pane's now: take the entry out.
    forget_region();
    advance();
    sync_views();
    pulse(cx);
}

/// Drop a `queue` region an earlier version left in `chrome.regions`, and nothing else.
fn forget_region() {
    let Some(list) = api::option("chrome.regions", json!({}))
        .ok()
        .and_then(|value| value.as_array().cloned())
    else {
        return;
    };
    if !list
        .iter()
        .any(|entry| entry.get("name").and_then(Value::as_str) == Some("queue"))
    {
        return;
    }
    let kept: Vec<Value> = list
        .into_iter()
        .filter(|entry| entry.get("name").and_then(Value::as_str) != Some("queue"))
        .collect();
    if let Err(err) = api::pumi_settings_set("chrome.regions", Value::Array(kept)) {
        eprintln!("queue: {err}");
    }
}

pumi_plugin::plugin!(init, api = 1);
