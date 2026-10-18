//! Commands (docs/v2/03-commands.md): tmux's command language over the API. A command line —
//! from the CLI, a key binding, a hook, `source-file` or `pumi_cmd` — becomes a queue of
//! commands, run in order as whoever queued it. A command that waits (`run-shell`, `wait-for`,
//! `new-pane -W`, `wait-pane`) parks its queue, and whatever it waits on resumes it; a CLI call
//! that queued it gets its reply then.
//!
//! - [`table`]: every command, its flags and what runs it.
//! - [`builtin`]: the commands themselves, which call the API's functions.

pub mod builtin;
pub mod table;

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use pumi_api::{Caller, Cx, Error, ErrorKind, Result};
use pumi_lang::cmd::{Arg, Command, Env, Parsed, parse_args, print};
use pumi_lang::target::{Found, Kind};

use crate::kernel::events::{About, Action, Autocmd, Event};
use crate::kernel::format::Fmt;
use crate::kernel::layout::{Layout, PaneId};
use crate::kernel::{ChanId, Kernel, SessionId, TabId};

pub use table::{Entry, Exec};

/// What a command did to its queue.
pub enum Flow {
    /// Go on with the next command.
    Next,
    /// Run these first (`source-file`, `if-shell`, a user command).
    Insert(Vec<Command>),
    /// Park the queue; what the command waits on resumes it.
    Wait,
}

/// A paste buffer (tmux's).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct Buffer {
    pub name: String,
    pub data: String,
    pub created: u64,
    /// Named by the server (`buffer0`), so the oldest go when there are too many.
    pub automatic: bool,
    #[serde(skip, default)]
    pub order: u64,
}

/// An environment variable: `None` removes it from new panes' environments (`setenv -r`).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct Var {
    pub value: Option<String>,
    pub hidden: bool,
}

/// tmux's global and session environments, laid over the server's own for every new pane.
#[derive(Default)]
pub struct Environment {
    pub global: BTreeMap<String, Var>,
    pub sessions: HashMap<SessionId, BTreeMap<String, Var>>,
}

impl Environment {
    /// What a pane in `session` starts with, over the server's environment: set, or removed.
    pub fn for_session(&self, session: Option<SessionId>) -> BTreeMap<String, Option<String>> {
        let mut out: BTreeMap<String, Option<String>> = self
            .global
            .iter()
            .map(|(k, v)| (k.clone(), v.value.clone()))
            .collect();
        if let Some(vars) = session.and_then(|s| self.sessions.get(&s)) {
            out.extend(vars.iter().map(|(k, v)| (k.clone(), v.value.clone())));
        }
        out
    }
}

/// A key binding (tmux's `bind-key`, Neovim's mapping): a command line run when the key is
/// pressed in its table.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct Binding {
    pub table: String,
    pub key: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    /// tmux's `-r`: the key repeats without the prefix for `repeat-time`.
    #[serde(default)]
    pub repeat: bool,
    /// Only in this pane (Neovim's buffer-local mapping).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<PaneId>,
    /// Who mapped it (`init.lua:12`, `settings.json`, `cli`), which Settings shows (08 §3).
    #[serde(default)]
    pub source: String,
}

/// A user command (Neovim's `:command`): Capitalised, a command line with `<args>`, or a
/// function whose parameters are its flags.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct UserCommand {
    pub name: String,
    /// The command line it runs; `<args>`, `<q-args>`, `<f-args>` and `<bang>` are replaced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// Or the function it calls, its flags read from the function's parameters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub call: Option<String>,
    /// Or a function called with `{name, args, fargs, bang}`, as Neovim calls a Lua one (the
    /// host makes one of a Lua function).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub callback: Option<String>,
    /// `0`, `1`, `*`, `?` or `+`, as Neovim's `-nargs`.
    pub nargs: String,
    #[serde(default)]
    pub desc: String,
    pub source: String,
}

/// A `wait-for` channel.
#[derive(Default)]
struct Channel {
    woken: bool,
    waiters: Vec<u64>,
    locked: bool,
    lockers: VecDeque<u64>,
}

