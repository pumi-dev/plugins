//! Hooks and events: `set-hook` (an autocmd with a command, tmux 3.8's monitors and user
//! events), `show-hooks`, `wait-for`, and Neovim's `autocmd` and `doautocmd`.

use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::{Arg, Command, Parsed, print, print_list};
use pumi_lang::target::Kind;

use super::{call, kernel};
use crate::cmd::Cmd;
use crate::cmd::{Flow, Monitor, Outcome, Queue, target, truthy};
use crate::kernel::events::{About, EVENTS};

/// Hook names `set-hook` takes (and `after-<command>`) as well as autocmd events.
pub const HOOKS: &[&str] = &[
    "bind-key",
    "capture-pane",
    "copy-mode",
    "display-message",
    "display-panes",
    "kill-pane",
    "list-buffers",
    "list-clients",
    "list-keys",
    "list-panes",
    "list-sessions",
    "list-windows",
    "load-buffer",
    "lock-server",
    "new-session",
    "new-window",
    "paste-buffer",
    "pipe-pane",
    "refresh-client",
    "rename-session",
    "rename-window",
    "resize-pane",
    "resize-window",
    "save-buffer",
    "select-layout",
    "select-pane",
    "select-window",
    "send-keys",
    "set-buffer",
    "set-environment",
    "set-hook",
    "set-option",
    "show-environment",
    "show-messages",
    "show-options",
    "split-window",
    "swap-window",
    "unbind-key",
    "alert-activity",
    "alert-bell",
    "alert-silence",
    "client-active",
    "client-attached",
    "client-created",
    "client-closed",
    "client-detached",
    "client-focus-in",
    "client-focus-out",
    "client-resized",
    "client-session-changed",
    "client-light-theme",
    "client-dark-theme",
    "command-error",
    "marked-pane-changed",
    "pane-activity",
    "pane-bell",
    "pane-command-finished",
    "pane-command-started",
    "pane-created",
    "pane-died",
    "pane-exited",
    "pane-focus-in",
    "pane-focus-out",
    "pane-mode-changed",
    "pane-mode-entered",
    "pane-mode-exited",
    "pane-moved",
    "pane-prompt-closed",
    "pane-prompt-opened",
    "pane-resized",
    "pane-set-clipboard",
    "pane-shell-prompt",
    "pane-title-changed",
    "session-closed",
    "session-created",
    "session-added-to-group",
    "session-renamed",
    "session-removed-from-group",
    "session-window-changed",
    "window-created",
    "window-closed",
    "window-layout-changed",
    "window-linked",
    "window-pane-changed",
    "window-renamed",
    "window-resized",
    "window-unzoomed",
    "window-zoomed",
    "window-unlinked",
];

/// Whether a name is a hook `set-option` should hand to `set-hook`.
/// Whether an autocmd group exists (the host keeps them).
fn group_exists(cx: &mut Cx, name: &str) -> bool {
    call(cx, "pumi_get_autocmds", json!([{ "group": name }])).is_ok()
}

pub fn is_hook(name: &str) -> bool {
    let base = name.split('[').next().unwrap_or(name);
    HOOKS.contains(&base) || base.starts_with("after-")
}

