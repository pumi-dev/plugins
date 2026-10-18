//! Options are the state (docs/v2/01-model.md §5): one store for tmux's options and user
//! options, Neovim's options and variables, plugin settings and the read-only facts formats
//! show. Each value remembers who set it (Neovim's `:verbose set`).
//!
//! Names: tmux writes `remain-on-exit`, Neovim and Lua `remain_on_exit`; both reach the same
//! option, which is stored with underscores. User options (`@x`) are taken as written, as tmux
//! takes them.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use pumi_api::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Global,
    Session,
    Tab,
    Pane,
    Client,
}

/// One object's options: the server's, a session's, a tab's, a pane's or a client's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Key {
    Global,
    Session(u64),
    Tab(u64),
    Pane(u64),
    Client(u64),
}

impl Key {
    pub fn scope(self) -> Scope {
        match self {
            Key::Global => Scope::Global,
            Key::Session(_) => Scope::Session,
            Key::Tab(_) => Scope::Tab,
            Key::Pane(_) => Scope::Pane,
            Key::Client(_) => Scope::Client,
        }
    }

    pub fn id(self) -> Option<u64> {
        match self {
            Key::Global => None,
            Key::Session(id) | Key::Tab(id) | Key::Pane(id) | Key::Client(id) => Some(id),
        }
    }
}

/// Neovim's option types, and `table` for structured values (`servers`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Type {
    Boolean,
    Number,
    String,
    Table,
    Any,
}

/// A declared option: what `pumi_get_option_info2` describes and Settings shows.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Decl {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: Type,
    pub default: Value,
    /// The narrowest object it is set on. A pane option may also be set on a tab, a session or
    /// globally, and a pane without its own value takes the nearest one (tmux's inheritance).
    pub scope: Scope,
    pub desc: String,
    /// The values it accepts, when only some are allowed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<Value>>,
    /// Set by the server, or by the type that owns it, never by a caller: `pane_current_path`,
    /// `pane_pid`, `pane_width`.
    #[serde(default)]
    pub readonly: bool,
    /// The pane types it belongs to; empty for every pane.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub types: Vec<String>,
    /// Who declared it: `core`, a pane type, a package.
    pub source: String,
    /// The package that declared it, whose Settings page lists it (07 §4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    /// Its title in Settings (`Font size`); without one, Settings makes one of its name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// What Settings calls each of `choices`, in their order (`Status bar` for `status_bar`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    /// A number's unit in Settings (`pt`, `%`, `s`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    /// What an empty text field shows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// Its heading in Settings (`Terminal`, `Panes`); without one, its package or `General`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// A number's range and step: a value past them is clamped, one between steps snapped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    /// How Settings edits it when its type does not say: `toggle` (a number as on and off),
    /// `slider`, `json`, or a control of the app's own (`theme`, `terminal_theme`, `font`,
    /// `marks`, `keymap`, `agents`, `remotes`, `dock_page`); a boolean is a switch, an option
    /// with choices a menu, a number a stepper, a string a text field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control: Option<String>,
    /// Declared by a package that is installed but not loaded: known from the cache of what it
    /// declared when it last loaded (07 §4). Its values are kept for when it loads.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pending: bool,
    /// When it was declared, counting from 1: Settings lists a group in this order.
    #[serde(default)]
    pub order: u64,
}

impl Decl {
    pub fn new(name: &str, ty: Type, default: Value, scope: Scope, desc: &str) -> Decl {
        Decl {
            name: name.into(),
            ty,
            default,
            scope,
            desc: desc.into(),
            choices: None,
            readonly: false,
            types: Vec::new(),
            source: "core".into(),
            package: None,
            label: None,
            labels: None,
            unit: None,
            placeholder: None,
            group: None,
            min: None,
            max: None,
            step: None,
            control: None,
            pending: false,
            order: 0,
        }
    }

    pub fn group(mut self, group: &str) -> Decl {
        self.group = Some(group.into());
        self
    }

    /// A core plugin's, listed on its Settings page as a package's are (`context`).
    pub fn package(mut self, package: &str) -> Decl {
        self.package = Some(package.into());
        self
    }

