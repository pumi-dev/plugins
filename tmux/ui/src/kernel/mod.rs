//! The model as the core says it is: a copy of pumi-mirror (17 §4) whose connection to the core
//! is the app's API (`api::call`) instead of a socket, so it builds for wasm32-wasip2. A mirror
//! of the core's sessions, tabs, panes, options and channels, which tmux's code reads as if it
//! were its own, with what it keeps beside it by type ([`Kernel::ext`]). Every change to the
//! model is a call to the core; the mirror follows the core's events (an autocmd on `*`) and is
//! read again when a change tmux made could have moved it.
//!
//! - [`layout`]: a tab's tree of rows and columns, its geometry, and tmux's presets.
//! - [`options`]: the store, mirrored, and the options the host declares.
//! - [`events`]: tmux's own autocmds (a queue waiting on an event), run on the core's events.
//! - [`format`]: tmux's formats and targets over the mirror.
//! - [`core`]: the core, reached through the app.

pub mod core;
pub mod events;
pub mod format;
pub use pumi_layout as layout;
pub mod options;
pub mod state;

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use pumi_api::{Caller, Error, Result};

use events::{About, Events};
pub use layout::PaneId;
use layout::{Layout, Rect};
use options::{Decl, Key, Options};

pub type SessionId = u64;
pub type TabId = u64;
pub type ClientId = u64;
pub type ChanId = u64;

/// The channel of calls the host makes itself (startup, events, timers).
pub const SERVER: ChanId = 0;

/// The channel Lua's calls are made on, in the host (none in the plugin; kept so the mirror's
/// code reads as pumi-mirror's).
pub const LUA: ChanId = u64::MAX;

/// What `#{pid}` says: a wasm plugin has no process of its own.
pub const PID: u32 = 0;

/// What `#{version}` says: the package's version, as the app gives it.
pub fn version() -> String {
    pumi_plugin::api::plugin()["version"].as_str().unwrap_or(env!("CARGO_PKG_VERSION")).to_string()
}

static NAME: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();

/// Names the process in [`log`] lines (`pumi-host`, `pumi-tmux`).
pub fn set_name(name: &'static str) {
    let _ = NAME.set(name);
}

/// One line in the log (stderr, which the core points at its own log).
pub fn log(message: &str) {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    eprintln!("[{now}] {}: {message}", NAME.get().copied().unwrap_or("pumi"));
}

/// A message for the user (`display-message`, an error in a hook): `show-messages` lists them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Message {
    pub at: u64,
    pub level: String,
    pub text: String,
}

/// How many messages are kept.
pub const MESSAGE_LIMIT: usize = 1000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: SessionId,
    pub name: String,
    pub cwd: Option<String>,
    /// `(index, tab)`, by index. A tab linked into several sessions has an index in each.
    pub tabs: Vec<(u32, TabId)>,
    pub current: Option<TabId>,
    pub last: Option<TabId>,
    #[serde(default)]
    pub activity: u64,
    #[serde(default)]
    pub created: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Tab {
    pub id: TabId,
    pub name: Option<String>,
    pub layout: Layout,
    pub active: PaneId,
    pub last: Option<PaneId>,
    pub zoomed: bool,
}

/// A floating pane's geometry (Neovim's `nvim_open_win` config).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Float {
    pub relative: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<PaneId>,
    pub row: i64,
    pub col: i64,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<String>,
    pub focusable: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dismiss: Vec<String>,
    pub zindex: i64,
}

/// Where a pane is (01 §3).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Place {
    Tiled {
        tab: TabId,
    },
    Float {
        tab: TabId,
        #[serde(flatten)]
        float: Float,
    },
    Slot {
        name: String,
        order: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client: Option<ClientId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        owner: Option<PaneId>,
    },
    Detached {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        owner: Option<PaneId>,
    },
}