/// tmux 3.8's format monitor (`set-hook -B name:what:format`): fires `name` when the format
/// changes (or, with `-T`, becomes true) for any object it watches.
#[derive(Clone)]
pub struct Monitor {
    pub name: String,
    pub what: String,
    pub format: String,
    pub only_true: bool,
    pub last: HashMap<u64, String>,
    /// The session, tab and pane it was set from (`what` = `session`, `window`, `pane`).
    pub anchor: (Option<SessionId>, Option<TabId>, Option<PaneId>),
}

/// What a waiting queue is woken with.
#[derive(Default)]
pub struct Outcome {
    pub output: String,
    pub status: Option<i32>,
    pub insert: Vec<Command>,
    pub error: Option<Error>,
}

/// A command queue: tmux's `cmdq`, one per command line.
pub struct Queue {
    pub id: u64,
    /// Who queued it; its commands run as them. `pane` is the context pane (a hook's).
    pub caller: Caller,
    /// Where relative paths are: the CLI's directory.
    pub cwd: Option<PathBuf>,
    /// Format variables of the moment (`hook`, `hook_pane`, …).
    pub vars: BTreeMap<String, String>,
    pub items: VecDeque<Command>,
    pub output: String,
    pub status: Option<i32>,
    /// The JSON-RPC request waiting on it, answered when it ends.
    pub reply: Option<(ChanId, Value)>,
    /// A CLI is reading the output (rather than a key binding or a hook).
    pub interactive: bool,
}

impl Queue {
    pub fn print(&mut self, line: impl AsRef<str>) {
        self.output.push_str(line.as_ref());
        self.output.push('\n');
    }
}

/// What a timer does when it is due.
enum Timer {
    Resume(u64, Outcome),
    Fail(u64, String),
}

#[derive(Default)]
pub struct State {
    pub buffers: Vec<Buffer>,
    next_buffer: u64,
    pub env: Environment,
    pub user: BTreeMap<String, UserCommand>,
    channels: HashMap<String, Channel>,
    queues: BTreeMap<u64, Queue>,
    next_queue: u64,
    pub monitors: Vec<Monitor>,
    next_monitor: Option<Instant>,
    timers: Vec<(Instant, Timer)>,
    jobs: HashMap<u64, (u64, JobKind)>,
    next_job: u64,
    /// Jobs not started yet: the call that waits on one runs it at once (`drive`), the rest
    /// start after the turn (`server`).
    pub pending_jobs: Vec<Job>,
    /// What a queue a call drives ended with, until the call takes it.
    finished: HashMap<u64, Value>,
    /// `record start`: where each channel's recording began in the op log.
    pub recording: HashMap<ChanId, u64>,
    /// The tab layouts `select-layout -o` goes back to, and the preset each tab is on.
    pub last_layout: HashMap<TabId, Layout>,
    pub preset: HashMap<TabId, usize>,
    /// The marked pane (`select-pane -m`).
    pub marked: Option<PaneId>,
}

/// The command state, kept beside the mirror.
pub trait Cmd {
    fn cmd(&mut self) -> &mut State;
    /// Only to read: the process put it there at start.
    fn cmd_ref(&self) -> &State;
}

impl Cmd for Kernel {
    fn cmd(&mut self) -> &mut State {
        self.ext.get_or_default::<State>()
    }

    fn cmd_ref(&self) -> &State {
        self.ext
            .get::<State>()
            .expect("pumi-tmux keeps its command state beside the mirror")
    }
}

/// A shell command to run for a queue: what `spawn_job_for` made, for `server` to start.
#[derive(Clone, Debug)]
pub struct Job {
    pub id: u64,
    pub queue: u64,
    pub shell: String,
    pub command: String,
    pub cwd: String,
    /// Set over the app's environment.
    pub env: BTreeMap<String, String>,
    /// Removed from it (`setenv -r`).
    pub unset: Vec<String>,
}

/// The channel a queue's reply goes to when a call drives it (`drive`): kept, not sent.
const DRIVEN: ChanId = u64::MAX - 1;

/// What a finished job continues with.
#[derive(Clone)]
pub enum JobKind {
    /// `run-shell`: its output goes to the queue; a failure is an error.
    Run { command: String, show: bool },
    /// `if-shell`: which commands run.
    If { then: Arg, otherwise: Option<Arg> },
}

impl State {
    pub fn buffer(&self, name: Option<&str>) -> Option<&Buffer> {
        match name {
            Some(name) => self.buffers.iter().find(|b| b.name == name),
            None => self.buffers.iter().max_by_key(|b| b.order),
        }
    }