    pub fn label(mut self, label: &str) -> Decl {
        self.label = Some(label.into());
        self
    }

    /// Its choices, each with what Settings calls it.
    pub fn labelled(mut self, choices: &[(&str, &str)]) -> Decl {
        self.choices = Some(choices.iter().map(|(c, _)| json!(c)).collect());
        self.labels = Some(choices.iter().map(|(_, l)| l.to_string()).collect());
        self
    }

    pub fn placeholder(mut self, text: &str) -> Decl {
        self.placeholder = Some(text.into());
        self
    }

    pub fn range(mut self, min: f64, max: f64, step: Option<f64>) -> Decl {
        (self.min, self.max, self.step) = (Some(min), Some(max), step);
        self
    }

    pub fn control(mut self, control: &str) -> Decl {
        self.control = Some(control.into());
        self
    }

    pub fn readonly(mut self) -> Decl {
        self.readonly = true;
        self
    }

    pub fn choices(mut self, choices: &[&str]) -> Decl {
        self.choices = Some(choices.iter().map(|c| json!(c)).collect());
        self
    }

    pub fn of_type(mut self, ty: &str, source: &str) -> Decl {
        self.types = vec![ty.into()];
        self.source = source.into();
        self
    }
}

/// A value and who set it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Set {
    pub value: Value,
    pub source: String,
}

/// What a `set` changed, for `OptionSet`.
#[derive(Clone, Debug, PartialEq)]
pub struct Change {
    pub name: String,
    pub key: Key,
    pub old: Value,
    pub new: Value,
}

#[derive(Default)]
pub struct Options {
    decls: BTreeMap<String, Decl>,
    /// The last declaration's `order`.
    declared: u64,
    values: HashMap<Key, BTreeMap<String, Set>>,
}

/// The stored spelling of a name.
pub fn normalise(name: &str) -> String {
    if name.starts_with('@') { name.to_string() } else { name.replace('-', "_") }
}

fn is_user(name: &str) -> bool {
    name.starts_with('@')
}

impl Options {
    pub fn new() -> Options {
        let mut options = Options::default();
        for mut decl in builtin() {
            options.declared += 1;
            decl.order = options.declared;
            options.decls.insert(decl.name.clone(), decl);
        }
        options
    }

    /// A store that knows exactly these declarations (the core's, mirrored).
    pub fn from_decls(decls: Vec<Decl>) -> Options {
        let mut options = Options::default();
        for decl in decls {
            options.declared = options.declared.max(decl.order);
            options.decls.insert(decl.name.clone(), decl);
        }
        options
    }

    /// A declaration the core made known.
    pub fn mirror_decl(&mut self, decl: Decl) {
        self.declared = self.declared.max(decl.order);
        self.decls.insert(decl.name.clone(), decl);
    }

    /// The declarations the host makes in the core at start.
    pub fn builtin() -> Vec<Decl> {
        builtin()
    }

    /// Changes a declared option's default: one only known at start (`runtimepath`).
    pub fn set_default(&mut self, name: &str, value: Value) {
        if let Some(decl) = self.decls.get_mut(&normalise(name)) {
            decl.default = value;
        }
    }

    pub fn decl(&self, name: &str) -> Option<&Decl> {
        self.decls.get(&normalise(name))
    }

    pub fn decls(&self) -> impl Iterator<Item = &Decl> {
        self.decls.values()
    }

    /// Declares an option. Declaring one that exists is allowed only as the same option: a second
    /// pane type may share `title`, but not change its type.
    pub fn declare(&mut self, mut decl: Decl) -> Result<()> {
        decl.name = normalise(&decl.name);
        if is_user(&decl.name) || !valid_name(&decl.name) {
            return Err(Error::invalid_params(format!("`{}` is not an option name", decl.name)));
        }
        check_type(&decl, &decl.default)
            .map_err(|err| Error::invalid_params(format!("the default: {}", err.message)))?;
        self.declared += 1;
        decl.order = self.declared;
        match self.decls.get_mut(&decl.name) {
            None => {
                self.decls.insert(decl.name.clone(), decl);
                Ok(())
            }
            // A declaration known from the cache (07 §4) gives way to the package's own.
            Some(existing) if existing.pending => {
                *existing = decl;
                Ok(())
            }
            Some(existing) if existing.ty == decl.ty && existing.scope == decl.scope => {
                for ty in decl.types {
                    if !existing.types.contains(&ty) {
                        existing.types.push(ty);
                    }
                }
                Ok(())
            }
            Some(existing) => Err(Error::invalid_params(format!(
                "`{}` is already declared by {} as a {:?} {:?} option",
                decl.name, existing.source, existing.scope, existing.ty
            ))),
        }
    }

