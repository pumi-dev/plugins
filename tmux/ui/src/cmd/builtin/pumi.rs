//! pumi's own commands: `call`, `api`, `record`, `mkview`, `loadview`, `mksession`, `context`,
//! and the ones only the CLI runs (`events`, `mcp`, `skill`).

use std::fmt::Write as _;

use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::Parsed;

use super::{call, kernel};
use crate::cmd::Cmd;
use crate::cmd::{Flow, Queue, path, target_pane};
use crate::kernel::Place;

pub const AGENTS_GUIDE: &str = "\
You are in a pane of pumi, a terminal workspace; `pumi context` maps every pane.
  pumi capture-pane -p -t %3          what a pane shows (any type: terminals, browsers)
  pumi split-pane -h -d -- CMD        run a command beside you, keeping focus
  pumi split-pane --type browser URL  show a page
  pumi send-keys -t %3 'make' Enter   type into a pane (only when asked)
  pumi wait-pane -t %3                wait for its program to exit
  pumi call FUNCTION key=value        any function; `pumi api list` lists them";

/// `call FUNCTION [json | key=value… | value…]`: any function, its result as JSON.
pub fn call_function(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let words = p.words();
    let (name, rest) = words.split_first().ok_or_else(|| Error::invalid_params("call needs a function"))?;
    let args = super::user::function_args(cx, name, rest)?;
    let result = call(cx, name, args)?;
    queue.print(result.to_string());
    Ok(Flow::Next)
}

/// `api list [-q] [--pane PANE]`, `api describe FUNCTION`, `api info`: the API as data (Rex's
/// discovery commands).
pub fn api(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let words = p.words();
    match words.first().map(String::as_str) {
        None | Some("list") => {
            if let Some(pane) = p.long("pane") {
                let pane = target_pane(cx, Some(pane))?;
                let ty = kernel(cx).panes[&pane].ty.clone();
                let types = call(cx, "pumi_list_pane_types", json!([]))?;
                let info = types
                    .as_array()
                    .and_then(|t| t.iter().find(|t| t["name"] == json!(ty)))
                    .cloned()
                    .unwrap_or_default();
                for method in ["read", "input", "selection"].iter().map(|m| m.to_string()).chain(
                    info["methods"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string),
                ) {
                    queue.print(format!("{ty}.{method}"));
                }
                return Ok(Flow::Next);
            }
            for info in crate::api::functions(cx) {
                if p.has('q') {
                    queue.print(&info.name);
                } else if p.has_long("json") {
                    queue.print(json!(info).to_string());
                } else {
                    let first = info.desc.split(". ").next().unwrap_or("").trim_end_matches('.');
                    queue.print(format!("{:<28} {first}", info.name));
                }
            }
            Ok(Flow::Next)
        }
        Some("describe") => {
            let name = words.get(1).ok_or_else(|| Error::invalid_params("api describe FUNCTION"))?;
            let info =
                crate::api::function_info(cx, name).ok_or_else(|| Error::not_found(format!("no function `{name}`")))?;
            queue.print(serde_json::to_string_pretty(&info).unwrap_or_default());
            Ok(Flow::Next)
        }
        Some("info") => {
            let info = call(cx, "pumi_get_api_info", json!([]))?;
            queue.print(info.to_string());
            Ok(Flow::Next)
        }
        Some(other) => Err(Error::invalid_params(format!("api list, describe or info, not {other}"))),
    }
}

/// A JSON value as a Lua literal.
pub fn lua_value(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("pumi.NIL"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => lua_string(s, out),
        Value::Array(list) => {
            out.push('{');
            for (i, item) in list.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                lua_value(item, out);
            }
            out.push('}');
        }
        Value::Object(map) if map.is_empty() => out.push_str("pumi.empty_dict()"),
        Value::Object(map) => {
            out.push('{');
            for (i, (key, item)) in map.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                if is_identifier(key) {
                    out.push_str(key);
                } else {
                    out.push('[');
                    lua_string(key, out);
                    out.push(']');
                }
                out.push_str(" = ");
                lua_value(item, out);
            }
            out.push('}');
        }
    }
}

fn is_identifier(key: &str) -> bool {
    const RESERVED: &[&str] = &[
        "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in", "local", "nil",
        "not", "or", "repeat", "return", "then", "true", "until", "while",
    ];
    let mut chars = key.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !RESERVED.contains(&key)
}

