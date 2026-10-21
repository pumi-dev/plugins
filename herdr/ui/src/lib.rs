//! herdr on pumi (docs/v2/23-client-plugins.md §3, step 6): herdr's API and socket, as a wasm
//! package. It serves `herdr.sock` so herdr's clients (its CLI, its mobile apps) reach pumi's
//! panes: sessions are workspaces, tabs are tabs, panes are panes.
//!
//! No screen is kept here and nothing detects agents. A pane's text is `pumi_pane_call`'s
//! `read`; its keys are `{"keys": […]}` on the same call, which the host encodes; and what an
//! agent is doing is the pane's `@agent`/`@agent_status`, which the host keeps from the
//! program's own reports (OSC 7501, 23 §6).
//!
//! Beside it is `herdr-client.sock`, where herdr's own client attaches to a terminal
//! (`herdr agent attach`, which is how herdr's mobile apps show a pane live): each attach is a
//! client of pumi's grid socket for that pane ([`attach`]).
//!
//! Both are served in pumi's data directory and, under the name `herdr.session`, where herdr
//! keeps a named session (`~/.config/herdr/sessions/<name>/`), so herdr's CLI and its apps find
//! pumi as one of herdr's sessions.
//!
//! It also binds herdr's default keys in the prefix table (`keys`), as herdr has them.

mod api;
mod attach;
mod grid;
mod keys;
mod proto;
mod queries;
mod socket;
mod state;
mod view;

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use pumi_plugin::Plugin;
use pumi_plugin::api as sdk;
use pumi_plugin::gpui::App;
use serde_json::json;

/// The events herdr's clients hear about: everything that changes the model, every program
/// ending, and the option that says what an agent is doing (herdr's
/// `pane.agent_status_changed`).
const EVENTS: &[&str] = &[
    "SessionNew",
    "SessionClosed",
    "SessionRenamed",
    "SessionEnter",
    "TabNew",
    "TabClosed",
    "TabEnter",
    "TabRenamed",
    "PaneNew",
    "PaneClosed",
    "PaneEnter",
    "TermClose",
    "LayoutChanged",
    "OptionSet",
];

/// The server's data directory (`stdpath("data")`), where its sockets are: herdr's go beside
/// them, as the core's pumi-herdr served them — deliberately not herdr's own
/// `~/.config/herdr`, so a real herdr can run beside it.
///
/// `$PUMI_DATA_DIR` decides it when it is set. Otherwise the directory is the platform's
/// application data directory for the app's name: macOS (where it differs from the XDG root,
/// and `cfg!(target_os)` cannot say — this is wasm) is told by `~/Library/Application Support`.
fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("PUMI_DATA_DIR").filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
    }
    let library = home().join("Library/Application Support");
    let data = if library.is_dir() {
        library
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join(".local/share"))
    };
    data.join(appname())
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// The option naming the herdr session pumi also answers as.
const SESSION: &str = "herdr.session";

/// herdr's config directory: `$XDG_CONFIG_HOME/herdr`, else `~/.config/herdr`.
///
/// PROVENANCE: herdr `src/config/io.rs` (`config_dir`) @ v0.9.4 (Apache-2.0).
fn herdr_config() -> PathBuf {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".config"));
    config.join("herdr")
}

/// Where herdr keeps the named session `name` (`session::data_dir_for`): the config directory
/// for herdr's own default session (`default`, or `-`), `sessions/<name>` for any other.
/// herdr's names only: ASCII letters, digits, `.`, `_` and `-`.
///
/// PROVENANCE: herdr `src/session.rs` (`data_dir_for`, `DEFAULT_SESSION_NAME`,
/// `validate_name`) @ v0.9.4 (Apache-2.0).
fn session_dir(name: &str) -> Option<PathBuf> {
    if matches!(name, "default" | "-") {
        return Some(herdr_config());
    }
    let valid = !name.is_empty()
        && name.len() <= 64
        && name != "."
        && name != ".."
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if !valid {
        return None;
    }
    Some(herdr_config().join("sessions").join(name))
}