    /// Adds or replaces a buffer; without a name it is the next automatic one, and the oldest
    /// automatic ones go past `limit`.
    pub fn set_buffer(&mut self, name: Option<String>, data: String, limit: usize) -> String {
        self.next_buffer += 1;
        let order = self.next_buffer;
        let created = crate::kernel::state::epoch();
        if let Some(name) = name {
            match self.buffers.iter_mut().find(|b| b.name == name) {
                Some(buffer) => {
                    buffer.data = data;
                    buffer.order = order;
                }
                None => self.buffers.push(Buffer {
                    name: name.clone(),
                    data,
                    created,
                    automatic: false,
                    order,
                }),
            }
            return name;
        }
        let mut n = 0;
        while self.buffers.iter().any(|b| b.name == format!("buffer{n}")) {
            n += 1;
        }
        let name = format!("buffer{n}");
        self.buffers.push(Buffer {
            name: name.clone(),
            data,
            created,
            automatic: true,
            order,
        });
        let automatic = self.buffers.iter().filter(|b| b.automatic).count();
        if automatic > limit.max(1) {
            let mut auto: Vec<(u64, String)> = self
                .buffers
                .iter()
                .filter(|b| b.automatic)
                .map(|b| (b.order, b.name.clone()))
                .collect();
            auto.sort();
            for (_, old) in auto.into_iter().take(automatic - limit.max(1)) {
                self.buffers.retain(|b| b.name != old);
            }
        }
        name
    }

    /// When the server must look at commands next: a timer, or the monitors.
    pub fn next_deadline(&self) -> Option<Instant> {
        let timers = self.timers.iter().map(|(at, _)| *at).min();
        let monitors =
            (!self.monitors.is_empty()).then(|| self.next_monitor.unwrap_or_else(Instant::now));
        timers.into_iter().chain(monitors).min()
    }
}

fn kernel<'a>(cx: &'a mut Cx) -> &'a mut Kernel {
    let k = cx.host::<Kernel>().expect("commands run in the host");
    k.sync();
    k
}

// ---- queues

pub struct Start {
    pub caller: Caller,
    pub cwd: Option<PathBuf>,
    pub vars: BTreeMap<String, String>,
    pub interactive: bool,
}

/// Queues commands and runs them as far as they go: the queue's id, and its result when it
/// ended (`None` while a command waits).
pub fn start(cx: &mut Cx, commands: Vec<Command>, start: Start) -> Result<(u64, Option<Value>)> {
    let k = kernel(cx);
    k.cmd().next_queue += 1;
    let id = k.cmd().next_queue;
    let queue = Queue {
        id,
        caller: start.caller,
        cwd: start.cwd,
        vars: start.vars,
        items: commands.into(),
        output: String::new(),
        status: None,
        reply: None,
        interactive: start.interactive,
    };
    Ok((id, run(cx, queue)?))
}

/// Gives a waiting queue the request to answer when it ends.
pub fn answer_later(k: &mut Kernel, queue: u64, chan: ChanId, id: Value) -> bool {
    match k.cmd().queues.get_mut(&queue) {
        Some(q) => {
            q.reply = Some((chan, id));
            true
        }
        None => false,
    }
}

/// Runs a queue until it ends or waits.
fn run(cx: &mut Cx, mut queue: Queue) -> Result<Option<Value>> {
    while let Some(command) = queue.items.pop_front() {
        let caller = queue.caller.clone();
        let flow = cx.as_caller(&caller, |cx| exec(cx, &mut queue, &command));
        match flow {
            Ok(Flow::Next) => {}
            Ok(Flow::Insert(list)) => {
                for command in list.into_iter().rev() {
                    queue.items.push_front(command);
                }
            }
            Ok(Flow::Wait) => {
                kernel(cx).cmd().queues.insert(queue.id, queue);
                return Ok(None);
            }
            Err(err) => return Ok(finish(cx, queue, Err(err))),
        }
    }
    let result = finish(cx, queue, Ok(()));
    Ok(result)
}