/// The event and pattern a hook name means; an event's own name is itself; anything else
/// (and every `@name`) is a `User` event of that name.
pub fn hook_event(cx: &mut Cx, name: &str) -> (String, Option<String>) {
    let name = name.split('[').next().unwrap_or(name);
    if EVENTS.contains(&name) {
        return (name.to_string(), None);
    }
    if let Some(command) = name.strip_prefix("after-") {
        let canonical = match crate::cmd::find(kernel(cx), command) {
            Ok(crate::cmd::Found2::Builtin(entry)) => entry.name.to_string(),
            _ => command.to_string(),
        };
        return ("CommandPost".into(), Some(canonical));
    }
    let (event, pattern) = match name {
        "alert-bell" | "pane-bell" => ("TermBell", None),
        "client-attached" => ("UIEnter", None),
        "client-detached" => ("UILeave", None),
        "client-session-changed" => ("SessionEnter", None),
        "client-focus-in" => ("FocusGained", None),
        "client-focus-out" => ("FocusLost", None),
        "pane-died" | "pane-exited" => ("TermClose", None),
        "pane-focus-in" | "window-pane-changed" => ("PaneEnter", None),
        "pane-focus-out" => ("PaneLeave", None),
        "pane-created" => ("PaneNew", None),
        "pane-resized" | "window-resized" => ("PaneResized", None),
        "pane-moved" => ("PaneMoved", None),
        "pane-title-changed" => ("OptionSet", Some("title")),
        "session-created" => ("SessionNew", None),
        "session-closed" => ("SessionClosed", None),
        "session-renamed" => ("SessionRenamed", None),
        "session-window-changed" => ("TabEnter", None),
        "window-created" | "window-linked" => ("TabNew", None),
        "window-closed" | "window-unlinked" => ("TabClosed", None),
        "window-layout-changed" => ("LayoutChanged", None),
        "window-renamed" => ("TabRenamed", None),
        "window-zoomed" => ("LayoutChanged", Some("zoom")),
        "window-unzoomed" => ("LayoutChanged", Some("unzoom")),
        _ => return ("User".into(), Some(name.to_string())),
    };
    (event.into(), pattern.map(str::to_string))
}

fn group(name: &str) -> String {
    format!("hook:{}", name.split('[').next().unwrap_or(name))
}

/// `set-hook [-agpERTuw] [-B name:what:format] [-t target] hook [command]`.
pub fn set_hook(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    if let Some(spec) = p.get('B') {
        return monitor(cx, p, spec);
    }
    let name = p
        .arg(0)
        .ok_or_else(|| Error::invalid_params("no hook"))?
        .to_string();
    if p.has('E') {
        if !name.starts_with('@') {
            return Err(Error::invalid_params(format!(
                "user events begin with @: {name}"
            )));
        }
        let pane = kernel(cx).current(&queue.caller).map(|c| c.pane);
        call(
            cx,
            "pumi_exec_autocmds",
            json!(["User", {"pattern": name, "pane": pane, "data": {}}]),
        )?;
        return Ok(Flow::Next);
    }
    let group = group(&name);
    if p.has('R') {
        let autocmds = call(cx, "pumi_get_autocmds", json!([{"group": group}]))?;
        let mut insert = Vec::new();
        for autocmd in autocmds.as_array().cloned().unwrap_or_default() {
            if let Some(command) = autocmd["command"].as_str() {
                insert.extend(crate::cmd::parse_text(cx, queue, command)?);
            }
        }
        return Ok(Flow::Insert(insert));
    }
    let exists = group_exists(cx, &group);
    if p.has('u') {
        if exists {
            call(cx, "pumi_clear_autocmds", json!([{"group": group}]))?;
        }
        return Ok(Flow::Next);
    }
    let command = match p.args.get(1) {
        Some(Arg::Commands(list)) => print_list(list),
        Some(Arg::String(text)) => text.clone(),
        None => return Err(Error::invalid_params("no command")),
    };
    // Checked now, so a hook that cannot parse fails here rather than each time it fires.
    crate::cmd::parse_text(cx, queue, &command)?;
    call(
        cx,
        "pumi_create_augroup",
        json!([group, {"clear": !p.has('a')}]),
    )?;
    let (event, pattern) = hook_event(cx, &name);
    let mut opts = json!({ "group": group, "command": command, "desc": name });
    if let Some(pattern) = pattern {
        opts["pattern"] = json!(pattern);
    }
    call(cx, "pumi_create_autocmd", json!([event, opts]))?;
    Ok(Flow::Next)
}

