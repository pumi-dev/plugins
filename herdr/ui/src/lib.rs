//! herdr on pumi (docs/v2/23-client-plugins.md §3, step 6): herdr's API and socket, as a wasm
//! package. It serves `herdr.sock` so herdr's clients (its CLI, its mobile apps) reach pumi's
//! panes: sessions are workspaces, tabs are tabs, panes are panes.
//!
//! No screen is kept here and nothing detects agents. A pane's text is `pumi_pane_call`'s
//! `read`; its keys are `{"keys": […]}` on the same call, which the host encodes; and what an
//! agent is doing is the pane's `@agent`/`@agent_status`, which the host keeps from the
//! program's own reports (OSC 7501, 23 §6).

mod api;
mod proto;
mod socket;
mod state;
mod view;

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

/// `herdr.sock` beside the data the app gives this plugin: `stdpath("data")/herdr.sock`, where
/// the core's own pumi-herdr served it (deliberately not herdr's own `~/.config/herdr`).
fn socket_path() -> String {
    let data = sdk::plugin()["data"].as_str().unwrap_or_default().to_string();
    std::path::Path::new(&data)
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("herdr.sock")
        .to_string_lossy()
        .into_owned()
}

fn log(message: &str) {
    eprintln!("pumi-herdr: {message}");
}

fn init(_plugin: &mut Plugin, _cx: &mut App) {
    let path = socket_path();
    match socket::serve(&path) {
        Ok(_) => log(&format!("serving {path}")),
        // Another herdr may hold it; herdr's clients then talk to that one.
        Err(err) => log(&format!("{path}: {err}")),
    }
    let autocmds = sdk::autocmd(json!(EVENTS), json!({ "desc": "herdr's socket: the model changing" }), |event, _| {
        socket::on_event(event)
    });
    if let Err(err) = autocmds {
        log(&format!("herdr's events: {err}"));
    }
}

pumi_plugin::plugin!(init);