/// A queue ended: its result, sent to the request waiting on it if there is one. The result is
/// returned only when no request waits (the call that ran it is still in progress).
fn finish(cx: &mut Cx, queue: Queue, outcome: Result<()>) -> Option<Value> {
    let result: Result<Value> = match outcome {
        Ok(()) => Ok(json!({ "output": queue.output, "status": queue.status })),
        Err(mut err) => {
            if !queue.output.is_empty() {
                let mut data = err
                    .data
                    .take()
                    .and_then(|d| d.as_object().cloned())
                    .unwrap_or_default();
                data.insert("output".into(), json!(queue.output));
                err.data = Some(Value::Object(data));
            }
            if !queue.interactive {
                kernel(cx).message("error", err.message.clone());
            }
            Err(err)
        }
    };
    let k = kernel(cx);
    match queue.reply {
        Some((DRIVEN, _)) => {
            let value = match result {
                Ok(value) => value,
                Err(err) => {
                    json!({ "error": err.message, "kind": err.kind.name(), "data": err.data })
                }
            };
            k.cmd().finished.insert(queue.id, value);
            None
        }
        Some((chan, id)) => {
            k.send(chan, pumi_api::rpc::reply(&id, result));
            None
        }
        None => match result {
            Ok(value) => Some(value),
            Err(err) => {
                // Carried to the caller through `start`: kept as an error value.
                Some(json!({ "error": err.message, "kind": err.kind.name(), "data": err.data }))
            }
        },
    }
}

/// Turns what `start` returned into the call's result.
pub fn into_result(value: Option<Value>) -> Result<Value> {
    match value {
        None => Ok(json!({ "output": "", "status": null, "waiting": true })),
        Some(value) if value.get("error").is_some() => {
            let message = value["error"].as_str().unwrap_or("failed").to_string();
            let kind = value["kind"]
                .as_str()
                .and_then(ErrorKind::from_name)
                .unwrap_or(ErrorKind::Exception);
            let mut err = Error::new(kind, message);
            if !value["data"].is_null() {
                err.data = Some(value["data"].clone());
            }
            Err(err)
        }
        Some(value) => Ok(value),
    }
}

/// Runs the jobs a waiting queue waits on now, for the call that started it (the app answers
/// a call when it returns): the queue's result if it ended, `None` if it still waits on
/// something else (an event, a timer, `wait-for`), which then goes on with no one waiting.
pub fn drive(cx: &mut Cx, queue: u64) -> Option<Value> {
    if let Some(q) = kernel(cx).cmd().queues.get_mut(&queue) {
        q.reply = Some((DRIVEN, Value::Null));
    }
    loop {
        let k = kernel(cx);
        if let Some(value) = k.cmd().finished.remove(&queue) {
            return Some(value);
        }
        if !waiting(k, queue) {
            return None;
        }
        let at = k.cmd().pending_jobs.iter().position(|j| j.queue == queue);
        let Some(at) = at else { break };
        let job = k.cmd().pending_jobs.remove(at);
        let (status, output) = crate::server::run_job(&job);
        job_done(cx, job.id, status, output);
    }
    let k = kernel(cx);
    if let Some(q) = k.cmd().queues.get_mut(&queue) {
        q.reply = None;
    }
    k.cmd().finished.remove(&queue)
}

/// Wakes a waiting queue and runs it on.
pub fn resume(cx: &mut Cx, id: u64, outcome: Outcome) {
    let Some(mut queue) = kernel(cx).cmd().queues.remove(&id) else {
        return;
    };
    queue.output.push_str(&outcome.output);
    if outcome.status.is_some() {
        queue.status = outcome.status;
    }
    for command in outcome.insert.into_iter().rev() {
        queue.items.push_front(command);
    }
    if let Some(err) = outcome.error {
        finish(cx, queue, Err(err));
        return;
    }
    // Anything it returns went to its request, or nobody waits for it.
    let _ = run(cx, queue);
}

/// Whether a queue is still waiting.
pub fn waiting(k: &Kernel, id: u64) -> bool {
    k.cmd_ref().queues.contains_key(&id)
}

// ---- one command

