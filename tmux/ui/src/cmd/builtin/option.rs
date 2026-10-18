//! Options and the environment: `set-option`, `show-options`, `set-environment`,
//! `show-environment`, and `colorscheme`.

use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::Parsed;
use pumi_lang::target::Kind;

use super::{call, kernel};
use crate::cmd::{Flow, Queue, expand, target};
use crate::kernel::options::{Decl, Key, Scope, Type, normalise};

/// tmux's spelling of an option's name: dashes, unless it is a user or a package option.
pub fn tmux_name(name: &str) -> String {
    if name.starts_with('@') || name.contains('.') {
        name.to_string()
    } else {
        name.replace('_', "-")
    }
}

/// A value as tmux prints it: `on`/`off`, numbers, strings quoted when they must be.
pub fn show_value(value: &Value) -> String {
    match value {
        Value::Bool(b) => if *b { "on" } else { "off" }.into(),
        Value::Number(n) => n.to_string(),
        Value::String(s) if s.is_empty() => "\"\"".into(),
        Value::String(s) if s.chars().any(|c| " \t#;\"'{}$\\".contains(c)) => {
            format!(
                "\"{}\"",
                s.replace('\\', "\\\\")
                    .replace('"', "\\\"")
                    .replace('$', "\\$")
            )
        }
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// `name[3]`: the name and the array index.
fn split_index(name: &str) -> Result<(String, Option<usize>)> {
    match name.split_once('[') {
        Some((base, rest)) => {
            let index = rest
                .strip_suffix(']')
                .and_then(|i| i.parse().ok())
                .ok_or_else(|| Error::invalid_params(format!("invalid option index: {name}")))?;
            Ok((base.to_string(), Some(index)))
        }
        None => Ok((name.to_string(), None)),
    }
}

/// The object `set-option`'s flags name, as `pumi_set_option_value`'s `opts`.
fn scope(cx: &mut Cx, p: &Parsed, decl: Option<&Decl>, name: &str) -> Result<(Value, Key)> {
    let global = p.has('g') || p.has('s');
    let wanted = if global {
        if decl.is_some_and(|d| d.scope == Scope::Client) {
            Scope::Client
        } else {
            Scope::Global
        }
    } else if p.has('p') {
        Scope::Pane
    } else if p.has('w') {
        Scope::Tab
    } else {
        match decl.map(|d| d.scope) {
            Some(Scope::Global) => Scope::Global,
            Some(Scope::Pane) | Some(Scope::Tab) => Scope::Tab,
            Some(Scope::Client) => Scope::Client,
            Some(Scope::Session) => Scope::Session,
            None if name.starts_with('@') => Scope::Session,
            None => Scope::Global,
        }
    };
    Ok(match wanted {
        Scope::Global => (json!({"scope": "global"}), Key::Global),
        Scope::Session => {
            let s = target(cx, p.get('t'), Kind::Session)?.session;
            (json!({"scope": "session", "session": s}), Key::Session(s))
        }
        Scope::Tab => {
            let t = target(cx, p.get('t'), Kind::Tab)?
                .tab
                .ok_or_else(|| Error::not_found("no tab"))?;
            (json!({"scope": "tab", "tab": t}), Key::Tab(t))
        }
        Scope::Pane => {
            let pane = target(cx, p.get('t'), Kind::Pane)?
                .pane
                .ok_or_else(|| Error::not_found("no pane"))?;
            (json!({"scope": "pane", "pane": pane}), Key::Pane(pane))
        }
        Scope::Client => {
            let chan = cx.caller().channel;
            (
                json!({"scope": "client", "client": chan}),
                Key::Client(chan),
            )
        }
    })
}

/// `set-option [-aFgopqsuUw] [-t target] option [value]` (tmux's `set`).
pub fn set_option(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let result = set_option_inner(cx, queue, p);
    match result {
        Err(_) if p.has('q') => Ok(Flow::Next),
        other => other,
    }
}

fn set_option_inner(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let (name, index) = split_index(p.arg(0).unwrap_or(""))?;
    if super::hook::is_hook(&name) {
        return super::hook::set_hook(cx, queue, p);
    }
    let key = normalise(&name);
    let decl = kernel(cx).options.decl(&key).cloned();
    if decl.is_none() && !key.starts_with('@') {
        return Err(Error::not_found(format!("invalid option: {name}")));
    }
    let (opts, object) = scope(cx, p, decl.as_ref(), &key)?;
    let k = kernel(cx);
    let current = k.options.get_local(&key, object).map(|s| s.value.clone());
    if p.has('o') && current.is_some() {
        return Err(Error::invalid_params(format!("already set: {name}")));
    }
    if p.has('u') || p.has('U') {
        if p.has('U')
            && let Key::Tab(tab) = object
        {
            let panes = k.tabs[&tab].layout.panes();
            for pane in panes {
                call(
                    cx,
                    "pumi_set_option_value",
                    json!([key, null, {"pane": pane}]),
                )?;
            }
        }
        match index {
            Some(i) => {
                let mut list = current
                    .and_then(|c| c.as_array().cloned())
                    .unwrap_or_default();
                if i < list.len() {
                    list.remove(i);
                }
                call(cx, "pumi_set_option_value", json!([key, list, opts]))?;
            }
            None => {
                call(cx, "pumi_set_option_value", json!([key, null, opts]))?;
            }
        }
        return Ok(Flow::Next);
    }
    let raw = p.arg(1).map(str::to_string);
    let raw = match (raw, p.has('F')) {
        (Some(text), true) => {
            let k = kernel(cx);
            let pane = k.current(&queue.caller).map(|c| c.pane);
            Some(expand(k, queue, None, None, pane, &text))
        }
        (raw, _) => raw,
    };
    let k = kernel(cx);
    let effective = k
        .options
        .get(&key, &object_chain(k, object))
        .map(|(v, _)| v)
        .unwrap_or(Value::Null);
    let value = match decl.as_ref().map(|d| d.ty) {
        Some(Type::Boolean) => match raw.as_deref() {
            None | Some("") => json!(!effective.as_bool().unwrap_or(false)),
            Some(text) => json!(text),
        },
        Some(Type::Table) => {
            let mut list = match (&current, p.has('a') || index.is_some()) {
                (Some(Value::Array(list)), _) => list.clone(),
                (_, true) => effective.as_array().cloned().unwrap_or_default(),
                _ => Vec::new(),
            };
            let text = raw.unwrap_or_default();
            match index {
                Some(i) => {
                    while list.len() <= i {
                        list.push(json!(""));
                    }
                    list[i] = json!(text);
                }
                None => {
                    if !p.has('a') {
                        list.clear();
                    }
                    let separators: &[char] = if key == "command_alias" {
                        &[',']
                    } else {
                        &[' ', ',']
                    };
                    list.extend(
                        text.split(separators)
                            .filter(|s| !s.is_empty())
                            .map(|s| json!(s)),
                    );
                }
            }
            Value::Array(list)
        }
        _ => {
            let text = raw.unwrap_or_default();
            if p.has('a') {
                let before = current
                    .as_ref()
                    .or(Some(&effective))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                json!(format!("{before}{text}"))
            } else {
                json!(text)
            }
        }
    };
    call(cx, "pumi_set_option_value", json!([key, value, opts]))?;
    Ok(Flow::Next)
}

fn object_chain(k: &crate::kernel::Kernel, key: Key) -> Vec<Key> {
    match key {
        Key::Pane(p) => k.chain(Some(p), None, None),
        Key::Tab(t) => k.chain(None, Some(t), None),
        Key::Session(s) => k.chain(None, None, Some(s)),
        Key::Client(c) => vec![Key::Client(c), Key::Global],
        Key::Global => vec![Key::Global],
    }
}

/// `set-window-option`: `set-option -w`.
pub fn set_window_option(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut p = p.clone();
    p.flags.push(('w', None));
    set_option(cx, queue, &p)
}

/// `show-options [-AgHpqsvw] [-F format] [-t target] [option]` (tmux's `show`).
pub fn show_options(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let k = kernel(cx);
    if let Some(name) = p.arg(0) {
        let (name, index) = split_index(name)?;
        let key = normalise(&name);
        let decl = k.options.decl(&key).cloned();
        if decl.is_none() && !key.starts_with('@') {
            if p.has('q') {
                return Ok(Flow::Next);
            }
            return Err(Error::not_found(format!("invalid option: {name}")));
        }
        let (_, object) = scope(cx, p, decl.as_ref(), &key)?;
        let k = kernel(cx);
        let value = if p.has('A') || matches!(object, Key::Global) {
            k.options
                .get(&key, &object_chain(k, object))
                .map(|(v, _)| v)
        } else {
            k.options.get_local(&key, object).map(|s| s.value.clone())
        };
        let Some(value) = value.filter(|v| !v.is_null()) else {
            return Ok(Flow::Next);
        };
        print_option(queue, &tmux_name(&key), &value, index, p.has('v'));
        return Ok(Flow::Next);
    }
    let (_, object) = scope(cx, p, None, "")?;
    let k = kernel(cx);
    let category = if p.has('s') {
        Scope::Global
    } else if p.has('p') {
        Scope::Pane
    } else if p.has('w') {
        Scope::Tab
    } else {
        Scope::Session
    };
    let mut lines: Vec<(String, Value)> = Vec::new();
    match object {
        Key::Global => {
            for decl in k.options.decls() {
                let shown = match category {
                    Scope::Pane => decl.scope == Scope::Pane,
                    Scope::Tab => decl.scope == Scope::Tab || decl.scope == Scope::Pane,
                    other => decl.scope == other,
                };
                if !shown || decl.readonly {
                    continue;
                }
                let value = k
                    .options
                    .get(&decl.name, &[Key::Global])
                    .map(|(v, _)| v)
                    .unwrap_or(Value::Null);
                lines.push((decl.name.clone(), value));
            }
            for (name, set) in k.options.local(Key::Global) {
                if name.starts_with('@') {
                    lines.push((name, set.value));
                }
            }
        }
        key => {
            for (name, set) in k.options.local(key) {
                if k.options.is_readonly(&name) {
                    continue;
                }
                lines.push((name, set.value));
            }
        }
    }
    lines.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, value) in lines {
        if p.has_long("json") {
            queue.print(json!({ "name": name, "value": value }).to_string());
        } else {
            print_option(queue, &tmux_name(&name), &value, None, p.has('v'));
        }
    }
    Ok(Flow::Next)
}

fn print_option(
    queue: &mut Queue,
    name: &str,
    value: &Value,
    index: Option<usize>,
    only_value: bool,
) {
    match value {
        Value::Array(list) => {
            for (i, item) in list.iter().enumerate() {
                if index.is_some_and(|want| want != i) {
                    continue;
                }
                if only_value {
                    queue.print(show_value(item));
                } else {
                    queue.print(format!("{name}[{i}] {}", show_value(item)));
                }
            }
        }
        value if only_value => queue.print(show_value(value)),
        value => queue.print(format!("{name} {}", show_value(value))),
    }
}

pub fn show_window_options(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut p = p.clone();
    p.flags.push(('w', None));
    show_options(cx, queue, &p)
}

/// `set-environment [-Fhgru] [-t session] name [value]`.
pub fn set_environment(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let name = p.arg(0).unwrap_or("");
    let session = if p.has('g') {
        None
    } else {
        Some(target(cx, p.get('t'), Kind::Session)?.session)
    };
    let value = p.arg(1).map(str::to_string);
    let value = match (value, p.has('F')) {
        (Some(v), true) => {
            let k = kernel(cx);
            let pane = k.current(&queue.caller).map(|c| c.pane);
            Some(expand(k, queue, None, None, pane, &v))
        }
        (v, _) => v,
    };
    if !p.has('u') && !p.has('r') && value.is_none() {
        return Err(Error::invalid_params("no value specified"));
    }
    let value = if p.has('u') { None } else { value };
    call(
        cx,
        "pumi_set_environment",
        json!([name, value, {"session": session, "hidden": p.has('h'), "remove": p.has('r')}]),
    )?;
    Ok(Flow::Next)
}

/// `show-environment [-hgs] [-t session] [name]`: `-s` as shell commands.
pub fn show_environment(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = if p.has('g') {
        None
    } else {
        Some(target(cx, p.get('t'), Kind::Session)?.session)
    };
    let vars = call(cx, "pumi_get_environment", json!([{"session": session}]))?;
    let vars = vars.as_object().cloned().unwrap_or_default();
    if let Some(name) = p.arg(0)
        && !vars.contains_key(name)
    {
        return Err(Error::not_found(format!("unknown variable: {name}")));
    }
    for (name, var) in vars {
        if p.arg(0).is_some_and(|n| n != name) {
            continue;
        }
        let hidden = var["hidden"].as_bool().unwrap_or(false);
        if hidden != p.has('h') {
            continue;
        }
        match var["value"].as_str() {
            Some(value) if p.has('s') => queue.print(format!(
                "{name}=\"{}\"; export {name};",
                value.replace('"', "\\\"").replace('$', "\\$")
            )),
            Some(value) => queue.print(format!("{name}={value}")),
            None if p.has('s') => queue.print(format!("unset {name};")),
            None => queue.print(format!("-{name}")),
        }
    }
    Ok(Flow::Next)
}

/// `colorscheme [name]`: sets the option `colorscheme` (Neovim's `:colorscheme`), which the
/// runtime's highlight groups follow; without a name, prints it.
pub fn colorscheme(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    match p.arg(0) {
        // `pumi.colorscheme`: `colors/NAME.{lua,json}`, or a theme a VS Code extension contributes.
        Some(name) => {
            let code = format!("pumi.colorscheme({})", super::server::lua_string(name));
            crate::lua::run_for_queue(cx, queue, Some(&code), None, "=colorscheme")
        }
        None => {
            let name = kernel(cx).global_option("colors_name");
            queue.print(name.as_str().filter(|n| !n.is_empty()).unwrap_or("default"));
            Ok(Flow::Next)
        }
    }
}
