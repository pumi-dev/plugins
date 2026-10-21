//! agent-overview: every agent in this pumi in one pane — who is working, who is blocked, and
//! where. The rail narrows the list by state and by name; a row picks an agent, a second click
//! goes to its pane.
//!
//! It reads nothing on its own: an agent says what it is doing itself, over OSC 7501, and the
//! host keeps that as a pane's `@agent_status` and `@program_status` (docs/v2/23 §6). The
//! dashboard is one `pumi_get_state` every few seconds, and a read of every open dashboard
//! whenever an event says something moved.
//!
//! `pumi call agent_overview.open` opens it, `agent_overview.list` answers with the agents as
//! JSON, and `agent_overview.key` binds a chord to it.

mod data;
mod view;

use std::cell::RefCell;

use pumi_plugin::gpui::Focusable;
use pumi_plugin::prelude::*;
use pumi_plugin::ui;

// The chord the key is bound at, so a change unbinds the one before.
thread_local! {
    static BOUND: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Declare one of its options, in its group in Settings.
fn declare(name: &str, mut spec: Value) {
    spec["group"] = json!("Agent overview");
    if let Err(err) = api::pumi_create_option(&format!("agent_overview.{name}"), spec) {
        eprintln!("agent-overview: {err}");
    }
}

/// Bind `agent_overview.key` (and unbind the chord it was bound at before).
fn bind() {
    let key = api::option("agent_overview.key", json!({}))
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default();
    BOUND.with(|bound| {
        let mut bound = bound.borrow_mut();
        if bound.as_deref() == Some(key.as_str()) {
            return;
        }
        if let Some(old) = bound.take() {
            let _ = api::pumi_del_keymap("root", &old, json!({}));
        }
        if key.is_empty() {
            return;
        }
        let rhs = json!({ "call": "agent_overview.open" });
        match api::pumi_set_keymap("root", &key, rhs, json!({ "desc": "Open the agent overview" })) {
            Ok(()) => *bound = Some(key),
            Err(err) => eprintln!("agent-overview: {err}"),
        }
    });
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    declare(
        "poll_secs",
        json!({
            "type": "number", "default": 15, "min": 2, "max": 600, "step": 1, "unit": "s",
            "label": "Refresh every",
            "desc": "How often it reads the model again, besides the events it follows (an agent's state, a pane or tab opening or closing).",
        }),
    );
    declare(
        "hide_idle",
        json!({
            "type": "boolean", "default": false,
            "label": "Hide idle agents",
            "desc": "Leave out agents that are only waiting for a prompt, except the pane you are in.",
        }),
    );
    declare(
        "rail_width",
        json!({
            "type": "number", "default": 248, "min": 180, "max": 380, "step": 4, "unit": "px",
            "label": "Rail width",
            "desc": "How wide the list of sessions and agents is.",
        }),
    );
    declare(
        "key",
        json!({
            "type": "string", "default": "", "placeholder": "<M-a>",
            "label": "Key",
            "desc": "A chord that opens the overview from anywhere (the root key table). Empty for none; `pumi call agent_overview.open` works regardless.",
        }),
    );

    plugin.view("overview", |_open, window, cx| {
        let query = cx.new(|cx| ui::TextInput::new("", "Filter agents", window, cx).search());
        let focus = query.focus_handle(cx);
        window.focus(&focus, cx);
        let dashboard = cx.new(|cx| view::Dashboard::new(query, cx));
        dashboard.into()
    });

    if let Err(err) = api::provide(
        "agent_overview.open",
        json!({ "desc": "Open the agent overview in a tab of its own: go to the one open, else make the tab.", "examples": [{ "args": [] }] }),
        |_| Ok(json!(view::open())),
    ) {
        eprintln!("agent-overview: {err}");
    }
    if let Err(err) = api::provide(
        "agent_overview.list",
        json!({
            "desc": "Every agent and what it is doing: `{agents, counts, sessions}`.",
            "examples": [{ "args": [], "result": { "agents": [{ "pane": 1, "agent": "pi", "status": "working" }], "counts": { "working": 1 }, "sessions": 1 } }],
        }),
        |_| data::list(),
    ) {
        eprintln!("agent-overview: {err}");
    }

    if let Err(err) = api::pumi_menu_add(
        "View.Agent Overview",
        json!({ "call": "agent_overview.open" }),
        json!({ "desc": "Every agent in this pumi: who is working, who is blocked, and where." }),
    ) {
        eprintln!("agent-overview: {err}");
    }

    let desc = "the agent overview follows the agents";
    for event in ["AgentState", "PaneNew", "PaneClosed", "TabNew", "TabClosed", "SessionEnter", "SessionClosed"] {
        if let Err(err) = api::autocmd(event, json!({ "desc": desc }), |_, cx| view::refresh_open(cx)) {
            eprintln!("agent-overview: {err}");
        }
    }
    if let Err(err) = api::autocmd(
        "OptionSet",
        json!({ "pattern": "@agent*", "desc": desc }),
        |_, cx| view::refresh_open(cx),
    ) {
        eprintln!("agent-overview: {err}");
    }

    bind();
    if let Err(err) = api::autocmd(
        "OptionSet",
        json!({ "pattern": "agent_overview.*", "desc": "agent-overview follows its options" }),
        |_, cx| {
            bind();
            view::refresh_open(cx);
        },
    ) {
        eprintln!("agent-overview: {err}");
    }
}

pumi_plugin::plugin!(init, api = 1);