/// Finds the command a name means: a user command, a built-in by name, alias or unique prefix,
/// or a `command-alias`.
pub enum Found2 {
    Builtin(&'static Entry),
    User(UserCommand),
    Alias(Vec<Command>),
}

pub fn find(k: &Kernel, name: &str) -> Result<Found2> {
    if let Some(user) = k.cmd_ref().user.get(name) {
        return Ok(Found2::User(user.clone()));
    }
    if let Some(entry) = table::ENTRIES
        .iter()
        .find(|e| e.name == name || e.aliases.contains(&name))
    {
        return Ok(Found2::Builtin(entry));
    }
    if let Some(aliases) = k.global_option("command_alias").as_array() {
        for alias in aliases.iter().filter_map(Value::as_str) {
            if let Some((from, to)) = alias.split_once('=')
                && from.trim() == name
            {
                let list = pumi_lang::cmd::parse_str(to, &mut pumi_lang::cmd::NoEnv)?;
                return Ok(Found2::Alias(list));
            }
        }
    }
    let prefixed: Vec<&'static Entry> = table::ENTRIES
        .iter()
        .filter(|e| e.name.starts_with(name) || e.aliases.iter().any(|a| a.starts_with(name)))
        .collect();
    match prefixed.as_slice() {
        [one] => Ok(Found2::Builtin(one)),
        [] => {
            let user: Vec<&UserCommand> = k
                .cmd_ref()
                .user
                .values()
                .filter(|u| u.name.starts_with(name))
                .collect();
            match user.as_slice() {
                [one] => Ok(Found2::User((*one).clone())),
                _ => Err(Error::not_found(format!("unknown command: {name}"))),
            }
        }
        many => Err(Error::ambiguous(
            format!(
                "ambiguous command: {name}, could be: {}",
                many.iter().map(|e| e.name).collect::<Vec<_>>().join(", ")
            ),
            many.iter().map(|e| e.name.to_string()).collect(),
        )),
    }
}

fn exec(cx: &mut Cx, queue: &mut Queue, command: &Command) -> Result<Flow> {
    let found = find(kernel(cx), &command.name)?;
    let entry = match found {
        Found2::Builtin(entry) => entry,
        Found2::User(user) => return builtin::user::run(cx, queue, &user, &command.args),
        Found2::Alias(mut list) => {
            if let Some(last) = list.last_mut() {
                last.args.extend(command.args.iter().cloned());
            }
            return Ok(Flow::Insert(list));
        }
    };
    let mut longs: Vec<(&str, pumi_lang::cmd::Long)> = entry.longs.to_vec();
    longs.extend(
        pumi_lang::cmd::COMMON_LONGS
            .iter()
            .filter(|(n, _)| !entry.longs.iter().any(|(m, _)| m == n)),
    );
    let parsed = if entry.raw {
        Parsed {
            args: command.args.clone(),
            ..Parsed::default()
        }
    } else {
        parse_args(entry.template, entry.min, entry.max, &longs, &command.args).map_err(|err| {
            Error::invalid_params(format!(
                "{}: {}; usage: {} {}",
                entry.name, err.message, entry.name, entry.usage
            ))
        })?
    };
    if parsed.has_long("help") {
        queue.print(format!("usage: {} {}", entry.name, entry.usage));
        if !entry.desc.is_empty() {
            queue.print(entry.desc);
        }
        return Ok(Flow::Next);
    }
    let flow = (entry.exec)(cx, queue, &parsed).map_err(|mut err| {
        if !err.message.starts_with(entry.name) {
            err.message = format!("{}: {}", entry.name, err.message);
        }
        err
    })?;
    // Who hears it is the host's (its autocmds), so it always goes.
    let k = kernel(cx);
    let about = About {
        pane: queue.caller.pane,
        ..About::default()
    };
    k.emit(
        "CommandPost",
        entry.name,
        about,
        json!({ "command": print(command) }),
    );
    Ok(flow)
}

// ---- helpers for commands

/// Resolves `-t` (or another flag) as a target of `kind` for this queue.
pub fn target(cx: &mut Cx, flag: Option<&str>, kind: Kind) -> Result<Found> {
    let caller = cx.caller().clone();
    let k = kernel(cx);
    crate::kernel::format::resolve(k, &caller, flag, kind)
}

pub fn target_pane(cx: &mut Cx, flag: Option<&str>) -> Result<PaneId> {
    let found = target(cx, flag, Kind::Pane)?;
    found.pane.ok_or_else(|| Error::not_found("no pane"))
}

pub fn target_tab(cx: &mut Cx, flag: Option<&str>) -> Result<TabId> {
    let found = target(cx, flag, Kind::Tab)?;
    found.tab.ok_or_else(|| Error::not_found("no tab"))
}

pub fn target_session(cx: &mut Cx, flag: Option<&str>) -> Result<SessionId> {
    Ok(target(cx, flag, Kind::Session)?.session)
}

/// A format expanded about a pane, tab or session, with the queue's variables.
pub fn expand(
    k: &Kernel,
    queue: &Queue,
    session: Option<SessionId>,
    tab: Option<TabId>,
    pane: Option<PaneId>,
    text: &str,
) -> String {
    let mut fmt = Fmt::new(k, session, tab, pane);
    fmt.extra = Some(&queue.vars);
    fmt.client =
        Some(queue.caller.channel).filter(|c| k.chans.get(c).is_some_and(|c| c.ui.is_some()));
    pumi_lang::format::expand(&fmt, text)
}

pub fn expand_time(
    k: &Kernel,
    queue: &Queue,
    session: Option<SessionId>,
    tab: Option<TabId>,
    pane: Option<PaneId>,
    text: &str,
) -> String {
    let mut fmt = Fmt::new(k, session, tab, pane);
    fmt.extra = Some(&queue.vars);
    pumi_lang::format::expand_time(&fmt, text)
}

/// tmux's `format_true`: not empty and not `0`.
pub fn truthy(text: &str) -> bool {
    !text.is_empty() && text != "0"
}

/// Parsing at run time: `$VAR` from the environments, `%if` formats about the queue's context.
pub struct ParseEnv<'a> {
    pub kernel: &'a mut Kernel,
    pub queue: &'a Queue,
}