impl Place {
    pub fn tab(&self) -> Option<TabId> {
        match self {
            Place::Tiled { tab } | Place::Float { tab, .. } => Some(*tab),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pane {
    pub id: PaneId,
    #[serde(rename = "type")]
    pub ty: String,
    pub place: Place,
    #[serde(default)]
    pub activity: u64,
}

/// A client: a channel attached to the core as a UI.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Ui {
    pub session: SessionId,
    pub width: u32,
    pub height: u32,
}

/// What a channel said about itself (`pumi_set_client_info`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ClientInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: Value,
    #[serde(default, rename = "type")]
    pub ty: String,
    #[serde(default)]
    pub methods: Value,
    #[serde(default)]
    pub attributes: Value,
}

/// A channel of the core's.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Chan {
    pub id: ChanId,
    pub info: ClientInfo,
    pub pane: Option<PaneId>,
    pub ui: Option<Ui>,
}

/// Where a call is: the session, tab and pane that `0` means.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Current {
    pub session: SessionId,
    pub tab: TabId,
    pub pane: PaneId,
}

/// What the host knows about itself.
#[derive(Clone, Debug, Default)]
pub struct Config {
    /// The host's name, as other servers know it.
    pub name: String,
    /// The core's socket: `$PUMI`.
    pub socket: PathBuf,
    /// The core's data directory.
    pub data: PathBuf,
    /// The environment jobs (`run-shell`) start from: the login shell's.
    pub base_env: BTreeMap<String, String>,
    /// Where the `pumi` CLI is; prepended to jobs' `PATH`.
    pub bin_dir: Option<PathBuf>,
}

pub struct Kernel {
    pub config: Config,
    pub sessions: BTreeMap<SessionId, Session>,
    pub tabs: BTreeMap<TabId, Tab>,
    pub panes: BTreeMap<PaneId, Pane>,
    pub chans: BTreeMap<ChanId, Chan>,
    pub options: Options,
    pub events: Events,
    /// Messages for channels (and for Lua, [`LUA`]), sent after each turn.
    pub out: Vec<(ChanId, String)>,
    /// `pumi_kill_server` reached the host: it stops after this turn.
    pub stop: bool,
    /// What `0` means to a call with no pane and no client: the core's last session.
    last: Option<Current>,
    /// The connection to the core; `None` in tests that run the host's code alone.
    pub core: Option<Arc<core::Core>>,
    /// The core's functions that only read: calling one does not move the mirror.
    pub reads: HashSet<String>,
    /// The mirror may be behind the core: it is read again before it is next used.
    pub stale: bool,
    /// Values the server and the host's modules keep beside the model, by type.
    pub ext: anymap::Ext,
    /// Messages for the user, oldest first.
    pub messages: std::collections::VecDeque<Message>,
    /// When the process started (`start_time`).
    pub started: u64,
    /// The channel whose request is being answered.
    pub rpc: Option<ChanId>,
    /// A command queue (pumi-tmux) or a Lua task (pumi-host) that answers that request when it
    /// ends, not now.
    pub defer: Option<u64>,
    pub defer_lua: Option<u64>,
    /// Answers a call that reaches the channel while it waits for one of its own. Unused in the
    /// plugin: the SDK answers nested calls itself (`api::call`), through `server`.
    pub serve: Option<Serve>,
}

/// How a channel answers a call the core passed on: it writes the reply itself.
pub type Serve = std::rc::Rc<dyn Fn(&mut Kernel, String)>;

/// Values kept beside the model, by type.
pub mod anymap {
    use std::any::{Any, TypeId};
    use std::collections::HashMap;

    #[derive(Default)]
    pub struct Ext(HashMap<TypeId, Box<dyn Any>>);

    impl Ext {
        pub fn insert<T: Any>(&mut self, value: T) {
            self.0.insert(TypeId::of::<T>(), Box::new(value));
        }

        pub fn get<T: Any>(&self) -> Option<&T> {
            self.0.get(&TypeId::of::<T>())?.downcast_ref()
        }

        pub fn get_mut<T: Any>(&mut self) -> Option<&mut T> {
            self.0.get_mut(&TypeId::of::<T>())?.downcast_mut()
        }

