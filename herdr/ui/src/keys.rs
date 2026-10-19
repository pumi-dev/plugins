//! herdr's default keys (`herdr --default-config`'s `[keys]`), in the prefix table (`C-b`, then
//! the key) while the package runs, unless `herdr.default_keys` is off. Each is a call of the
//! API, so it needs no other package; what herdr binds to its own TUI (help, settings,
//! detach, reload, the agent list, the sidebar, clear, reopen) has no API function and is
//! left out. They are bound over the host's tmux-like defaults where the two share a key.

use serde_json::{Value, json};

use pumi_plugin::api;

/// The option that turns them off.
pub const OPTION: &str = "herdr.default_keys";

fn call(name: &str, args: Value) -> Value {
    json!({ "call": name, "args": args })
}

fn split(side: &str) -> Value {
    call("pumi_open_pane", json!(["terminal", {}, { "split": side }]))
}

fn select(direction: &str) -> Value {
    call("pumi_pane_select", json!([{ "direction": direction }]))
}

fn resize(direction: &str) -> Value {
    call("pumi_pane_resize", json!([0, { "direction": direction, "cells": 1 }]))
}

/// Every key, its call and what it does.
pub fn bindings() -> Vec<(String, Value, &'static str)> {
    let mut keys: Vec<(String, Value, &str)> = vec![
        ("N".into(), call("pumi_create_session", json!([{}])), "New workspace"),
        ("D".into(), call("pumi_session_close", json!([0, false])), "Close the workspace"),
        ("[".into(), call("pumi_session_select", json!([{ "offset": -1 }])), "Previous workspace"),
        ("]".into(), call("pumi_session_select", json!([{ "offset": 1 }])), "Next workspace"),
        ("c".into(), call("pumi_open_pane", json!(["terminal", {}, { "kind": "tab" }])), "New tab"),
        ("p".into(), call("pumi_tab_select", json!([{ "offset": -1 }])), "Previous tab"),
        ("n".into(), call("pumi_tab_select", json!([{ "offset": 1 }])), "Next tab"),
        ("X".into(), call("pumi_tab_close", json!([0, false])), "Close the tab"),
        ("h".into(), select("L"), "Pane left"),
        ("j".into(), select("D"), "Pane below"),
        ("k".into(), select("U"), "Pane above"),
        ("l".into(), select("R"), "Pane right"),
        ("Tab".into(), select("next"), "Next pane"),
        ("BTab".into(), select("previous"), "Previous pane"),
        ("v".into(), split("right"), "Split right"),
        ("-".into(), split("down"), "Split down"),
        ("x".into(), call("pumi_pane_close", json!([0, false])), "Close the pane"),
        ("z".into(), call("pumi_pane_toggle_zoom", json!([0])), "Zoom the pane"),
        ("H".into(), resize("L"), "Resize left"),
        ("L".into(), resize("R"), "Resize right"),
        ("K".into(), resize("U"), "Resize up"),
        ("J".into(), resize("D"), "Resize down"),
    ];
    // herdr counts tabs from 1.
    for i in 1..=9 {
        keys.push((i.to_string(), call("pumi_tab_select", json!([{ "index": i - 1 }])), "Tab by number"));
    }
    keys
}

/// Declares [`OPTION`], for Settings.
pub fn declare_option() {
    let spec = json!({
        "type": "boolean",
        "default": true,
        "label": "herdr's keys",
        "group": "herdr",
        "desc": "While herdr runs, bind the prefix table (`C-b` then a key) herdr's way: `v` and `-` split, `h` `j` `k` `l` move, `1`–`9` pick a tab.",
    });
    if let Err(err) = api::pumi_create_option(OPTION, spec) {
        crate::log(&format!("{OPTION}: {}", err.message));
    }
}

/// Binds the keys, unless [`OPTION`] is off.
pub fn install() {
    let on = api::option(OPTION, json!({})).ok().and_then(|v| v.as_bool()).unwrap_or(true);
    if !on {
        return;
    }
    for (key, rhs, desc) in bindings() {
        let opts = json!({ "desc": desc, "repeat": desc.starts_with("Resize") });
        if let Err(err) = api::call("pumi_set_keymap", json!(["prefix", key, rhs, opts])) {
            crate::log(&format!("key {key}: {}", err.message));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_key_is_bound_once_and_calls_the_api() {
        let keys = bindings();
        let mut names: Vec<&str> = keys.iter().map(|(key, ..)| key.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), keys.len(), "a key bound twice");
        assert!(keys.iter().all(|(_, rhs, _)| rhs["call"].as_str().is_some_and(|f| f.starts_with("pumi_"))));
        let one = keys.iter().find(|(key, ..)| key == "1").unwrap();
        assert_eq!(one.1["args"][0]["index"], 0, "tab 1 is the first");
    }
}
