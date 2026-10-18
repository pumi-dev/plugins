//! attention: tell the user when an agent is blocked and they are looking elsewhere (05 §5).
//! An agent's state is its pane's `@agent_state` (what agents' hooks set: `pumi set -p
//! @agent_state blocked`). While any is blocked, `@attention` is how many, and a notice says so
//! once each time the count goes up. The Dock bounce and the badge come with the system mod
//! (phase 4); until then they are `@attention` and the notice.
//!
//! No view: what it makes is options, autocmds and the global `@attention`.

use std::cell::Cell;

use pumi_plugin::gpui::App;
use pumi_plugin::prelude::*;

/// How many were blocked at the last look, so the notice is said once each time it goes up.
thread_local! {
    static WAITING: Cell<u32> = const { Cell::new(0) };
}

/// Declare one of its options.
fn option(name: &str, spec: Value) {
    if let Err(err) = api::pumi_create_option(&format!("attention.{name}"), spec) {
        eprintln!("attention: {err}");
    }
}

/// `attention.bounce`: whether the Dock bounces (and whether the notice is said at all).
fn bounce() -> String {
    api::option("attention.bounce", json!({}))
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "once".into())
}

/// How many panes' agents are blocked.
fn blocked() -> u32 {
    let panes = api::pumi_list_panes(json!({})).unwrap_or(Value::Null);
    panes
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
        .filter(|pane| {
            api::option("@agent_state", json!({ "pane": pane }))
                .is_ok_and(|state| state == "blocked")
        })
        .count() as u32
}

/// Count them again: say so if more are waiting than before, and keep `@attention` the count.
fn update() {
    let now = blocked();
    let waiting = WAITING.with(Cell::get);
    if now > waiting && bounce() != "none" {
        let said = if now == 1 {
            "An agent is waiting for you".to_string()
        } else {
            format!("{now} agents are waiting for you")
        };
        let _ = api::pumi_notify(&said, Some("warn"), json!({}));
    }
    WAITING.with(|w| w.set(now));
    let attention = if now > 0 { json!(now) } else { Value::Null };
    if let Err(err) = api::set_option("@attention", attention, json!({})) {
        eprintln!("attention: {err}");
    }
}

fn init(_plugin: &mut Plugin, _cx: &mut App) {
    option(
        "bounce",
        json!({
            "type": "string",
            "default": "once",
            "choices": ["none", "once", "until_focus"],
            "desc": "Bounce the Dock icon when an agent is blocked and the app is in the background.",
        }),
    );
    option(
        "badge",
        json!({
            "type": "boolean",
            "default": false,
            "desc": "Badge the icon with how many agents are blocked.",
        }),
    );
    let desc = "count the agents waiting for you";
    if let Err(err) = api::autocmd(
        "OptionSet",
        json!({ "pattern": ["@agent_state", "attention.*"], "desc": desc }),
        |_, _| update(),
    ) {
        eprintln!("attention: {err}");
    }
    if let Err(err) = api::autocmd("PaneClosed", json!({ "desc": desc }), |_, _| update()) {
        eprintln!("attention: {err}");
    }
}

pumi_plugin::plugin!(init);