        /// The value of type `T`, made with its default the first time.
        pub fn get_or_default<T: Any + Default>(&mut self) -> &mut T {
            let value = self.0.entry(TypeId::of::<T>()).or_insert_with(|| Box::new(T::default()));
            value.downcast_mut().expect("an Ext entry has its key's type")
        }
    }
}

fn u(v: &Value) -> Option<u64> {
    v.as_u64()
}

impl Kernel {
    pub fn new(config: Config) -> Kernel {
        Kernel {
            config,
            sessions: BTreeMap::new(),
            tabs: BTreeMap::new(),
            panes: BTreeMap::new(),
            chans: BTreeMap::new(),
            options: Options::new(),
            events: Events::default(),
            out: Vec::new(),
            stop: false,
            last: None,
            core: None,
            reads: HashSet::new(),
            stale: false,
            ext: anymap::Ext::default(),
            messages: Default::default(),
            started: state::epoch(),
            rpc: None,
            defer: None,
            defer_lua: None,
            serve: None,
        }
    }

    pub fn message(&mut self, level: &str, text: impl Into<String>) {
        self.messages.push_back(Message { at: state::epoch(), level: level.into(), text: text.into() });
        while self.messages.len() > MESSAGE_LIMIT {
            self.messages.pop_front();
        }
    }

    // ---- the core

    pub fn core(&self) -> Result<Arc<core::Core>> {
        self.core.clone().ok_or_else(|| Error::new(pumi_api::ErrorKind::ProviderUnavailable, "no core"))
    }

    /// Who the host acts for in a call it passes to the core.
    pub fn on_behalf(&self, caller: &Caller) -> Option<Value> {
        let pane = caller.pane.or_else(|| self.current(caller).map(|c| c.pane));
        let chan = (caller.channel != SERVER && caller.channel != crate::kernel::LUA).then_some(caller.channel);
        if chan.is_none() && pane.is_none() && caller.source.is_none() {
            return None;
        }
        Some(json!({ "chan": chan, "pane": pane, "name": caller.source.clone() }))
    }

    /// Calls a function the core has (or routes), as `caller`; a change brings the mirror up
    /// to date before this returns.
    pub fn call_core(&mut self, caller: &Caller, name: &str, args: Value) -> Result<Value> {
        let core = self.core()?;
        let behalf = self.on_behalf(caller);
        let result = match self.serve.clone() {
            Some(serve) => core.call_serving(name, args.clone(), behalf, &mut |line| serve(self, line)),
            None => core.call(name, args.clone(), behalf),
        };
        if result.is_ok() && !self.reads.contains(name) {
            if name == "pumi_core_set_option_value" {
                // Read back what it took (checked, clamped) without reading everything.
                self.mirror_option_set(caller, &args);
            } else {
                self.stale = true;
                self.sync();
            }
        }
        result
    }

    fn mirror_option_set(&mut self, caller: &Caller, args: &Value) {
        let (name, opts) = match args {
            Value::Array(a) => (a.first().and_then(Value::as_str).map(str::to_string), a.get(2).cloned()),
            Value::Object(o) => (o.get("name").and_then(Value::as_str).map(str::to_string), o.get("opts").cloned()),
            _ => (None, None),
        };
        let Some(name) = name else { return };
        let Some(core) = self.core.clone() else { return };
        let opts = opts.unwrap_or(json!({}));
        let Ok(value) = core.call("pumi_get_option_value", json!([name, opts]), self.on_behalf(caller)) else {
            self.stale = true;
            return;
        };
        let key = self.key_of(caller, &name, &opts);
        match key {
            Some(key) if !value.is_null() || name.starts_with('@') => {
                let local = !value.is_null();
                if local {
                    let _ = self.options.set(&name, key, value, &self.source(caller), true);
                } else {
                    self.options.unset(&name, key);
                }
            }
            _ => self.stale = true,
        }
    }