fn lua_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 32 || c as u32 == 127 => {
                let _ = write!(out, "\\{:03}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// `record start` and `record stop [--as lua|commands]`: what this channel did through the API
/// since it started recording, as a script (01 §7).
pub fn record(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let chan = queue.caller.channel;
    match p.arg(0) {
        Some("start") => {
            let next = cx.registry().oplog().next_seq();
            kernel(cx).cmd().recording.insert(chan, next);
            Ok(Flow::Next)
        }
        Some("stop") => {
            let from =
                kernel(cx).cmd().recording.remove(&chan).ok_or_else(|| Error::invalid_params("not recording"))?;
            let lua = p.long("as") == Some("lua");
            let records: Vec<(String, Value)> = cx
                .registry()
                .oplog()
                .since(from)
                .filter(|r| r.channel == chan && r.result.get("error").is_none())
                .map(|r| (r.function.clone(), r.args.clone()))
                .collect();
            for (function, args) in records {
                if lua {
                    let mut line = format!("pumi.api.{function}(");
                    match &args {
                        Value::Array(list) => {
                            for (i, arg) in list.iter().enumerate() {
                                if i > 0 {
                                    line.push_str(", ");
                                }
                                lua_value(arg, &mut line);
                            }
                        }
                        Value::Null => {}
                        other => lua_value(other, &mut line),
                    }
                    line.push(')');
                    queue.print(line);
                } else {
                    queue.print(format!("call {function} {}", pumi_lang::cmd::quote(&args.to_string())));
                }
            }
            Ok(Flow::Next)
        }
        _ => Err(Error::invalid_params("record start, or record stop [--as lua|commands]")),
    }
}

/// `mkview [-t pane] [file]`: a pane's saved state, written to a file or printed (Neovim's
/// `:mkview`).
pub fn mkview(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    let state = call(cx, "pumi_pane_get_state", json!([pane, {"blobs": "inline"}]))?;
    let text = serde_json::to_string_pretty(&state).unwrap_or_default();
    match p.arg(0) {
        Some(file) => {
            let full = path(queue, file);
            std::fs::write(&full, text + "\n").map_err(|err| Error::exception(format!("{}: {err}", full.display())))?;
        }
        None => queue.print(text),
    }
    Ok(Flow::Next)
}

/// `loadview [-n] [-t pane] file`: restores a saved state into the pane, or with `-n` into a new
/// pane beside it (Neovim's `:loadview`).
pub fn loadview(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    let file = path(queue, p.arg(0).unwrap_or(""));
    let text = std::fs::read_to_string(&file).map_err(|err| Error::not_found(format!("{}: {err}", file.display())))?;
    let state: Value =
        serde_json::from_str(&text).map_err(|err| Error::invalid_params(format!("{}: {err}", file.display())))?;
    if p.has('n') {
        let ty = state["type"].clone();
        call(
            cx,
            "pumi_open_pane",
            json!([ty, {"state": state}, {"beside": pane, "split": if p.has('h') { "right" } else { "down" }}]),
        )?;
    } else {
        call(cx, "pumi_pane_set_state", json!([pane, state]))?;
    }
    Ok(Flow::Next)
}

/// `mksession [-f] [file]`: every session as a Lua script that makes them again (Neovim's
/// `:mksession`; `Session.lua` by default). `source-file Session.lua` makes them.
pub fn mksession(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let file = path(queue, p.arg(0).unwrap_or("Session.lua"));
    if file.exists() && !p.has('f') {
        return Err(Error::invalid_params(format!("{} exists (add -f to overwrite)", file.display())));
    }
    let what = kernel(cx).global_option("sessionoptions").as_str().unwrap_or("").to_string();
    let wants = |w: &str| what.split(',').any(|x| x.trim() == w);
    let mut out = String::new();
    let _ = writeln!(
        out,
        "-- Written by pumi's mksession. It makes these sessions again: `pumi source-file {}`.",
        file.display()
    );
    out.push_str("local api = pumi.api\nlocal ids = {}\n");
    out.push_str("local function remap(node)\n  if node[1] == \"leaf\" then return {\"leaf\", ids[node[2]], node[3]} end\n  local children = {}\n  for i, child in ipairs(node[2]) do children[i] = remap(child) end\n  return {node[1], children, node[3]}\nend\n");
    let sessions: Vec<u64> = kernel(cx).sessions.keys().copied().collect();
    for session in sessions {
        let k = kernel(cx);
        let s = k.sessions[&session].clone();
        let _ = writeln!(out, "\ndo -- {}", s.name);
        for (n, (index, tab)) in s.tabs.iter().enumerate() {
            let k = kernel(cx);
            let t = k.tabs[tab].clone();
            let panes = t.layout.panes();
            let floats: Vec<u64> = k
                .panes
                .values()
                .filter(|x| matches!(&x.place, Place::Float { tab: ft, .. } if ft == tab))
                .map(|x| x.id)
                .collect();
            for (i, pane) in panes.iter().enumerate() {
                let ty = kernel(cx).panes[pane].ty.clone();
                let state = call(cx, "pumi_pane_get_state", json!([pane, {"viewoptions": ""}]))?;
                let mut state_lua = String::new();
                lua_value(&json!({"state": state}), &mut state_lua);
                if n == 0 && i == 0 {
                    let mut opts = String::new();
                    lua_value(&json!({"name": s.name, "cwd": s.cwd}), &mut opts);
                    let opts = opts.trim_end_matches('}').to_string();
                    let _ = writeln!(
                        out,
                        "  local session = api.pumi_create_session({opts}, pane = {{type = \"{ty}\", args = {state_lua}}}}})"
                    );
                    let _ = writeln!(out, "  ids[{pane}] = api.pumi_list_panes({{session = session}})[1]");
                    if let Some(name) = &t.name {
                        let mut quoted = String::new();
                        lua_value(&json!(name), &mut quoted);
                        let _ = writeln!(
                            out,
                            "  api.pumi_tab_set_name(api.pumi_pane_get_place(ids[{pane}]).tab, {quoted})"
                        );
                    }
                } else if i == 0 {
                    let mut place = String::new();
                    lua_value(&json!({"kind": "tab", "index": index, "name": t.name, "focus": false}), &mut place);
                    let place = place.trim_end_matches('}').to_string();
                    let _ = writeln!(
                        out,
                        "  ids[{pane}] = api.pumi_open_pane(\"{ty}\", {state_lua}, {place}, session = session}})"
                    );
                } else {
                    let _ = writeln!(
                        out,
                        "  ids[{pane}] = api.pumi_open_pane(\"{ty}\", {state_lua}, {{beside = ids[{}], focus = false}})",
                        panes[0]
                    );
                }
            }
            if panes.len() > 1 {
                let mut layout = String::new();
                lua_value(&t.layout.to_value(), &mut layout);
                let _ = writeln!(
                    out,
                    "  api.pumi_tab_set_layout(api.pumi_pane_get_place(ids[{}]).tab, remap({layout}))",
                    panes[0]
                );
            }
            if wants("floats") {
                for pane in floats {
                    let k = kernel(cx);
                    let (ty, place) = (k.panes[&pane].ty.clone(), k.panes[&pane].place.clone());
                    let Place::Float { float, .. } = place else { continue };
                    let state = call(cx, "pumi_pane_get_state", json!([pane, {"viewoptions": ""}]))?;
                    let mut state_lua = String::new();
                    lua_value(&json!({"state": state}), &mut state_lua);
                    let _ = writeln!(
                        out,
                        "  api.pumi_open_pane(\"{ty}\", {state_lua}, {{kind = \"float\", tab = api.pumi_pane_get_place(ids[{}]).tab, width = {}, height = {}, row = {}, col = {}, focus = false}})",
                        panes[0], float.width, float.height, float.row, float.col
                    );
                }
            }
        }
        out.push_str("end\n");
    }
    if wants("options") {
        let k = kernel(cx);
        let globals = k.local_options(crate::kernel::options::Key::Global);
        let mut lines = String::new();
        for (name, value) in globals {
            if k.options.is_readonly(&name) {
                continue;
            }
            let mut v = String::new();
            lua_value(&value, &mut v);
            let mut n = String::new();
            lua_value(&json!(name), &mut n);
            let _ = writeln!(lines, "api.pumi_set_option_value({n}, {v}, {{scope = \"global\"}})");
        }
        out.push('\n');
        out.push_str(&lines);
    }
    std::fs::write(&file, out).map_err(|err| Error::exception(format!("{}: {err}", file.display())))?;
    kernel(cx).emit("SessionWritePost", &file.display().to_string(), Default::default(), json!({ "file": file }));
    Ok(Flow::Next)
}

/// `context [--here]`: the map of panes agents read: every session, tab and pane, what runs in
/// it and where; `--here` only the caller's tab.
pub fn context(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let caller = queue.caller.clone();
    let k = kernel(cx);
    let here = k.current(&caller);
    for s in k.sessions.values() {
        if p.has_long("here") && here.is_some_and(|h| h.session != s.id) {
            continue;
        }
        queue.print(format!("Session \"{}\" (${}):", s.name, s.id));
        for (index, tab) in &s.tabs {
            if p.has_long("here") && here.is_some_and(|h| h.tab != *tab) {
                continue;
            }
            let fmt = crate::kernel::format::Fmt::new(k, Some(s.id), Some(*tab), None);
            let name = pumi_lang::format::expand(&fmt, "#{window_name}");
            queue.print(format!("  Tab {index}: {name} (@{tab})"));
            let mut panes = k.tabs[tab].layout.panes();
            panes.extend(
                k.panes.values().filter(|x| matches!(&x.place, Place::Float { tab: t, .. } if t == tab)).map(|x| x.id),
            );
            for pane in panes {
                let fmt = crate::kernel::format::Fmt::new(k, Some(s.id), Some(*tab), Some(pane));
                let line = pumi_lang::format::expand(
                    &fmt,
                    "#{pane_id} #{pane_type}#{?pane_current_command, #{pane_current_command},}#{?#{pane_title}, \"#{pane_title}\",}#{?#{url}, #{url},} in #{pane_current_path}#{?pane_active, (active),}",
                );
                let me = if here.is_some_and(|h| h.pane == pane) && caller.pane.is_some() { " ← you" } else { "" };
                queue.print(format!("    - {line}{me}"));
            }
        }
    }
    Ok(Flow::Next)
}

/// Commands only the CLI runs: they stream, or need the terminal they run in.
pub fn cli_only(_: &mut Cx, _: &mut Queue, _: &Parsed) -> Result<Flow> {
    Err(Error::invalid_params("this command runs in the pumi CLI: run it from a shell"))
}