impl Env for ParseEnv<'_> {
    fn var(&self, name: &str) -> Option<String> {
        match self.kernel.cmd_ref().env.global.get(name) {
            Some(var) => var.value.clone(),
            None => self
                .kernel
                .config
                .base_env
                .get(name)
                .cloned()
                .or_else(|| std::env::var(name).ok()),
        }
    }

    fn set_var(&mut self, name: &str, value: &str, hidden: bool) {
        self.kernel.cmd().env.global.insert(
            name.into(),
            Var {
                value: Some(value.into()),
                hidden,
            },
        );
    }

    fn condition(&mut self, format: &str) -> bool {
        let pane = self.kernel.current(&self.queue.caller).map(|c| c.pane);
        truthy(&expand(self.kernel, self.queue, None, None, pane, format))
    }
}

pub fn parse_text(cx: &mut Cx, queue: &Queue, text: &str) -> Result<Vec<Command>> {
    let k = kernel(cx);
    let mut env = ParseEnv { kernel: k, queue };
    pumi_lang::cmd::parse_str(text, &mut env)
}

/// An argument as commands: a block as it is, a word parsed.
pub fn arg_commands(cx: &mut Cx, queue: &Queue, arg: &Arg) -> Result<Vec<Command>> {
    match arg {
        Arg::Commands(list) => Ok(list.clone()),
        Arg::String(text) => parse_text(cx, queue, text),
    }
}

/// A path as the CLI meant it: `~` and relative to its directory.
pub fn path(queue: &Queue, path: &str) -> PathBuf {
    let expanded = match path.strip_prefix("~/") {
        Some(rest) => crate::server::home_dir().join(rest),
        None if path == "~" => crate::server::home_dir(),
        None => PathBuf::from(path),
    };
    if expanded.is_absolute() {
        return expanded;
    }
    match &queue.cwd {
        Some(cwd) => cwd.join(expanded),
        None => expanded,
    }
}

// ---- waiting

/// Parks the queue until `seconds` pass, then resumes it with `outcome`.
pub fn wait_for_time(k: &mut Kernel, queue: &Queue, after: Duration, outcome: Outcome) {
    k.cmd()
        .timers
        .push((Instant::now() + after, Timer::Resume(queue.id, outcome)));
}

/// Resumes a queue after a delay (one forked off with `-b`, which has no queue of its own here).
pub fn resume_after(k: &mut Kernel, queue: u64, after: Duration, outcome: Outcome) {
    k.cmd()
        .timers
        .push((Instant::now() + after, Timer::Resume(queue, outcome)));
}

/// Fails the queue after `after` unless it was resumed first (`wait-pane --for`).
pub fn deadline(k: &mut Kernel, queue: &Queue, after: Duration, message: String) {
    k.cmd()
        .timers
        .push((Instant::now() + after, Timer::Fail(queue.id, message)));
}

