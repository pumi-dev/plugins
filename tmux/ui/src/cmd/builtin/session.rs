//! Sessions: `new-session`, `kill-session`, `rename-session`, `has-session`, `list-sessions`.

use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::Parsed;

use super::{Row, call, kernel, list, pane_args, print_new};
use crate::cmd::{Flow, Queue, target_session};

pub const LIST_SESSIONS: &str = "#{session_name}: #{session_windows} windows (created #{t:session_created})#{?session_grouped, (group ,}#{session_group}#{?session_grouped,),}#{?session_attached, (attached),}";

/// `new-session [-AdDEPX] [-c dir] [-e VAR=x] [-F format] [-n tab-name] [-s name] [-x w] [-y h]
/// [--type TYPE] [command…]`. Without `-d`, a client that asked switches to it.
pub fn new_session(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    if p.get('t').is_some() {
        return Err(Error::invalid_params("session groups (-t) are not supported"));
    }
    let name = p.get('s').map(str::to_string);
    if let Some(name) = &name
        && let Some(existing) = kernel(cx).sessions.values().find(|s| &s.name == name).map(|s| s.id)
    {
        if p.has('A') {
            if !p.has('d') {
                call(cx, "pumi_set_current_session", json!([existing]))?;
            }
            return Ok(Flow::Next);
        }
        return Err(Error::invalid_params(format!("duplicate session: {name}")));
    }
    let ty = p.long("type").unwrap_or("terminal").to_string();
    let mut args = pane_args(queue, p, &ty)?;
    let cwd = p
        .get('c')
        .map(|c| crate::cmd::path(queue, c).display().to_string())
        .or_else(|| queue.cwd.as_ref().map(|c| c.display().to_string()));
    if ty == "terminal"
        && let (Some(cwd), Some(map)) = (&cwd, args.as_object_mut())
    {
        map.entry("cwd").or_insert(json!(cwd));
    }
    let opts = json!({ "name": name, "cwd": cwd, "pane": { "type": ty, "args": args } });
    let session = call(cx, "pumi_create_session", json!([opts]))?.as_u64().unwrap_or(0);
    let k = kernel(cx);
    let tab = k.sessions.get(&session).and_then(|s| s.current);
    if let (Some(tab), Some(tab_name)) = (tab, p.get('n')) {
        call(cx, "pumi_tab_set_name", json!([tab, tab_name]))?;
    }
    if !p.has('d') && kernel(cx).chans.get(&queue.caller.channel).is_some_and(|c| c.ui.is_some()) {
        call(cx, "pumi_set_current_session", json!([session]))?;
    }
    let pane = tab.and_then(|t| kernel(cx).tabs.get(&t).map(|t| t.active));
    print_new(cx, queue, p, "#{session_name}:", Row { session: Some(session), tab, pane });
    Ok(Flow::Next)
}

/// `kill-session [-aC] [-t session]`: `-a` kills every other session.
pub fn kill_session(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = target_session(cx, p.get('t'))?;
    if p.has('C') {
        return Ok(Flow::Next);
    }
    let doomed: Vec<u64> = if p.has('a') {
        kernel(cx).sessions.keys().copied().filter(|s| *s != session).collect()
    } else {
        vec![session]
    };
    for s in doomed {
        call(cx, "pumi_session_close", json!([s, true]))?;
    }
    Ok(Flow::Next)
}

/// `rename-session [-t session] name`.
pub fn rename_session(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = target_session(cx, p.get('t'))?;
    call(cx, "pumi_session_set_name", json!([session, p.arg(0).unwrap_or("")]))?;
    Ok(Flow::Next)
}

/// `has-session [-t session]`: fails when there is none.
pub fn has_session(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    target_session(cx, p.get('t'))?;
    Ok(Flow::Next)
}

/// `list-sessions [-r] [-F format] [-f filter] [--json]`.
pub fn list_sessions(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let rows = kernel(cx).sessions.keys().map(|s| Row { session: Some(*s), tab: None, pane: None }).collect();
    list(cx, queue, p, rows, LIST_SESSIONS, |k, row| {
        let id = row.session.unwrap_or(0);
        let mut value = k.session_value(id);
        value["attached"] = json!(k.chans.values().filter(|c| c.ui.as_ref().is_some_and(|u| u.session == id)).count());
        value["created"] = json!(k.sessions[&id].created);
        value
    })
}

pub fn session_json(k: &crate::kernel::Kernel, id: u64) -> Value {
    k.session_value(id)
}