    /// The object option `opts` name, as the core resolves it.
    fn key_of(&self, caller: &Caller, name: &str, opts: &Value) -> Option<Key> {
        let id = |k: &str| opts.get(k).and_then(Value::as_u64);
        let scope = opts.get("scope").and_then(Value::as_str);
        let declared = self.options.decl(name).map(|d| d.scope);
        let current = self.current(caller);
        use options::Scope;
        let scope = match scope {
            Some("global") => Scope::Global,
            Some("session") => Scope::Session,
            Some("tab") => Scope::Tab,
            Some("pane") => Scope::Pane,
            Some("client") => Scope::Client,
            _ if id("pane").is_some() => Scope::Pane,
            _ if id("tab").is_some() => Scope::Tab,
            _ if id("session").is_some() => Scope::Session,
            _ if id("client").is_some() => Scope::Client,
            _ => declared.unwrap_or(Scope::Global),
        };
        let pick = |given: Option<u64>, now: Option<u64>| given.filter(|i| *i != 0).or(now);
        Some(match scope {
            Scope::Global => Key::Global,
            Scope::Session => Key::Session(pick(id("session"), current.map(|c| c.session))?),
            Scope::Tab => Key::Tab(pick(id("tab"), current.map(|c| c.tab))?),
            Scope::Pane => Key::Pane(pick(id("pane"), current.map(|c| c.pane))?),
            Scope::Client => Key::Client(pick(id("client"), Some(caller.channel))?),
        })
    }

    /// Reads the core's model again if it may have moved.
    pub fn sync(&mut self) {
        if !self.stale {
            return;
        }
        let Some(core) = self.core.clone() else { return };
        let (Ok(state), Ok(decls), Ok(chans)) = (
            core.call("pumi_get_state", json!([]), None),
            core.call("pumi_get_all_options_info", json!([]), None),
            core.call("pumi_list_chans", json!([]), None),
        ) else {
            return;
        };
        let decls: BTreeMap<String, Decl> = serde_json::from_value(decls).unwrap_or_default();
        self.load(&state["state"], decls.into_values().collect(), &chans);
        self.stale = false;
    }