    /// The value at the first of `chain` (narrowest first) that has one, else the default.
    /// The [`Set`] says who set it; `None` for a default.
    pub fn get(&self, name: &str, chain: &[Key]) -> Option<(Value, Option<&Set>)> {
        let name = normalise(name);
        let decl = self.decls.get(&name);
        if decl.is_none() && !is_user(&name) {
            return None;
        }
        for key in chain {
            if let Some(decl) = decl
                && !reaches(decl.scope, key.scope())
            {
                continue;
            }
            if let Some(set) = self.values.get(key).and_then(|v| v.get(&name)) {
                return Some((set.value.clone(), Some(set)));
            }
        }
        Some((decl.map_or(Value::Null, |decl| decl.default.clone()), None))
    }

    /// The value set on exactly this object, if any.
    pub fn get_local(&self, name: &str, key: Key) -> Option<&Set> {
        self.values.get(&key)?.get(&normalise(name))
    }

    /// Sets a value; a caller cannot set a read-only one, the server (`internal`) can.
    /// Returns what changed, or `None` when the value was already this.
    pub fn set(&mut self, name: &str, key: Key, value: Value, source: &str, internal: bool) -> Result<Option<Change>> {
        let name = normalise(name);
        let value = match self.decls.get(&name) {
            Some(decl) => {
                if decl.readonly && !internal {
                    return Err(Error::invalid_params(format!("`{name}` is read-only")));
                }
                if !reaches(decl.scope, key.scope()) {
                    return Err(Error::invalid_params(format!(
                        "`{name}` is a {:?} option and cannot be set on a {:?}",
                        decl.scope,
                        key.scope()
                    )));
                }
                coerce(decl, value)?
            }
            None if is_user(&name) => value,
            None => return Err(Error::not_found(format!("no option `{name}`"))),
        };
        let old = self.get(&name, &[key]).map(|(v, _)| v).unwrap_or(Value::Null);
        let values = self.values.entry(key).or_default();
        let unchanged = values.get(&name).is_some_and(|set| set.value == value);
        values.insert(name.clone(), Set { value: value.clone(), source: source.into() });
        Ok((!unchanged).then_some(Change { name, key, old, new: value }))
    }

    /// A value in the option's type, as the host's `pumi_set_option_value` hands it to the core
    /// (18 §3): tmux's `on`, numbers as text, clamped and stepped. One nobody declared is left
    /// as it is, for the core to check.
    pub fn coerce(&self, name: &str, value: Value) -> Result<Value> {
        match self.decls.get(&normalise(name)) {
            Some(decl) if !value.is_null() => coerce(decl, value),
            _ => Ok(value),
        }
    }

    /// Forgets the value set on this object, so it inherits again (tmux's `set -u`).
    pub fn unset(&mut self, name: &str, key: Key) -> Option<Change> {
        let name = normalise(name);
        let old = self.values.get_mut(&key)?.remove(&name)?;
        let new = self.get(&name, &[key]).map(|(v, _)| v).unwrap_or(Value::Null);
        (old.value != new).then_some(Change { name, key, old: old.value, new })
    }

    /// Everything set on one object.
    pub fn local(&self, key: Key) -> BTreeMap<String, Set> {
        self.values.get(&key).cloned().unwrap_or_default()
    }

    /// The object closed: its values go with it.
    pub fn drop_object(&mut self, key: Key) {
        self.values.remove(&key);
    }