/// `set-hook -B name:what:format`: a format watched once a second (tmux 3.8).
fn monitor(cx: &mut Cx, p: &Parsed, spec: &str) -> Result<Flow> {
    let mut parts = spec.splitn(3, ':');
    let (Some(name), Some(what), Some(format)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(Error::invalid_params(format!(
            "a monitor is name:what:format, not {spec}"
        )));
    };
    if !name.starts_with('@') {
        return Err(Error::invalid_params(format!(
            "monitor names begin with @: {name}"
        )));
    }
    let k = kernel(cx);
    k.cmd().monitors.retain(|m| m.name != name);
    if p.has('u') {
        return Ok(Flow::Next);
    }
    if !["session", "pane", "panes", "window", "windows", ""].contains(&what) {
        return Err(Error::invalid_params(format!(
            "a monitor watches session, pane, panes, window or windows, not {what}"
        )));
    }
    let found = target(cx, p.get('t'), Kind::Pane).ok();
    let anchor = found
        .map(|f| (Some(f.session), f.tab, f.pane))
        .unwrap_or((None, None, None));
    let k = kernel(cx);
    k.cmd().monitors.push(Monitor {
        name: name.into(),
        what: what.into(),
        format: format.into(),
        only_true: p.has('T'),
        last: Default::default(),
        anchor,
    });
    if let Some(command) = p.args.get(1) {
        let command = command.to_text();
        let group = group(name);
        call(cx, "pumi_create_augroup", json!([group, {"clear": true}]))?;
        call(
            cx,
            "pumi_create_autocmd",
            json!(["User", {"group": group, "pattern": name, "command": command, "desc": name}]),
        )?;
    }
    Ok(Flow::Next)
}

/// An object a monitor watches: its id, and the session, tab and pane its format is about.
type Watched = (u64, Option<u64>, Option<u64>, Option<u64>);

/// Each monitor's format, again: a change fires its `@name` user event.
pub fn check_monitors(cx: &mut Cx) {
    let monitors = kernel(cx).cmd().monitors.clone();
    let mut fired = Vec::new();
    let mut updated = Vec::new();
    {
        let k = kernel(cx);
        for monitor in monitors {
            let (session, tab, pane) = monitor.anchor;
            let objects: Vec<Watched> = match monitor.what.as_str() {
                "session" => session
                    .map(|s| vec![(s, Some(s), None, None)])
                    .unwrap_or_default(),
                "window" => tab
                    .map(|t| vec![(t, session, Some(t), None)])
                    .unwrap_or_default(),
                "windows" => k.tabs.keys().map(|t| (*t, None, Some(*t), None)).collect(),
                "panes" => k.panes.keys().map(|p| (*p, None, None, Some(*p))).collect(),
                _ => pane
                    .map(|p| vec![(p, None, None, Some(p))])
                    .unwrap_or_default(),
            };
            let mut monitor = monitor;
            for (id, s, t, p) in objects {
                if p.is_some_and(|p| !k.panes.contains_key(&p))
                    || t.is_some_and(|t| !k.tabs.contains_key(&t))
                {
                    continue;
                }
                let fmt = crate::kernel::format::Fmt::new(k, s, t, p);
                let value = pumi_lang::format::expand(&fmt, &monitor.format);
                let last = monitor.last.insert(id, value.clone());
                let changed = last.as_ref().is_some_and(|l| *l != value);
                if changed && (!monitor.only_true || truthy(&value)) {
                    fired.push((
                        monitor.name.clone(),
                        p,
                        json!({
                            "last": last,
                            "value": value,
                            "monitor_format": monitor.format,
                            "monitor_target": id,
                        }),
                    ));
                }
            }
            updated.push(monitor);
        }
        k.cmd().monitors = updated;
    }
    for (name, pane, data) in fired {
        let about = About {
            pane,
            ..About::default()
        };
        kernel(cx).emit("User", &name, about, data);
    }
}

