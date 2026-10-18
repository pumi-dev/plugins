//! Events (docs/v2/04-events-keys.md §1–2): everything that happens is one [`Event`] with a
//! sequence number. Autocmds act on them (Neovim's API), attached clients receive all of them in
//! order as the attach stream, and a channel can ask for any of them.

use std::collections::BTreeMap;
use std::rc::Rc;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};

use super::Kernel;

/// What an event is about.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema,
)]
pub struct About {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<u64>,
}

impl About {
    pub fn session(id: u64) -> About {
        About {
            session: Some(id),
            ..About::default()
        }
    }

    pub fn tab(id: u64) -> About {
        About {
            tab: Some(id),
            ..About::default()
        }
    }

    pub fn pane(id: u64) -> About {
        About {
            pane: Some(id),
            ..About::default()
        }
    }
}

/// One event. `match` is what autocmd patterns are matched against: an option's name, a pane's
/// type, a command (Neovim's `<amatch>`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Event {
    pub seq: u64,
    pub event: String,
    #[serde(rename = "match")]
    pub matched: String,
    #[serde(flatten)]
    pub about: About,
    pub data: Value,
}

/// A Rust autocmd callback (a mod's, a pane type's). It may change `event.data`: that is how a
/// `Pre` event's handlers rewrite what is about to happen (`PaneSavePre` adds to the state).
/// Returning `{"cancel": true}` from a `Pre` event's handler stops the action; returning `true`
/// deletes the autocmd, as in Neovim.
pub type Callback = Rc<dyn Fn(&mut Cx<'_>, &mut Event) -> Result<Value>>;

#[derive(Clone)]
pub enum Action {
    /// A command line, tmux's `set-hook` (run through `pumi_cmd`).
    Command(String),
    /// Sent to a channel as a `pumi_event` notification: how a script outside the server, or
    /// `pumi events`, listens.
    Chan(u64),
    Callback(Callback),
}

#[derive(Clone)]
pub struct Autocmd {
    pub id: u64,
    pub events: Vec<String>,
    pub group: Option<u64>,
    pub patterns: Vec<String>,
    pub desc: String,
    pub once: bool,
    pub action: Action,
}

impl Autocmd {
    fn matches(&self, event: &Event) -> bool {
        self.events
            .iter()
            .any(|e| e == &event.event || (e == "*" && !event.event.ends_with("Pre")))
            && (self.patterns.is_empty()
                || self
                    .patterns
                    .iter()
                    .any(|p| pumi_lang::format::fnmatch(p, &event.matched, false)))
    }

    pub fn info(&self, groups: &BTreeMap<u64, String>) -> Value {
        let (command, chan, callback) = match &self.action {
            Action::Command(command) => (Some(command.clone()), None, false),
            Action::Chan(chan) => (None, Some(*chan), false),
            Action::Callback(_) => (None, None, true),
        };
        json!({
            "id": self.id,
            "event": self.events,
            "group": self.group,
            "group_name": self.group.and_then(|g| groups.get(&g)),
            "pattern": self.patterns,
            "desc": self.desc,
            "once": self.once,
            "command": command,
            "chan": chan,
            "callback": callback,
        })
    }
}

/// Every event the server fires (04 §2). An autocmd for any other name is an error, as in Neovim;
/// `User` takes any pattern.
pub const EVENTS: &[&str] = &[
    "PumiEnter",
    "StyleSet",
    "PackChangedPre",
    "PackChanged",
    "PumiLeavePre",
    "PumiLeave",
    "UIEnter",
    "UILeave",
    "SessionNew",
    "SessionClosePre",
    "SessionClosed",
    "SessionEnter",
    "SessionLeave",
    "SessionRenamed",
    "TabNew",
    "TabClosePre",
    "TabClosed",
    "TabEnter",
    "TabLeave",
    "TabRenamed",
    "TabMoved",
    "PaneOpenPre",
    "PaneNew",
    "PaneClosePre",
    "PaneClosed",
    "PaneEnter",
    "PaneLeave",
    "PaneResized",
    "PaneMoved",
    "LayoutChanged",
    "PaneSavePre",
    "PaneRestorePost",
    "SessionWritePost",
    "SessionLoadPost",
    "TermOpen",
    "TermClose",
    "TermBell",
    "TermNotify",
    "DirChanged",
    "OptionSet",
    "CommandPost",
    "FocusGained",
    "FocusLost",
    "ColorScheme",
    "Gesture",
    "MenuChanged",
    "MenuPopup",
    "User",
];

#[derive(Default)]
pub struct Events {
    seq: u64,
    pub autocmds: Vec<Autocmd>,
    pub groups: BTreeMap<u64, String>,
    next_id: u64,
    pending: Vec<Event>,
    /// Events fired while nothing was dispatching them; how many were dropped past the limit.
    overflow: u64,
}

/// What a channel's subscription to every event is described as (`pumi_create_autocmd("*",
/// {chan})`): listings of autocmds leave these out.
pub const SUBSCRIPTION: &str = "a channel mirrors the model";

/// The first id of an autocmd or group a channel holds (the core's are below).
pub const LOCAL: u64 = 1_000_000;

/// Events waiting to be dispatched before the oldest are dropped (a runaway loop).
const PENDING_LIMIT: usize = 100_000;

impl Events {
    pub fn seq(&self) -> u64 {
        self.seq
    }

    pub fn next_id(&mut self) -> u64 {
        self.next_id = self.next_id.max(crate::kernel::events::LOCAL) + 1;
        self.next_id
    }

    /// Records an event; it is dispatched by [`flush`].
    pub fn push(&mut self, event: &str, matched: &str, about: About, data: Value) -> u64 {
        self.seq += 1;
        if self.pending.len() >= PENDING_LIMIT {
            self.pending.remove(0);
            self.overflow += 1;
        }
        self.pending.push(Event {
            seq: self.seq,
            event: event.into(),
            matched: matched.into(),
            about,
            data,
        });
        self.seq
    }

    /// An event the core sent: dispatched with the core's number.
    pub fn arrived(&mut self, event: Event) {
        self.seq = self.seq.max(event.seq);
        self.pending.push(event);
    }

    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    pub fn group_id(&self, name: &str) -> Option<u64> {
        self.groups
            .iter()
            .find(|(_, n)| n.as_str() == name)
            .map(|(id, _)| *id)
    }

    pub fn wants(&self, event: &str) -> bool {
        self.autocmds.iter().any(|a| {
            a.events
                .iter()
                .any(|e| e == event || (e == "*" && !event.ends_with("Pre")))
        })
    }
}

/// An event as format variables for the commands it runs: tmux's `hook`, `hook_pane`,
/// `hook_session`, `hook_window`, and each of its data's values as `hook_<key>`.
pub fn hook_vars(event: &Event) -> BTreeMap<String, String> {
    let mut vars = BTreeMap::new();
    vars.insert("hook".into(), event.event.clone());
    vars.insert("hook_match".into(), event.matched.clone());
    if let Some(pane) = event.about.pane {
        vars.insert("hook_pane".into(), format!("%{pane}"));
    }
    if let Some(tab) = event.about.tab {
        vars.insert("hook_window".into(), format!("@{tab}"));
    }
    if let Some(session) = event.about.session {
        vars.insert("hook_session".into(), format!("${session}"));
    }
    if let Some(data) = event.data.as_object() {
        for (key, value) in data {
            let text = match value {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                Value::Bool(b) => if *b { "1" } else { "0" }.into(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };
            vars.insert(format!("hook_{key}"), text);
        }
    }
    vars
}

pub fn check_event(name: &str) -> Result<()> {
    // `*` is every event but the `Pre` ones, which ask before acting: how `pumi events` listens.
    // The core's and other channels' events are theirs to name.
    let word = name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && name.chars().all(|c| c.is_ascii_alphanumeric());
    if name == "*" || EVENTS.contains(&name) || word {
        Ok(())
    } else {
        Err(Error::invalid_params(format!("no event `{name}`")))
    }
}

/// Sends every pending event to the attached clients and runs the autocmds that match it, in
/// order. Autocmds that fire more events have them dispatched in the same flush.
pub fn flush(cx: &mut Cx) -> Result<()> {
    let mut rounds = 0;
    loop {
        let batch = {
            let kernel = cx.host::<Kernel>()?;
            if kernel.events.pending.is_empty() {
                return Ok(());
            }
            std::mem::take(&mut kernel.events.pending)
        };
        rounds += 1;
        for mut event in batch {
            run(cx, &mut event)?;
        }
        if rounds > 1000 {
            let kernel = cx.host::<Kernel>()?;
            kernel.events.pending.clear();
            crate::kernel::log("events: autocmds keep firing events; dropped the rest");
            return Ok(());
        }
    }
}

/// Fires a cancellable (`Pre`) event now and returns its `data` as the handlers left it, or
/// `cancelled` when one of them said so.
pub fn fire_pre(
    cx: &mut Cx,
    event: &str,
    matched: &str,
    about: About,
    data: Value,
) -> Result<Value> {
    let mut ev = {
        let kernel = cx.host::<Kernel>()?;
        if !kernel.events.wants(event) {
            return Ok(data);
        }
        kernel.events.seq += 1;
        Event {
            seq: kernel.events.seq,
            event: event.into(),
            matched: matched.into(),
            about,
            data,
        }
    };
    if run(cx, &mut ev)? {
        return Err(Error::new(
            pumi_api::ErrorKind::Cancelled,
            format!("{event} was cancelled by an autocmd"),
        ));
    }
    Ok(ev.data)
}

/// Runs the autocmds for one event; whether one of them cancelled it.
fn run(cx: &mut Cx, event: &mut Event) -> Result<bool> {
    let matching: Vec<Autocmd> = {
        let kernel = cx.host::<Kernel>()?;
        kernel
            .events
            .autocmds
            .iter()
            .filter(|a| a.matches(event))
            .cloned()
            .collect()
    };
    let mut cancelled = false;
    for autocmd in matching {
        let mut delete = autocmd.once;
        match &autocmd.action {
            Action::Chan(chan) => {
                let kernel = cx.host::<Kernel>()?;
                let message = pumi_api::rpc::notification("pumi_event", json!([autocmd.id, event]));
                if !kernel.send(*chan, message) {
                    delete = true;
                }
            }
            Action::Command(command) => {
                let pane = {
                    let kernel = cx.host::<Kernel>()?;
                    event.about.pane.filter(|p| kernel.panes.contains_key(p))
                };
                let opts = json!({ "pane": pane, "vars": hook_vars(event) });
                if let Err(err) = cx.call("pumi_cmd", json!([command, opts])) {
                    let kernel = cx.host::<Kernel>()?;
                    kernel.message("error", format!("{} hook: {}", event.event, err.message));
                }
            }
            Action::Callback(callback) => match callback(cx, event) {
                Ok(Value::Bool(true)) => delete = true,
                Ok(verdict) => {
                    cancelled |= verdict
                        .get("cancel")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                }
                Err(err) => crate::kernel::log(&format!(
                    "autocmd {} ({}): {}",
                    autocmd.id, event.event, err.message
                )),
            },
        }
        if delete {
            let kernel = cx.host::<Kernel>()?;
            kernel.events.autocmds.retain(|a| a.id != autocmd.id);
        }
    }
    Ok(cancelled)
}