    /// Every object that has values, for persistence.
    pub fn keys(&self) -> Vec<Key> {
        let mut keys: Vec<Key> = self.values.keys().copied().collect();
        keys.sort();
        keys
    }

    pub fn is_readonly(&self, name: &str) -> bool {
        self.decl(name).is_some_and(|d| d.readonly)
    }
}

/// An option declared at `declared` may be set on objects at `at`.
fn reaches(declared: Scope, at: Scope) -> bool {
    match declared {
        Scope::Global => at == Scope::Global,
        Scope::Session => matches!(at, Scope::Global | Scope::Session),
        Scope::Tab => matches!(at, Scope::Global | Scope::Session | Scope::Tab),
        Scope::Pane => matches!(at, Scope::Global | Scope::Session | Scope::Tab | Scope::Pane),
        Scope::Client => matches!(at, Scope::Global | Scope::Client),
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.'))
}

fn check_type(decl: &Decl, value: &Value) -> Result<()> {
    let ok = match decl.ty {
        Type::Boolean => value.is_boolean(),
        Type::Number => value.is_number(),
        Type::String => value.is_string(),
        Type::Table => value.is_object() || value.is_array(),
        Type::Any => true,
    } || value.is_null();
    if !ok {
        return Err(Error::invalid_params(format!("`{}` is a {:?}, not {value}", decl.name, decl.ty).to_lowercase()));
    }
    if let Some(choices) = &decl.choices
        && !value.is_null()
        && !choices.contains(value)
    {
        return Err(Error::invalid_params(format!(
            "`{}` is one of {}, not {value}",
            decl.name,
            choices.iter().map(Value::to_string).collect::<Vec<_>>().join(", ")
        )));
    }
    Ok(())
}

/// A value in the option's type: tmux's `on`/`off` for booleans, numbers given as text.
fn coerce(decl: &Decl, value: Value) -> Result<Value> {
    let value = match (decl.ty, &value) {
        (Type::Boolean, Value::String(s)) => match s.as_str() {
            "on" | "true" | "yes" | "1" => Value::Bool(true),
            "off" | "false" | "no" | "0" => Value::Bool(false),
            _ => value,
        },
        (Type::Number, Value::String(s)) => s.trim().parse::<f64>().ok().and_then(number).unwrap_or(value),
        _ => value,
    };
    check_type(decl, &value)?;
    // Clamped to the range and snapped to the step, so what a reader gets is always in it.
    if let Some(mut n) = value.as_f64().filter(|_| decl.ty == Type::Number) {
        if let Some(step) = decl.step.filter(|s| *s > 0.0) {
            let base = decl.min.unwrap_or(0.0);
            n = base + ((n - base) / step).round() * step;
        }
        if let Some(min) = decl.min {
            n = n.max(min);
        }
        if let Some(max) = decl.max {
            n = n.min(max);
        }
        return Ok(number((n * 1e9).round() / 1e9).unwrap_or(value));
    }
    Ok(value)
}

fn number(n: f64) -> Option<Value> {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        Some(json!(n as i64))
    } else {
        serde_json::Number::from_f64(n).map(Value::Number)
    }
}