/// `show-hooks [-gpw] [-t target] [hook]`.
pub fn show_hooks(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let autocmds = call(cx, "pumi_get_autocmds", json!([{}]))?;
    let mut by_hook: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for autocmd in autocmds.as_array().cloned().unwrap_or_default() {
        let Some(group) = autocmd["group_name"]
            .as_str()
            .and_then(|g| g.strip_prefix("hook:"))
        else {
            continue;
        };
        if p.arg(0).is_some_and(|want| want != group) {
            continue;
        }
        if let Some(command) = autocmd["command"].as_str() {
            by_hook
                .entry(group.to_string())
                .or_default()
                .push(command.to_string());
        }
    }
    for (hook, commands) in by_hook {
        for (i, command) in commands.iter().enumerate() {
            queue.print(format!("{hook}[{i}] {command}"));
        }
    }
    if p.has('B') {
        for monitor in &kernel(cx).cmd().monitors {
            queue.print(format!(
                "{}:{}:{}",
                monitor.name, monitor.what, monitor.format
            ));
        }
    }
    Ok(Flow::Next)
}

/// `wait-for [-ELSUlv] [-F format] [-w waiter] name`: waits on a channel until `-S` signals it,
/// locks it (`-L`/`-U`), or with `-E` waits for the next event of that name.
pub fn wait_for(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let name = p.arg(0).unwrap_or("").to_string();
    if p.has('S') {
        crate::cmd::channel_signal(cx, &name);
        return Ok(Flow::Next);
    }
    if p.has('U') {
        crate::cmd::channel_unlock(cx, &name)?;
        return Ok(Flow::Next);
    }
    if p.has('l') {
        for waiter in crate::cmd::channel_waiters(kernel(cx), &name) {
            queue.print(waiter.to_string());
        }
        return Ok(Flow::Next);
    }
    if let Some(waiter) = p.get('w') {
        let id: u64 = waiter
            .parse()
            .map_err(|_| Error::invalid_params(format!("no waiter {waiter}")))?;
        crate::cmd::resume(cx, id, Outcome::default());
        return Ok(Flow::Next);
    }
    if p.has('L') {
        let k = kernel(cx);
        return Ok(if crate::cmd::channel_lock(k, queue, &name) {
            Flow::Wait
        } else {
            Flow::Next
        });
    }
    if p.has('E') {
        let (event, pattern) = hook_event(cx, &name);
        let format = p.get('F').map(str::to_string);
        let verbose = p.has('v');
        let vars = queue.vars.clone();
        crate::cmd::wait_for_event(kernel(cx), queue, vec![event], move |cx, event| {
            if pattern
                .as_ref()
                .is_some_and(|want| !pumi_lang::format::fnmatch(want, &event.matched, false))
            {
                return None;
            }
            let mut output = String::new();
            if verbose && let Some(data) = event.data.as_object() {
                for key in data.keys() {
                    output.push_str(&format!("hook_{key}\n"));
                }
            }
            if let Some(format) = &format {
                let k = kernel(cx);
                let mut vars = vars.clone();
                vars.extend(crate::kernel::events::hook_vars(event));
                let mut fmt = crate::kernel::format::Fmt::new(
                    k,
                    event.about.session,
                    event.about.tab,
                    event.about.pane.filter(|p| k.panes.contains_key(p)),
                );
                fmt.extra = Some(&vars);
                if !truthy(&pumi_lang::format::expand(&fmt, format)) {
                    return None;
                }
            }
            Some(Outcome {
                output,
                ..Outcome::default()
            })
        });
        return Ok(Flow::Wait);
    }
    let k = kernel(cx);
    Ok(if crate::cmd::channel_wait(k, queue, &name) {
        Flow::Wait
    } else {
        Flow::Next
    })
}