    /// The mirror from the core's dump (`pumi_get_state`), declarations and channels.
    pub fn load(&mut self, state: &Value, decls: Vec<Decl>, chans: &Value) {
        let empty = Vec::new();
        let list = |key: &str| state.get(key).and_then(Value::as_array).unwrap_or(&empty);
        self.sessions = list("sessions")
            .iter()
            .filter_map(|s| serde_json::from_value::<Session>(s.clone()).ok())
            .map(|s| (s.id, s))
            .collect();
        self.tabs = list("tabs")
            .iter()
            .filter_map(|t| {
                Some(Tab {
                    id: u(&t["id"])?,
                    name: t["name"].as_str().map(str::to_string),
                    layout: Layout::from_value(&t["layout"]).ok()?,
                    active: u(&t["active"])?,
                    last: u(&t["last"]),
                    zoomed: t["zoomed"].as_bool().unwrap_or(false),
                })
            })
            .map(|t| (t.id, t))
            .collect();
        let mut options = Options::from_decls(decls);
        self.panes = BTreeMap::new();
        for p in list("panes") {
            let Ok(pane) = serde_json::from_value::<Pane>(p.clone()) else { continue };
            for (name, value) in p["options"].as_object().into_iter().flatten() {
                let _ = options.set(name, Key::Pane(pane.id), value.clone(), "core", true);
            }
            self.panes.insert(pane.id, pane);
        }
        for (object, values) in state["options"].as_object().into_iter().flatten() {
            let key = match object.split_once(':') {
                None if object == "global" => Key::Global,
                Some(("session", id)) => Key::Session(id.parse().unwrap_or(0)),
                Some(("tab", id)) => Key::Tab(id.parse().unwrap_or(0)),
                Some(("client", id)) => Key::Client(id.parse().unwrap_or(0)),
                _ => continue,
            };
            for (name, value) in values.as_object().into_iter().flatten() {
                let _ = options.set(name, key, value.clone(), "core", true);
            }
        }
        self.options = options;
        self.last = state
            .get("current")
            .and_then(|c| Some(Current { session: u(&c["session"])?, tab: u(&c["tab"])?, pane: u(&c["pane"])? }));
        let lua = self.chans.remove(&crate::kernel::LUA);
        self.chans = chans
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|c| {
                let id = u(&c["id"])?;
                let info = serde_json::from_value(c["client"].clone()).unwrap_or_default();
                let ui = c["ui"].as_object().map(|ui| Ui {
                    session: ui.get("session").and_then(u).unwrap_or(0),
                    width: ui.get("width").and_then(u).unwrap_or(80) as u32,
                    height: ui.get("height").and_then(u).unwrap_or(24) as u32,
                });
                Some((id, Chan { id, info, pane: u(&c["pane"]), ui }))
            })
            .collect();
        if let Some(lua) = lua {
            self.chans.insert(crate::kernel::LUA, lua);
        }
    }

    /// An event from the core: what it changed is mirrored (an option exactly, anything else by
    /// reading again before the mirror is used).
    pub fn mirror_event(&mut self, event: &events::Event) {
        match event.event.as_str() {
            "OptionSet" => {
                let d = &event.data;
                let id = d["id"].as_u64();
                let key = match (d["scope"].as_str(), id) {
                    (Some("global"), _) => Some(Key::Global),
                    (Some("session"), Some(id)) => Some(Key::Session(id)),
                    (Some("tab"), Some(id)) => Some(Key::Tab(id)),
                    (Some("pane"), Some(id)) => Some(Key::Pane(id)),
                    (Some("client"), Some(id)) => Some(Key::Client(id)),
                    _ => None,
                };
                let name = d["name"].as_str().unwrap_or_default();
                match key {
                    Some(key) if d["local"] == json!(true) => {
                        let source = d["source"].as_str().unwrap_or("core").to_string();
                        if self.options.set(name, key, d["new"].clone(), &source, true).is_err() {
                            self.stale = true;
                        }
                    }
                    Some(key) => {
                        self.options.unset(name, key);
                    }
                    None => self.stale = true,
                }
            }
            "OptionDeclared" => match serde_json::from_value::<Decl>(event.data["decl"].clone()) {
                Ok(decl) => self.options.mirror_decl(decl),
                Err(_) => self.stale = true,
            },
            "TermOsc" | "TermNotify" | "User" | "DirChanged" | "CommandPost" | "Gesture" => {}
            _ => self.stale = true,
        }
    }

    // ---- who is calling, and what `0` means

    /// Who set something, for provenance: the channel's client name, or `chan N`.
    pub fn source(&self, caller: &Caller) -> String {
        if let Some(source) = &caller.source {
            return source.clone();
        }
        if caller.channel == SERVER {
            return "host".into();
        }
        match self.chans.get(&caller.channel) {
            Some(chan) if !chan.info.name.is_empty() => chan.info.name.clone(),
            _ => format!("chan {}", caller.channel),
        }
    }

    fn caller_pane(&self, caller: &Caller) -> Option<PaneId> {
        caller.pane.or_else(|| self.chans.get(&caller.channel)?.pane).filter(|p| self.panes.contains_key(p))
    }

    fn caller_session(&self, caller: &Caller) -> Option<SessionId> {
        let ui = self.chans.get(&caller.channel)?.ui.as_ref()?;
        self.sessions.contains_key(&ui.session).then_some(ui.session)
    }

    /// The caller's session, tab and pane: its pane, else its client's session, else the
    /// core's last.
    pub fn current(&self, caller: &Caller) -> Option<Current> {
        if let Some(pane) = self.caller_pane(caller)
            && let Some(tab) = self.panes[&pane].place.tab()
        {
            let session = self
                .caller_session(caller)
                .filter(|s| self.sessions[s].tabs.iter().any(|(_, t)| *t == tab))
                .or_else(|| self.session_of_tab(tab))?;
            return Some(Current { session, tab, pane });
        }
        let session = self
            .caller_session(caller)
            .or(self.last.map(|c| c.session).filter(|s| self.sessions.contains_key(s)))
            .or_else(|| self.sessions.values().max_by_key(|s| s.activity).map(|s| s.id))?;
        let tab = self.sessions[&session].current.or_else(|| self.sessions[&session].tabs.first().map(|(_, t)| *t))?;
        Some(Current { session, tab, pane: self.tabs.get(&tab)?.active })
    }

    pub fn session_id(&self, caller: &Caller, id: SessionId) -> Result<SessionId> {
        if id == 0 {
            return self
                .current(caller)
                .map(|c| c.session)
                .ok_or_else(|| Error::not_found("there is no current session"));
        }
        self.sessions.contains_key(&id).then_some(id).ok_or_else(|| Error::not_found(format!("no session ${id}")))
    }

    pub fn tab_id(&self, caller: &Caller, id: TabId) -> Result<TabId> {
        if id == 0 {
            return self.current(caller).map(|c| c.tab).ok_or_else(|| Error::not_found("there is no current tab"));
        }
        self.tabs.contains_key(&id).then_some(id).ok_or_else(|| Error::not_found(format!("no tab @{id}")))
    }

    pub fn pane_id(&self, caller: &Caller, id: PaneId) -> Result<PaneId> {
        if id == 0 {
            return self.current(caller).map(|c| c.pane).ok_or_else(|| Error::not_found("there is no current pane"));
        }
        self.panes.contains_key(&id).then_some(id).ok_or_else(|| Error::not_found(format!("no pane %{id}")))
    }

    /// The session a tab is in; of several, the one used last.
    pub fn session_of_tab(&self, tab: TabId) -> Option<SessionId> {
        self.sessions
            .values()
            .filter(|s| s.tabs.iter().any(|(_, t)| *t == tab))
            .max_by_key(|s| s.activity)
            .map(|s| s.id)
    }

    pub fn tab_of_pane(&self, pane: PaneId) -> Option<TabId> {
        self.panes.get(&pane)?.place.tab()
    }

    /// The options a pane reads, narrowest first.
    pub fn chain(&self, pane: Option<PaneId>, tab: Option<TabId>, session: Option<SessionId>) -> Vec<Key> {
        let tab = tab.or_else(|| pane.and_then(|p| self.tab_of_pane(p)));
        let session = session.or_else(|| tab.and_then(|t| self.session_of_tab(t)));
        let mut chain = Vec::with_capacity(4);
        chain.extend(pane.map(Key::Pane));
        chain.extend(tab.map(Key::Tab));
        chain.extend(session.map(Key::Session));
        chain.push(Key::Global);
        chain
    }

    pub fn pane_option(&self, pane: PaneId, name: &str) -> Value {
        self.options.get(name, &self.chain(Some(pane), None, None)).map(|(v, _)| v).unwrap_or(Value::Null)
    }

    pub fn global_option(&self, name: &str) -> Value {
        self.options.get(name, &[Key::Global]).map(|(v, _)| v).unwrap_or(Value::Null)
    }

    /// The cells a tab is laid out in: the size of the client that used a session holding it
    /// last, else `default_size` (tmux's `window-size latest`, 18 §3).
    pub fn tab_area(&self, tab: TabId) -> Rect {
        let client = self
            .chans
            .values()
            .filter_map(|c| c.ui.as_ref())
            .filter(|ui| self.sessions.get(&ui.session).is_some_and(|s| s.tabs.iter().any(|(_, t)| *t == tab)))
            .max_by_key(|ui| self.sessions[&ui.session].activity);
        let parse = |text: &str| {
            let (w, h) = text.split_once('x')?;
            Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
        };
        let (width, height) = match client {
            Some(ui) => (ui.width, ui.height),
            None => self.global_option("default_size").as_str().and_then(parse).unwrap_or((80, 24)),
        };
        Rect { x: 0, y: 0, width: width.max(1), height: height.max(1) }
    }

    // ---- changes, which are the core's

    /// Fires an event of the host's: the core passes it to every channel subscribed, the host
    /// included, which runs its autocmds when it comes back.
    pub fn emit(&mut self, event: &str, matched: &str, about: About, data: Value) {
        if let Some(core) = &self.core {
            let opts = json!({ "pattern": matched, "data": data, "pane": about.pane });
            core.notify("pumi_exec_autocmds", json!([event, opts]));
        } else {
            self.events.push(event, matched, about, data);
        }
    }

    /// Sets an option through the core (the host as the caller).
    pub fn set_option(&mut self, name: &str, key: Key, value: Value, source: &str, _internal: bool) -> Result<bool> {
        let opts = key_opts(key);
        let caller = Caller { channel: SERVER, source: Some(source.to_string()), ..Caller::default() };
        if self.core.is_none() {
            return Ok(self.options.set(name, key, value, source, true)?.is_some());
        }
        let value = self.options.coerce(name, value)?;
        self.call_core(&caller, "pumi_core_set_option_value", json!([name, value, opts])).map(|_| true)
    }

    pub fn unset_option(&mut self, name: &str, key: Key, source: &str) {
        let _ = self.set_option(name, key, Value::Null, source, false);
    }

    /// Where each pane of a tab is in its area (`tab_area`): its layout's cells, the active pane
    /// alone when zoomed, and the floats over it.
    pub fn tab_rects(&self, tab: TabId) -> Vec<(PaneId, Rect)> {
        let Some(t) = self.tabs.get(&tab) else { return Vec::new() };
        let area = self.tab_area(tab);
        let mut rects = if t.zoomed { vec![(t.active, area)] } else { t.layout.rects(area) };
        rects.extend(self.panes.values().filter_map(|p| match &p.place {
            Place::Float { tab: ft, float } if *ft == tab => Some((
                p.id,
                Rect {
                    x: float.col.clamp(0, area.width as i64) as u32,
                    y: float.row.clamp(0, area.height as i64) as u32,
                    width: float.width.max(1),
                    height: float.height.max(1),
                },
            )),
            _ => None,
        }));
        rects
    }

    /// Where a pane is in its tab, in cells (tmux's `pane_left`, `pane_top`, …).
    pub fn pane_rect(&self, pane: PaneId) -> Option<Rect> {
        let tab = self.panes.get(&pane)?.place.tab()?;
        self.tab_rects(tab).into_iter().find(|(p, _)| *p == pane).map(|(_, r)| r)
    }

    /// Sends a message to a channel (through the core), or to Lua.
    pub fn send(&mut self, chan: ChanId, message: String) -> bool {
        if chan == SERVER {
            return false;
        }
        if chan != crate::kernel::LUA && !self.chans.contains_key(&chan) && self.core.is_some() {
            // An answer to a call the core passed on goes back whatever the channel.
            if !message.contains("\"method\"") {
                self.out.push((chan, message));
                return true;
            }
            return false;
        }
        self.out.push((chan, message));
        true
    }

    pub fn session_value(&self, id: SessionId) -> Value {
        let s = &self.sessions[&id];
        json!({ "id": s.id, "name": s.name, "cwd": s.cwd, "tabs": s.tabs, "current": s.current, "last": s.last })
    }

    pub fn tab_value(&self, id: TabId) -> Value {
        let t = &self.tabs[&id];
        json!({ "id": t.id, "name": t.name, "layout": t.layout.to_value(), "active": t.active, "last": t.last, "zoomed": t.zoomed })
    }

    pub fn pane_value(&self, id: PaneId) -> Value {
        let p = &self.panes[&id];
        json!({ "id": p.id, "type": p.ty, "place": p.place, "options": self.local_options(Key::Pane(id)) })
    }

    pub fn local_options(&self, key: Key) -> Map<String, Value> {
        self.options.local(key).into_iter().map(|(name, set)| (name, set.value)).collect()
    }
}

/// The `opts` of an option call that names one object.
pub fn key_opts(key: Key) -> Value {
    match key {
        Key::Global => json!({ "scope": "global" }),
        Key::Session(id) => json!({ "scope": "session", "session": id }),
        Key::Tab(id) => json!({ "scope": "tab", "tab": id }),
        Key::Pane(id) => json!({ "scope": "pane", "pane": id }),
        Key::Client(id) => json!({ "scope": "client", "client": id }),
    }
}

impl std::fmt::Debug for Kernel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Kernel").field("sessions", &self.sessions).field("panes", &self.panes).finish()
    }
}