/// The server's own options. Names are tmux's where tmux has the option, Neovim's where Neovim
/// does; the read-only ones are tmux's format variables.
fn builtin() -> Vec<Decl> {
    use Scope::*;
    use Type::*;
    let mut decls = vec![
        Decl::new(
            "default_size",
            String,
            json!("80x24"),
            Global,
            "The size of a tab no client shows, as WIDTHxHEIGHT (tmux's).",
        ),
        Decl::new(
            "default_shell",
            String,
            json!(""),
            Global,
            "The program a terminal runs when none is given; empty is $SHELL, as a login shell.",
        ),
        Decl::new("base_index", Number, json!(0), Session, "The index of a session's first tab (tmux's base-index)."),
        Decl::new(
            "history_limit",
            Number,
            json!(2000),
            Pane,
            "Lines of a terminal's scrollback kept in its saved state (tmux's history-limit).",
        ),
        Decl::new(
            "remain_on_exit",
            Boolean,
            json!(false),
            Pane,
            "Keep a terminal pane, dead, when its program exits (tmux's).",
        ),
        Decl::new(
            "automatic_rename",
            Boolean,
            json!(true),
            Tab,
            "A tab without a name shows its active pane's title (tmux's).",
        ),
        Decl::new(
            "exit_empty",
            Boolean,
            json!(true),
            Global,
            "The server exits a while after its last session closed and no one is connected (tmux's).",
        ),
        Decl::new(
            "tmux.enabled",
            Boolean,
            json!(true),
            Global,
            "Use tmux's commands, prefix keys, configuration and scripts in pumi.",
        )
        .label("tmux"),
        Decl::new(
            "herdr.enabled",
            Boolean,
            json!(true),
            Global,
            "herdr compatibility: use herdr's clients on your pumi terminals, and see which agent runs in each.",
        )
        .label("herdr"),
        Decl::new(
            "viewoptions",
            String,
            json!("scrollback,history"),
            Global,
            "What a pane's saved state includes beyond its options and type data: `scrollback` (terminals), `history` (browsers), `cookies` (Neovim's option).",
        ),
        Decl::new(
            "sessionoptions",
            String,
            json!("sessions,tabs,panes,floats,options"),
            Global,
            "What `mksession` writes (Neovim's option).",
        ),
        Decl::new(
            "servers",
            Table,
            json!({}),
            Global,
            "Other servers this one reaches, by name: `{ laptop = \"/path/to/pumi.sock\" }`.",
        ),
        Decl::new(
            "title",
            String,
            json!(""),
            Pane,
            "The pane's title: what its program said (OSC 2), its page's title, or what `select-pane -T` set.",
        ),
        Decl::new(
            "font_size",
            Number,
            Value::Null,
            Pane,
            "The pane's font size in points; empty takes the client's. A browser pane reads it as page zoom.",
        ),
        Decl::new(
            "runtimepath",
            String,
            json!(""),
            Global,
            "Where Lua finds `plugin/`, `lua/` and `health` files, comma-separated (Neovim's): the config directory, packages, pumi's runtime, then the `after` directories.",
        ),
        Decl::new(
            "packindex",
            String,
            json!("https://pumi.app/store/index.json"),
            Global,
            "The store's index (07 §3): a URL or a file of the packages `pack search` finds and `pack add NAME` installs.",
        ),
        Decl::new(
            "exrc",
            Boolean,
            json!(false),
            Global,
            "Run a session's `.pumi.lua` (in its directory or a parent, up to its repository's root) when the session is made (Neovim's).",
        ),
        Decl::new("buffer_limit", Number, json!(50), Global, "The most paste buffers kept; past it the oldest goes."),
        Decl::new(
            "command_alias",
            Table,
            json!(["server-info=show-messages -JT", "info=show-messages -JT"]),
            Global,
            "Command aliases, each `alias=command line`.",
        ),
        Decl::new("prefix", String, json!("C-b"), Session, "The prefix key: it enters the `prefix` key table."),
        Decl::new("prefix2", String, json!("None"), Session, "A second prefix key."),
        Decl::new("status_interval", Number, json!(15), Session, "Seconds between status line redraws."),
        Decl::new(
            "status_left",
            String,
            json!("[#{session_name}] "),
            Session,
            "The left of the default status line, a format.",
        ),
        Decl::new(
            "status_right",
            String,
            json!("\"#{=21:pane_title}\" %H:%M %d-%b-%y"),
            Session,
            "The right of the default status line, a format.",
        ),
        Decl::new(
            "main_pane_width",
            String,
            json!("80"),
            Tab,
            "The main pane's width in the `main-vertical` layout, in cells or a percentage (`60%`).",
        ),
        Decl::new("synchronize_panes", Boolean, json!(false), Pane, "Typing goes to every pane of the tab at once."),
        Decl::new("pane_type", String, json!(""), Pane, "What kind of pane it is: `terminal`, `browser`, …").readonly(),
        Decl::new("pane_width", Number, json!(0), Pane, "Its width in cells, as whoever shows it sized it.").readonly(),
        Decl::new("pane_height", Number, json!(0), Pane, "Its height in cells, as whoever shows it sized it.")
            .readonly(),
        Decl::new(
            "pane_current_path",
            String,
            json!(""),
            Pane,
            "Its directory: a terminal's program's (OSC 7, else the process's).",
        )
        .readonly(),
        Decl::new("pane_pid", Number, Value::Null, Pane, "A terminal's first process.").readonly(),
        Decl::new("pane_current_command", String, json!(""), Pane, "A terminal's foreground program.").readonly(),
        Decl::new("pane_dead", Boolean, json!(false), Pane, "A terminal's program has exited.").readonly(),
        Decl::new("pane_dead_status", Number, Value::Null, Pane, "How it exited.").readonly(),
        Decl::new("client_width", Number, json!(0), Client, "The client's size in cells.").readonly(),
        Decl::new("client_height", Number, json!(0), Client, "The client's size in cells.").readonly(),
        Decl::new(
            "key_table",
            String,
            json!("root"),
            Client,
            "The client's mode: the key table its keys go through (tmux's).",
        ),
        // The chrome (06 §1): what the runtime's `chrome` views draw, as tmux formats.
        Decl::new(
            "statusline",
            String,
            // `T:` expands the two options' values as formats (and strftime), as tmux does.
            json!("#{T:status_left}#[align=right]#{T:status_right}"),
            Session,
            "The status bar, a format (Neovim's `statusline`, in tmux's language).",
        ),
        Decl::new(
            "tabline",
            String,
            json!(
                "#{W:#[range=window|#{window_index}]#{?window_active,#[fg=TabLineSel],#[fg=TabLine]} #{window_index}:#{window_name} #[norange default]}"
            ),
            Session,
            "The tab bar, a format; each tab a `range=window|N` so a click selects it.",
        ),
        Decl::new("winbar", String, json!(""), Pane, "A bar on each pane, a format; empty shows none."),
        Decl::new("titlestring", String, json!("#{session_name}"), Session, "The window's title, a format."),
        Decl::new(
            "background",
            String,
            json!("dark"),
            Global,
            "`dark` or `light`: which way colour schemes go. The app sets it from `appearance`.",
        )
        .choices(&["dark", "light"]),
        Decl::new(
            "animate",
            Number,
            json!(1),
            Global,
            "Panes glide into place and side bars slide open. Off when macOS's Reduce motion is on.",
        )
        .label("Animate layout changes")
        .range(0.0, 1.0, Some(1.0))
        .group("Layout")
        .control("toggle"),
    ];
    // The app's settings (08 §1). Settings draws them from these declarations, like any
    // package's: `label`, `group` and `control` are all it needs.
    decls.extend([
        Decl::new("appearance", String, json!("system"), Global, "Light, dark, or follow the system.")
            .label("Mode")
            .labelled(&[("system", "System"), ("light", "Light"), ("dark", "Dark")])
            .group("Appearance"),
        Decl::new(
            "colors_name",
            String,
            json!(""),
            Global,
            "The app's colours. Some themes also bring their own layout and icons.",
        )
        .label("Theme")
        .group("Appearance")
        .control("theme"),
        Decl::new(
            "terminal_colorscheme",
            String,
            json!(""),
            Global,
            "Give terminals their own colours, or leave empty to match the app's theme.",
        )
        .label("Terminal theme")
        .group("Terminal")
        .control("terminal_theme"),
        Decl::new("guifont", String, json!(""), Global, "The typeface for terminal text.")
            .label("Font")
            .group("Terminal")
            .control("font"),
        Decl::new("linespace", Number, json!(1.25), Global, "Space between terminal lines, relative to the font size.")
            .label("Line height")
            .range(1.0, 2.0, Some(0.05))
            .group("Terminal"),
        Decl::new(
            "macos_option_as_alt",
            Boolean,
            json!(true),
            Global,
            "Use Option for terminal shortcuts like alt+b instead of typing characters like å.",
        )
        .label("Option as Alt")
        .group("Keys"),
        Decl::new("equalalways", Boolean, json!(true), Global, "Keep panes evenly sized when one opens or closes.")
            .label("Equalize on open and close")
            .group("Panes"),
        Decl::new(
            "keymap_preset",
            String,
            json!("default"),
            Global,
            "Start from the shortcuts of an editor you already know, or from none.",
        )
        .label("Base keymap")
        .labelled(&[
            ("default", "pumi"),
            ("vscode", "VS Code"),
            ("jetbrains", "JetBrains"),
            ("sublime_text", "Sublime Text"),
            ("atom", "Atom"),
            ("textmate", "TextMate"),
            ("emacs", "Emacs"),
            ("cursor", "Cursor"),
            ("none", "None"),
        ])
        .group("Keys"),
        Decl::new("keymap_bindings", Table, json!({}), Global, "Your shortcuts that differ from the base keymap.")
            .label("Key bindings")
            .group("Keys")
            .control("keymap"),
        Decl::new(
            "dock.side",
            String,
            json!("left"),
            Global,
            "Which side the main side bar sits on; the secondary one takes the other.",
        )
        .label("Primary side bar")
        .labelled(&[("left", "Left"), ("right", "Right")])
        .group("Sidebar"),
        Decl::new("dock.open", Boolean, json!(true), Global, "Open the side bar when the app starts.")
            .label("Show on launch")
            .group("Sidebar"),
        Decl::new("dock.page", String, json!("agents"), Global, "The panel the side bar shows when the app starts.")
            .label("Default panel")
            .group("Sidebar")
            .control("dock_page"),
        Decl::new("dock.buttons", String, json!("side"), Global, "Where the buttons that switch side bar panels go.")
            .label("Panel buttons")
            .labelled(&[
                ("side", "Side (the rail)"),
                ("top", "Top of the side bar"),
                ("tiles", "Tiles at the top of the side bar"),
                ("bottom", "Bottom of the side bar"),
                ("status_bar", "Status bar"),
                ("hidden", "Hidden"),
            ])
            .group("Layout"),
        Decl::new(
            "agents.marks",
            String,
            json!("icons"),
            Global,
            "Show each agent's state as an icon or as a coloured dot.",
        )
        .label("Agent state marks")
        .labelled(&[("icons", "Icons"), ("dots", "Dots")])
        .group("Layout")
        .control("marks"),
        Decl::new(
            "dock.compact",
            Boolean,
            json!(true),
            Global,
            "Keep panel buttons and agent status in a slim strip while the side bar is closed.",
        )
        .label("Compact side bar")
        .group("Layout"),
        Decl::new(
            "browser.open_links",
            String,
            json!("app"),
            Global,
            "Where cmd+click opens links from terminals. Shift+cmd+click opens the other.",
        )
        .label("Open links in")
        .labelled(&[("app", "Browser pane"), ("system", "System browser")])
        .group("Browser"),
        Decl::new(
            "browser.search_url",
            String,
            json!("https://duckduckgo.com/?q={query}"),
            Global,
            "The search engine the address bar uses; {query} stands for what you typed.",
        )
        .label("Search")
        .placeholder("https://…?q={query}")
        .group("Browser"),
        Decl::new(
            "browser.home_url",
            String,
            json!(""),
            Global,
            "The page a new browser pane opens. Leave empty to start in the address bar.",
        )
        .label("Home page")
        .placeholder("Empty: focus the address")
        .group("Browser"),
        Decl::new("browser.devtools", Boolean, json!(true), Global, "Inspect and debug pages with alt+cmd+i.")
            .label("Web Inspector")
            .group("Browser"),
        // The agent context core plugin's (core/context): its switch, then its page.
        Decl::new(
            "context.enabled",
            Boolean,
            json!(true),
            Global,
            "Tell agents about your workspace. Off silences it for every agent.",
        )
        .label("Agent context")
        .package("context")
        .group("Agent context"),
        Decl::new(
            "context.updates",
            String,
            json!("changes"),
            Global,
            "Keep agents up to date as panes open, close and move, or tell them only when they start.",
        )
        .label("Updates")
        .labelled(&[("changes", "Session start and on changes"), ("start", "Session start only")])
        .package("context")
        .group("Agent context"),
        Decl::new(
            "context.other_sessions",
            Boolean,
            json!(true),
            Global,
            "Include panes from your other sessions, not only the current one.",
        )
        .label("Other sessions")
        .package("context")
        .group("Agent context"),
        Decl::new("context.targets", Table, json!({}), Global, "Choose which agents are told about your workspace.")
            .label("Agents")
            .package("context")
            .group("Agent context")
            .control("agents"),
        Decl::new(
            "remotes",
            Table,
            json!([]),
            Global,
            "Work in your other machines' terminals as sessions here, over SSH: `[{name, ssh}]`.",
        )
        .label("Remote servers")
        .group("Servers")
        .control("remotes"),
    ]);
    // The browser's (16 §3): the pane keeps its address, which every client's webview follows;
    // a client reports where it went (`pumi_pane_call(pane, "report", …)`).
    decls.extend([
        Decl::new("url", String, json!("about:blank"), Pane, "The page's address. Setting it navigates.")
            .of_type("browser", "browser"),
        Decl::new("zoom", Number, json!(1), Pane, "The page's zoom; 1 is 100%.").of_type("browser", "browser"),
        Decl::new("loading", Boolean, json!(false), Pane, "The page is loading, as its client reports.")
            .of_type("browser", "browser"),
    ]);
    // Neovim's terminal palette (06 §4): what a colour scheme sets for ANSI colours 0 to 15.
    decls.extend((0..16).map(|i| {
        Decl::new(
            &format!("terminal_color_{i}"),
            String,
            json!(""),
            Global,
            "An ANSI colour of the terminals, `#rrggbb` (Neovim's); empty keeps the colour scheme's.",
        )
    }));
    decls
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pane_takes_the_nearest_value() {
        let mut options = Options::new();
        let chain = [Key::Pane(3), Key::Tab(2), Key::Session(1), Key::Global];
        assert_eq!(options.get("remain-on-exit", &chain).unwrap().0, json!(false));
        options.set("remain_on_exit", Key::Session(1), json!("on"), "cli", false).unwrap();
        let (value, set) = options.get("remain_on_exit", &chain).unwrap();
        assert_eq!((value, set.unwrap().source.as_str()), (json!(true), "cli"));
        options.set("remain_on_exit", Key::Pane(3), json!(false), "init.lua:3", false).unwrap();
        assert_eq!(options.get("remain_on_exit", &chain).unwrap().0, json!(false));
    }

    #[test]
    fn user_options_need_no_declaration_and_others_do() {
        let mut options = Options::new();
        let change = options.set("@build", Key::Global, json!("ok"), "cli", false).unwrap().unwrap();
        assert_eq!((change.old, change.new), (Value::Null, json!("ok")));
        assert!(options.set("@build", Key::Global, json!("ok"), "cli", false).unwrap().is_none(), "no change");
        assert_eq!(options.get("@build", &[Key::Pane(1), Key::Global]).unwrap().0, json!("ok"));
        assert_eq!(
            options.set("nonsense", Key::Global, json!(1), "cli", false).unwrap_err().kind,
            pumi_api::ErrorKind::NotFound
        );
    }

    #[test]
    fn types_choices_scopes_and_read_only_are_enforced() {
        let mut options = Options::new();
        assert!(options.set("history_limit", Key::Global, json!("lots"), "cli", false).is_err());
        assert_eq!(
            options.set("history_limit", Key::Global, json!("500"), "cli", false).unwrap().unwrap().new,
            json!(500)
        );
        assert!(options.set("pane_pid", Key::Pane(1), json!(4), "cli", false).is_err());
        assert!(options.set("pane_pid", Key::Pane(1), json!(4), "server", true).is_ok());
        assert!(options.set("default_size", Key::Pane(1), json!("10x10"), "cli", false).is_err(), "global only");
        options
            .declare(
                Decl::new("files.sort", Type::String, json!("name"), Scope::Global, "How files sort.")
                    .choices(&["name", "mtime"]),
            )
            .unwrap();
        assert!(options.set("files.sort", Key::Global, json!("size"), "cli", false).is_err());
        assert!(options.declare(Decl::new("files.sort", Type::Number, json!(1), Scope::Global, "")).is_err());
    }
}