/// `autocmd [group] event[,event] pattern [++once] command…` (Neovim's `:autocmd`); alone, it
/// lists them.
pub fn autocmd(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut words: Vec<Arg> = p.args.clone();
    if words.is_empty() {
        let autocmds = call(cx, "pumi_get_autocmds", json!([{}]))?;
        for a in autocmds.as_array().cloned().unwrap_or_default() {
            let events: Vec<String> = a["event"]
                .as_array()
                .map(|e| {
                    e.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let patterns: Vec<String> = a["pattern"]
                .as_array()
                .map(|e| {
                    e.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let action = a["command"]
                .as_str()
                .map(str::to_string)
                .or_else(|| a["chan"].as_u64().map(|c| format!("(chan {c})")))
                .unwrap_or_else(|| "(callback)".into());
            let group = a["group_name"]
                .as_str()
                .map(|g| format!("{g} "))
                .unwrap_or_default();
            let patterns = if patterns.is_empty() {
                "*".to_string()
            } else {
                patterns.join(",")
            };
            queue.print(format!("{group}{} {patterns} {action}", events.join(",")));
        }
        return Ok(Flow::Next);
    }
    let first = words[0].to_text();
    let mut group: Option<String> = None;
    if !first.split(',').all(|e| EVENTS.contains(&e) || is_hook(e)) && group_exists(cx, &first) {
        group = Some(first);
        words.remove(0);
    }
    let events_word = words
        .first()
        .map(Arg::to_text)
        .ok_or_else(|| Error::invalid_params("autocmd needs an event"))?;
    let mut events = Vec::new();
    let mut hook_pattern = None;
    for name in events_word.split(',') {
        let (event, pattern) = hook_event(cx, name);
        events.push(event);
        hook_pattern = hook_pattern.or(pattern);
    }
    let pattern = words
        .get(1)
        .map(Arg::to_text)
        .ok_or_else(|| Error::invalid_params("autocmd needs a pattern"))?;
    let mut rest: Vec<Arg> = words[2..].to_vec();
    let once = rest.first().and_then(Arg::as_str) == Some("++once");
    if once {
        rest.remove(0);
    }
    let command = match rest.as_slice() {
        [] => return Err(Error::invalid_params("autocmd needs a command")),
        [Arg::Commands(list)] => print_list(list),
        [Arg::String(one)] => one.clone(),
        [first, others @ ..] => print(&Command {
            name: first.to_text(),
            args: others.to_vec(),
            line: 0,
        }),
    };
    let mut opts = json!({ "command": command, "once": once });
    let pattern = if pattern == "*" {
        hook_pattern
    } else {
        Some(pattern)
    };
    if let Some(pattern) = pattern {
        opts["pattern"] = json!(pattern);
    }
    if let Some(group) = group {
        opts["group"] = json!(group);
    }
    call(cx, "pumi_create_autocmd", json!([events, opts]))?;
    Ok(Flow::Next)
}

/// `autocmd! [group] [event] [pattern]`: clears them.
pub fn autocmd_clear(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut words = p.words();
    let mut opts = json!({});
    if let Some(first) = words.first()
        && group_exists(cx, first)
    {
        opts["group"] = json!(first);
        words.remove(0);
    }
    if let Some(event) = words.first() {
        opts["event"] = json!(event.split(',').collect::<Vec<_>>());
    }
    if let Some(pattern) = words.get(1).filter(|p| *p != "*") {
        opts["pattern"] = json!(pattern);
    }
    call(cx, "pumi_clear_autocmds", json!([opts]))?;
    Ok(Flow::Next)
}

/// `doautocmd [group] event [pattern]` (Neovim's `:doautocmd`; `doautocmd User Built`).
pub fn doautocmd(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut words = p.words();
    if words
        .first()
        .is_some_and(|w| group_exists(cx, w) && !EVENTS.contains(&w.as_str()))
    {
        words.remove(0);
    }
    let event = words
        .first()
        .ok_or_else(|| Error::invalid_params("doautocmd needs an event"))?
        .clone();
    let pane = kernel(cx).current(&queue.caller).map(|c| c.pane);
    let mut opts = json!({ "pane": pane, "data": {} });
    if let Some(pattern) = words.get(1) {
        opts["pattern"] = json!(pattern);
    }
    call(cx, "pumi_exec_autocmds", json!([event, opts]))?;
    Ok(Flow::Next)
}
