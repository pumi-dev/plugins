//! Keys: `bind-key`, `unbind-key`, `list-keys`, and Neovim's `map`/`unmap`. A binding is a
//! command line in a key table; the server resolves keys (04 §3).

use serde_json::json;

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::{Arg, Command, Parsed, print, print_list};

use super::{call, kernel};
use crate::cmd::{Flow, Queue};

/// The command line a binding's arguments make: one word is a command line as it is; a block is
/// its commands; several words are one command.
fn command_line(args: &[Arg]) -> Result<String> {
    match args {
        [] => Err(Error::invalid_params("no command")),
        [Arg::Commands(list)] => Ok(print_list(list)),
        [Arg::String(one)] => Ok(one.clone()),
        [first, rest @ ..] => {
            let name = first.as_str().ok_or_else(|| Error::invalid_params("a command cannot start with {"))?;
            Ok(print(&Command { name: name.into(), args: rest.to_vec(), line: 0 }))
        }
    }
}

/// `bind-key [-nr] [-N note] [-T table] key [command [argument…]]`.
pub fn bind_key(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let table = if p.has('n') { "root" } else { p.get('T').unwrap_or("prefix") }.to_string();
    let key = p.arg(0).unwrap_or("").to_string();
    let rest = &p.args[1..];
    if rest.is_empty() {
        let note = p.get('N').ok_or_else(|| Error::invalid_params("no command"))?.to_string();
        let bindings: Vec<crate::cmd::Binding> =
            pumi_api::from_value(call(cx, "pumi_get_keymap", json!([table]))?, "bindings")?;
        let binding = bindings
            .into_iter()
            .find(|b| b.key == pumi_lang::keys::normalise(&key) && b.pane.is_none())
            .ok_or_else(|| Error::not_found(format!("key {key} is not bound")))?;
        let opts = json!({"desc": note, "repeat": binding.repeat});
        call(cx, "pumi_set_keymap", json!([table, binding.key, binding.command, opts]))?;
        return Ok(Flow::Next);
    }
    let command = command_line(rest)?;
    call(cx, "pumi_set_keymap", json!([table, key, command, {"desc": p.get('N'), "repeat": p.has('r')}]))?;
    Ok(Flow::Next)
}

/// `unbind-key [-anq] [-T table] key`.
pub fn unbind_key(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let table = if p.has('n') { "root" } else { p.get('T').unwrap_or("prefix") }.to_string();
    if p.has('a') {
        let bindings: Vec<crate::cmd::Binding> =
            pumi_api::from_value(call(cx, "pumi_get_keymap", json!([table]))?, "bindings")?;
        for binding in bindings {
            call(cx, "pumi_del_keymap", json!([table, binding.key, { "pane": binding.pane }]))?;
        }
        return Ok(Flow::Next);
    }
    let key = p.arg(0).ok_or_else(|| Error::invalid_params("missing key"))?;
    match call(cx, "pumi_del_keymap", json!([table, key, {}])) {
        Err(_) if p.has('q') => Ok(Flow::Next),
        Err(err) if err.kind == pumi_api::ErrorKind::NotFound => Ok(Flow::Next),
        Err(err) => Err(err),
        Ok(_) => Ok(Flow::Next),
    }
}

/// `list-keys [-1aNr] [-F format] [-P prefix] [-T table] [key]`.
pub fn list_keys(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let table = p.get('T').unwrap_or("").to_string();
    let bindings = call(cx, "pumi_get_keymap", json!([table]))?;
    let mut bindings: Vec<crate::cmd::Binding> = pumi_api::from_value(bindings, "bindings")?;
    if let Some(key) = p.arg(0) {
        bindings.retain(|b| b.key == key);
    }
    if p.has('r') {
        bindings.reverse();
    }
    if p.has('1') {
        bindings.truncate(1);
    }
    if p.has_long("json") {
        for binding in bindings {
            queue.print(json!(binding).to_string());
        }
        return Ok(Flow::Next);
    }
    if p.has('N') {
        let prefix = p.get('P').map(str::to_string).unwrap_or_else(|| {
            let key = kernel(cx).global_option("prefix");
            format!("{} ", key.as_str().unwrap_or("C-b"))
        });
        let width = bindings.iter().map(|b| b.key.chars().count()).max().unwrap_or(0);
        for binding in bindings.iter().filter(|b| b.desc.is_some() || p.has('a')) {
            let shown =
                if binding.table == "prefix" { format!("{prefix}{}", binding.key) } else { binding.key.clone() };
            queue.print(format!("{shown:<w$} {}", binding.desc.clone().unwrap_or_default(), w = width + prefix.len()));
        }
        return Ok(Flow::Next);
    }
    let table_width = bindings.iter().map(|b| b.table.chars().count()).max().unwrap_or(0);
    let key_width = bindings.iter().map(|b| pumi_lang::cmd::quote(&b.key).chars().count()).max().unwrap_or(0);
    for binding in bindings {
        let repeat = if binding.repeat { "-r " } else { "   " };
        let key = pumi_lang::cmd::quote(&binding.key);
        queue.print(format!(
            "bind-key {repeat}-T {:<tw$} {key:<kw$} {}",
            binding.table,
            binding.command,
            tw = table_width,
            kw = key_width
        ));
    }
    Ok(Flow::Next)
}

/// `map [-T table] lhs rhs…`: Neovim's `:map`, a binding in `root` unless a table is given;
/// without arguments, lists them.
pub fn map(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let table = p.get('T').unwrap_or("root").to_string();
    if p.args.is_empty() {
        let mut p = p.clone();
        p.flags.push(('T', Some(Arg::String(table))));
        return list_keys(cx, queue, &p);
    }
    let key = p.arg(0).unwrap_or("").to_string();
    let command = command_line(&p.args[1..])?;
    call(cx, "pumi_set_keymap", json!([table, key, command, {}]))?;
    Ok(Flow::Next)
}

pub fn unmap(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let table = p.get('T').unwrap_or("root").to_string();
    call(cx, "pumi_del_keymap", json!([table, p.arg(0).unwrap_or(""), {}]))?;
    Ok(Flow::Next)
}