/// Parks the queue until an event: `check` says, for each event, whether it is the one and what
/// to resume with.
pub fn wait_for_event(
    k: &mut Kernel,
    queue: &Queue,
    events: Vec<String>,
    check: impl Fn(&mut Cx, &Event) -> Option<Outcome> + 'static,
) -> u64 {
    let id = k.events.next_id();
    let queue_id = queue.id;
    let callback: crate::kernel::events::Callback =
        Rc::new(move |cx: &mut Cx, event: &mut Event| {
            if !waiting(kernel(cx), queue_id) {
                return Ok(Value::Bool(true));
            }
            match check(cx, event) {
                Some(outcome) => {
                    resume(cx, queue_id, outcome);
                    Ok(Value::Bool(true))
                }
                None => Ok(Value::Null),
            }
        });
    k.events.autocmds.push(Autocmd {
        id,
        events,
        group: None,
        patterns: Vec::new(),
        desc: format!("queue {queue_id} waits"),
        once: false,
        action: Action::Callback(callback),
    });
    id
}

/// `wait-for NAME`: parks until `wait-for -S NAME`; `false` when it was signalled already.
pub fn channel_wait(k: &mut Kernel, queue: &Queue, name: &str) -> bool {
    let channel = k.cmd().channels.entry(name.into()).or_default();
    if channel.woken {
        channel.woken = false;
        return false;
    }
    channel.waiters.push(queue.id);
    true
}

/// `wait-for -S NAME`: wakes every waiter, or marks it woken for the next.
pub fn channel_signal(cx: &mut Cx, name: &str) {
    let k = kernel(cx);
    let channel = k.cmd().channels.entry(name.into()).or_default();
    let waiters = std::mem::take(&mut channel.waiters);
    if waiters.is_empty() {
        channel.woken = true;
    }
    for id in waiters {
        resume(cx, id, Outcome::default());
    }
}

/// `wait-for -L NAME`: `true` when the queue must wait for the lock.
pub fn channel_lock(k: &mut Kernel, queue: &Queue, name: &str) -> bool {
    let channel = k.cmd().channels.entry(name.into()).or_default();
    if !channel.locked {
        channel.locked = true;
        return false;
    }
    channel.lockers.push_back(queue.id);
    true
}

pub fn channel_unlock(cx: &mut Cx, name: &str) -> Result<()> {
    let k = kernel(cx);
    let channel = k
        .cmd()
        .channels
        .get_mut(name)
        .filter(|c| c.locked)
        .ok_or_else(|| Error::invalid_params(format!("channel {name} not locked")))?;
    match channel.lockers.pop_front() {
        Some(next) => resume(cx, next, Outcome::default()),
        None => channel.locked = false,
    }
    Ok(())
}

pub fn channel_waiters(k: &Kernel, name: &str) -> Vec<u64> {
    k.cmd_ref()
        .channels
        .get(name)
        .map(|c| c.waiters.clone())
        .unwrap_or_default()
}

/// Runs a shell command in the app (`system::Command`); the queue resumes when it exits.
pub fn spawn_job(
    k: &mut Kernel,
    queue: &Queue,
    command: &str,
    cwd: Option<PathBuf>,
    kind: JobKind,
) -> Result<()> {
    spawn_job_for(k, queue.id, &queue.caller, command, cwd, kind)
}

/// A queue of its own, waiting, with this one's context: what a background command (`-b`)
/// goes on in.
pub fn fork(k: &mut Kernel, queue: &Queue) -> u64 {
    k.cmd().next_queue += 1;
    let id = k.cmd().next_queue;
    k.cmd().queues.insert(
        id,
        Queue {
            id,
            caller: queue.caller.clone(),
            cwd: queue.cwd.clone(),
            vars: queue.vars.clone(),
            items: VecDeque::new(),
            output: String::new(),
            status: None,
            reply: None,
            interactive: false,
        },
    );
    id
}