/// The app's name, as the server keeps its directories: `$PUMI_APPNAME`, else the directory
/// above the one the app keeps its plugins under (it gave this plugin `<user data>/<name>/ui`),
/// else `pumi`.
fn appname() -> String {
    if let Some(name) = std::env::var("PUMI_APPNAME")
        .ok()
        .filter(|name| !name.is_empty())
    {
        return name;
    }
    let data = sdk::plugin()["data"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let from_path = Path::new(&data)
        .parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty());
    from_path.unwrap_or_else(|| "pumi".into())
}

fn log(message: &str) {
    eprintln!("pumi-herdr: {message}");
}

thread_local! {
    /// The listeners in herdr's session directory, which move when [`SESSION`] does.
    static SESSION_LISTENERS: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
}

/// Serves `herdr.sock` and `herdr-client.sock` in `dir`; the listeners made.
fn serve_in(dir: &Path, grid: &Path) -> Vec<u64> {
    let mut listeners = Vec::new();
    let api = dir.join("herdr.sock");
    match socket::serve(&api.to_string_lossy()) {
        Ok(id) => {
            listeners.push(id);
            log(&format!("serving {}", api.display()));
        }
        // Another herdr may hold it; herdr's clients then talk to that one.
        Err(err) => log(&format!("{}: {err}", api.display())),
    }
    // herdr's client finds its socket beside the API's (`herdr.sock` → `herdr-client.sock`).
    let client = dir.join("herdr-client.sock");
    match attach::serve(&client.to_string_lossy(), &grid.to_string_lossy()) {
        Ok(id) => {
            listeners.push(id);
            log(&format!("serving {}", client.display()));
        }
        Err(err) => log(&format!("{}: {err}", client.display())),
    }
    listeners
}

fn declare_session_option() {
    let spec = json!({
        "type": "string",
        "default": "pumi",
        "label": "herdr session",
        "group": "herdr",
        "placeholder": "pumi",
        "desc": "The name pumi answers as among herdr's sessions (`~/.config/herdr/sessions/<name>/`), so herdr's CLI and its mobile apps (Heeler: the Host's session name) reach it. `default`: herdr's own default session (`~/.config/herdr`), where a running herdr server keeps it unless it has stopped. Empty: only pumi's data directory.",
    });
    if let Err(err) = sdk::pumi_create_option(SESSION, spec) {
        log(&format!("{SESSION}: {}", err.message));
    }
}

/// (Re)serves the sockets in herdr's session directory for the current [`SESSION`].
fn serve_session(grid: &Path) {
    for id in SESSION_LISTENERS.with(|l| std::mem::take(&mut *l.borrow_mut())) {
        pumi_plugin::system::close(id);
    }
    let name = sdk::option(SESSION, json!({}))
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "pumi".into());
    if name.is_empty() {
        return;
    }
    let Some(dir) = session_dir(&name) else {
        return log(&format!("{SESSION}: {name:?} is not a herdr session name"));
    };
    if let Err(err) = std::fs::create_dir_all(&dir) {
        return log(&format!("{}: {err}", dir.display()));
    }
    let listeners = serve_in(&dir, grid);
    SESSION_LISTENERS.with(|l| *l.borrow_mut() = listeners);
}

fn init(_plugin: &mut Plugin, _cx: &mut App) {
    keys::declare_option();
    keys::install();
    declare_session_option();
    let data = data_dir();
    let grid = data.join("grid.sock");
    serve_in(&data, &grid);
    serve_session(&grid);
    let moved = sdk::autocmd(
        json!("OptionSet"),
        json!({ "pattern": SESSION, "desc": "herdr's session sockets follow herdr.session" }),
        move |_, _| serve_session(&grid),
    );
    if let Err(err) = moved {
        log(&format!("{SESSION}: {err}"));
    }
    let autocmds = sdk::autocmd(
        json!(EVENTS),
        json!({ "desc": "herdr's socket: the model changing" }),
        |event, _| socket::on_event(event),
    );
    if let Err(err) = autocmds {
        log(&format!("herdr's events: {err}"));
    }
}

pumi_plugin::plugin!(init, api = 1);
