//! herdr on pumi (docs/v2/23-client-plugins.md §3, step 6): herdr's API and socket, as a wasm
//! package. It serves `herdr.sock` so herdr's clients (its CLI, its mobile apps) reach pumi's
//! panes: sessions are workspaces, tabs are tabs, panes are panes.
//!
//! No screen is kept here and nothing detects agents. A pane's text is `pumi_pane_call`'s
//! `read`; its keys are `{"keys": […]}` on the same call, which the host encodes; and what an
//! agent is doing is the pane's `@agent`/`@agent_status`, which the host keeps from the
//! program's own reports (OSC 7501, 23 §6).
//!
//! It also binds herdr's default keys in the prefix table (`keys`), as herdr has them.

mod api;
mod keys;
mod proto;
mod socket;
mod state;
mod view;

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

/// `herdr.sock` beside the server's own files (`stdpath("data")/herdr.sock`), where the core's
/// pumi-herdr served it — deliberately not herdr's own `~/.config/herdr/herdr.sock`, so a real
/// herdr can run beside it.
///
/// `$PUMI_DATA_DIR` decides it when it is set. Otherwise the directory is the platform's
/// application data directory for the app's name: macOS (where it differs from the XDG root,
/// and `cfg!(target_os)` cannot say — this is wasm) is told by `~/Library/Application Support`.
fn socket_path() -> PathBuf {
    if let Some(dir) = std::env::var_os("PUMI_DATA_DIR").filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir).join("herdr.sock");
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"));
    let library = home.join("Library/Application Support");
    let data = if library.is_dir() {
        library
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share"))
    };
    data.join(appname()).join("herdr.sock")
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

fn init(_plugin: &mut Plugin, _cx: &mut App) {
    keys::declare_option();
    keys::install();
    let path = socket_path();
    match socket::serve(&path.to_string_lossy()) {
        Ok(_) => log(&format!("serving {}", path.display())),
        // Another herdr may hold it; herdr's clients then talk to that one.
        Err(err) => log(&format!("{}: {err}", path.display())),
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

pumi_plugin::plugin!(init);