pub fn spawn_job_for(
    k: &mut Kernel,
    queue_id: u64,
    caller: &Caller,
    command: &str,
    cwd: Option<PathBuf>,
    kind: JobKind,
) -> Result<()> {
    k.cmd().next_job += 1;
    let job = k.cmd().next_job;
    k.cmd().jobs.insert(job, (queue_id, kind));
    let mut env: BTreeMap<String, String> = BTreeMap::new();
    let mut unset = Vec::new();
    let session = k.current(caller).map(|c| c.session);
    for (name, value) in k.cmd().env.for_session(session) {
        match value {
            Some(value) => {
                env.insert(name, value);
            }
            None => unset.push(name),
        }
    }
    if !k.config.socket.as_os_str().is_empty() {
        env.insert("PUMI".into(), k.config.socket.display().to_string());
    }
    if let Some(pane) = k.current(caller).map(|c| c.pane) {
        env.insert("PUMI_PANE".into(), format!("%{pane}"));
    }
    if let Some(bin) = &k.config.bin_dir {
        let path = env
            .get("PATH")
            .or_else(|| k.config.base_env.get("PATH"))
            .cloned()
            .unwrap_or_default();
        env.insert("PATH".into(), format!("{}:{path}", bin.display()));
    }
    let shell = k
        .global_option("default_shell")
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let shell = shell.unwrap_or_else(|| "/bin/sh".into());
    // The program runs in the app, natively: its directory is not one this guest can look at.
    let cwd = cwd
        .unwrap_or_else(crate::server::home_dir)
        .display()
        .to_string();
    k.cmd().pending_jobs.push(Job {
        id: job,
        queue: queue_id,
        shell,
        command: command.to_string(),
        cwd,
        env,
        unset,
    });
    Ok(())
}

/// A job ended: its queue goes on.
pub fn job_done(cx: &mut Cx, job: u64, status: Option<i32>, output: String) {
    let Some((queue, kind)) = kernel(cx).cmd().jobs.remove(&job) else {
        return;
    };
    let outcome = match kind {
        JobKind::Run { command, show } => {
            let failed = status != Some(0);
            Outcome {
                output: if show { output } else { String::new() },
                status,
                error: failed.then(|| match status {
                    Some(code) => Error::exception(format!("'{command}' returned {code}")),
                    None => Error::exception(format!("'{command}' was killed")),
                }),
                ..Outcome::default()
            }
        }
        JobKind::If { then, otherwise } => {
            let chosen = if status == Some(0) {
                Some(then)
            } else {
                otherwise
            };
            let insert = match chosen {
                Some(arg) => {
                    let parked = kernel(cx)
                        .cmd()
                        .queues
                        .get(&queue)
                        .map(|q| (q.caller.clone(), q.vars.clone()));
                    let Some((caller, vars)) = parked else { return };
                    let shadow = Queue {
                        id: 0,
                        caller,
                        cwd: None,
                        vars,
                        items: VecDeque::new(),
                        output: String::new(),
                        status: None,
                        reply: None,
                        interactive: false,
                    };
                    match arg_commands(cx, &shadow, &arg) {
                        Ok(list) => list,
                        Err(err) => {
                            resume(
                                cx,
                                queue,
                                Outcome {
                                    error: Some(err),
                                    ..Outcome::default()
                                },
                            );
                            return;
                        }
                    }
                }
                None => Vec::new(),
            };
            Outcome {
                insert,
                ..Outcome::default()
            }
        }
    };
    resume(cx, queue, outcome);
}

/// Due timers fire, and the monitors are looked at once a second.
pub fn tick(cx: &mut Cx) {
    let now = Instant::now();
    let due: Vec<Timer> = {
        let k = kernel(cx);
        let (due, later): (Vec<_>, Vec<_>) = std::mem::take(&mut k.cmd().timers)
            .into_iter()
            .partition(|(at, _)| *at <= now);
        k.cmd().timers = later;
        due.into_iter().map(|(_, t)| t).collect()
    };
    for timer in due {
        match timer {
            Timer::Resume(id, outcome) => resume(cx, id, outcome),
            Timer::Fail(id, message) => {
                if waiting(kernel(cx), id) {
                    resume(
                        cx,
                        id,
                        Outcome {
                            error: Some(Error::new(ErrorKind::Exception, message)),
                            ..Outcome::default()
                        },
                    );
                }
            }
        }
    }
    let k = kernel(cx);
    if !k.cmd().monitors.is_empty() && k.cmd().next_monitor.is_none_or(|at| at <= now) {
        k.cmd().next_monitor = Some(now + Duration::from_secs(1));
        builtin::hook::check_monitors(cx);
    }
}

/// A channel went away: its waiting queues are dropped, its recording forgotten.
pub fn chan_closed(k: &mut Kernel, chan: ChanId) {
    k.cmd()
        .queues
        .retain(|_, q| q.reply.as_ref().is_none_or(|(c, _)| *c != chan));
    k.cmd().recording.remove(&chan);
}
