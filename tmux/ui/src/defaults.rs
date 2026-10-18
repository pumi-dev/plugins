//! tmux's defaults while it runs (23 §5): the prefix table's command-string bindings (after
//! tmux's key-bindings.c; they were pumi's `runtime/plugin/keys.lua`) and the Session menu
//! (`runtime/plugin/menus.lua`). Each runs a command line through `pumi_cmd`, which is tmux's.
//! A user's `unbind-key` or `pumi.keymap.del` takes them away; `tmux.default_keys` off leaves
//! them out.

use serde_json::{Value, json};

use pumi_plugin::api;

/// The prefix table (`C-b`, then the key).
const PREFIX: &[(&str, &str)] = &[
    ("C-b", "send-prefix"),
    ("C-o", "rotate-window"),
    ("Space", "next-layout"),
    ("!", "break-pane"),
    ("\"", "split-window"),
    ("#", "list-buffers"),
    ("$", "command-prompt -I \"#S\" \"rename-session -- '%%'\""),
    ("%", "split-window -h"),
    ("&", "confirm-before -p \"kill-window #W? (y/n)\" kill-window"),
    ("'", "command-prompt -T window-target -p index \"select-window -t ':%%'\""),
    ("(", "switch-client -p"),
    (")", "switch-client -n"),
    (",", "command-prompt -I \"#W\" \"rename-window -- '%%'\""),
    ("-", "delete-buffer"),
    (".", "command-prompt -T target \"move-window -t '%%'\""),
    (":", "command-prompt"),
    (";", "last-pane"),
    ("=", "choose-buffer -Z"),
    ("?", "list-keys -N"),
    ("D", "choose-client -Z"),
    ("E", "select-layout -E"),
    ("L", "switch-client -l"),
    ("M", "select-pane -M"),
    ("[", "copy-mode"),
    ("]", "paste-buffer -p"),
    ("c", "new-window"),
    ("d", "detach-client"),
    ("f", "command-prompt \"find-window -Z -- '%%'\""),
    ("i", "display-message"),
    ("l", "last-window"),
    ("m", "select-pane -m"),
    ("n", "next-window"),
    ("o", "select-pane -t :.+"),
    ("p", "previous-window"),
    ("q", "display-panes"),
    ("r", "refresh-client"),
    ("s", "choose-tree -Zs"),
    ("t", "clock-mode"),
    ("w", "choose-tree -Zw"),
    ("x", "confirm-before -p \"kill-pane #P? (y/n)\" kill-pane"),
    ("z", "resize-pane -Z"),
    ("{", "swap-pane -U"),
    ("}", "swap-pane -D"),
    ("~", "show-messages"),
    ("Up", "select-pane -U"),
    ("Down", "select-pane -D"),
    ("Left", "select-pane -L"),
    ("Right", "select-pane -R"),
    ("M-1", "select-layout even-horizontal"),
    ("M-2", "select-layout even-vertical"),
    ("M-3", "select-layout main-horizontal"),
    ("M-4", "select-layout main-vertical"),
    ("M-5", "select-layout tiled"),
    ("M-n", "next-window -a"),
    ("M-o", "rotate-window -D"),
    ("M-p", "previous-window -a"),
];

/// tmux's repeating resize keys (`bind -r`): `C-<dir>` by one, `M-<dir>` by five.
const RESIZE: &[(&str, &str)] = &[("Up", "U"), ("Down", "D"), ("Left", "L"), ("Right", "R")];

/// The Session menu, merged into the app's menu bar.
const MENU: &[(&str, &str)] = &[
    ("Session.New Session", "new-session -d"),
    ("Session.Rename Session…", "command-prompt -I \"#S\" \"rename-session -- '%%'\""),
    ("Session.Next Session", "switch-client -n"),
    ("Session.Previous Session", "switch-client -p"),
    ("Session.-sep1-", ""),
    ("Session.New Tab", "new-window"),
    ("Session.Rename Tab…", "command-prompt -I \"#W\" \"rename-window -- '%%'\""),
    ("Session.-sep2-", ""),
    ("Session.Split Right", "split-window -h"),
    ("Session.Split Down", "split-window -v"),
    ("Session.Zoom Pane", "resize-pane -Z"),
    ("Session.Layout.Even Horizontal", "select-layout even-horizontal"),
    ("Session.Layout.Even Vertical", "select-layout even-vertical"),
    ("Session.Layout.Main Horizontal", "select-layout main-horizontal"),
    ("Session.Layout.Main Vertical", "select-layout main-vertical"),
    ("Session.Layout.Tiled", "select-layout tiled"),
    ("Session.-sep3-", ""),
    ("Session.Command Prompt…", "command-prompt"),
    ("Session.Kill Pane", "confirm-before -p \"kill-pane #P? (y/n)\" kill-pane"),
    ("Session.Kill Session", "confirm-before -p \"kill-session #S? (y/n)\" kill-session"),
];

/// tmux's options (`tmux.*`), declared for Settings.
pub fn declare_options() {
    let spec = json!({
        "type": "boolean",
        "default": true,
        "label": "tmux's keys and menu",
        "group": "tmux",
        "desc": "While tmux runs, bind the prefix table (`C-b` then a key) and the Session menu its way.",
    });
    if let Err(err) = api::call("pumi_create_option", json!(["tmux.default_keys", spec])) {
        crate::kernel::log(&format!("tmux.default_keys: {}", err.message));
    }
}

/// A command line as a key's or a menu item's `rhs`: a call to `pumi_cmd` (23 §5).
fn rhs(command: &str) -> Value {
    json!({ "call": "pumi_cmd", "args": [command, {}] })
}

/// `name(head…, rhs, opts)`, the rhs as a call; where the API still takes a command string,
/// the string.
fn bind(name: &str, head: &[&str], command: &str, opts: Value) {
    let args = |rhs: Value| {
        let mut list: Vec<Value> = head.iter().map(|h| json!(h)).collect();
        list.push(rhs);
        list.push(opts.clone());
        Value::Array(list)
    };
    let made = if command.is_empty() {
        api::call(name, args(json!("")))
    } else {
        api::call(name, args(rhs(command))).or_else(|_| api::call(name, args(json!(command))))
    };
    if let Err(err) = made {
        crate::kernel::log(&format!("{name} {}: {}", head.join(" "), err.message));
    }
}

/// Binds the prefix keys and adds the Session menu, unless `tmux.default_keys` is off.
pub fn install() {
    let on = api::option("tmux.default_keys", json!({})).ok().and_then(|v| v.as_bool()).unwrap_or(true);
    if !on {
        return;
    }
    for (key, command) in PREFIX {
        bind("pumi_set_keymap", &["prefix", key], command, json!({}));
    }
    for i in 0..=9 {
        let key = i.to_string();
        bind("pumi_set_keymap", &["prefix", &key], &format!("select-window -t :={i}"), json!({}));
    }
    for (key, dir) in RESIZE {
        let opts = json!({ "repeat": true });
        bind("pumi_set_keymap", &["prefix", &format!("C-{key}")], &format!("resize-pane -{dir}"), opts.clone());
        bind("pumi_set_keymap", &["prefix", &format!("M-{key}")], &format!("resize-pane -{dir} 5"), opts);
    }
    for (i, (path, command)) in MENU.iter().enumerate() {
        bind("pumi_menu_add", &[path], command, json!({ "priority": i + 1 }));
    }
}
