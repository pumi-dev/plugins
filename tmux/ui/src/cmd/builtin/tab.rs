//! Tabs (tmux's windows): `new-tab`, `kill-tab`, `rename-tab`, `select-tab` and its
//! neighbours, `move-tab`, `link-tab`, `unlink-tab`, `swap-tab`, `list-tabs`, layouts,
//! `rotate-tab`, `find-tab`, `respawn-tab`.

use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::Parsed;
use pumi_lang::target::Kind;

use super::{Row, call, kernel, list, pane_args, print_new};
use crate::cmd::Cmd;
use crate::cmd::{Flow, Queue, target, target_session, target_tab};
use crate::kernel::layout::{self, Layout, Size};
use crate::kernel::{Kernel, SessionId};

pub const LIST_TABS: &str = "#{window_index}: #{window_name}#{window_raw_flags} (#{window_panes} panes) [#{window_width}x#{window_height}] [layout #{window_layout}] #{window_id}#{?window_active, (active),}";
pub const LIST_ALL_TABS: &str = "#{session_name}:#{window_index}: #{window_name}#{window_raw_flags} (#{window_panes} panes) [#{window_width}x#{window_height}] ";

/// Moves a session's tabs at `from` and above up by one, so `from` is free (`new-tab -a`).
fn shift_up(cx: &mut Cx, session: SessionId, from: u32) -> Result<()> {
    let Some(s) = kernel(cx).sessions.get(&session) else { return Ok(()) };
    if !s.tabs.iter().any(|(i, _)| *i == from) {
        return Ok(());
    }
    let mut moving: Vec<(u32, u64)> = s.tabs.iter().filter(|(i, _)| *i >= from).copied().collect();
    moving.sort_by_key(|(i, _)| std::cmp::Reverse(*i));
    for (index, tab) in moving {
        call(cx, "pumi_tab_set_place", json!([tab, { "session": session, "index": index + 1 }]))?;
    }
    Ok(())
}

/// `new-tab [-abdkPS] [-c dir] [-e VAR=x] [-F format] [-n name] [-t target] [--type TYPE]
/// [command…]` (tmux's `new-window`).
pub fn new_tab(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let caller = cx.caller().clone();
    let found = crate::kernel::format::resolve_index(kernel(cx), &caller, p.get('t'))?;
    let session = found.session;
    let k = kernel(cx);
    if p.has('S')
        && let Some(name) = p.get('n')
    {
        let fmt = crate::kernel::format::Fmt::new(k, Some(session), None, None);
        let _ = fmt;
        let existing = <Kernel as pumi_lang::target::Tree>::tabs(k, session).into_iter().find(|t| t.name == name);
        if let Some(existing) = existing {
            call(cx, "pumi_set_current_tab", json!([existing.id]))?;
            return Ok(Flow::Next);
        }
    }
    let k = kernel(cx);
    let current_index = k.sessions[&session]
        .current
        .and_then(|c| k.sessions[&session].tabs.iter().find(|(_, t)| *t == c).map(|(i, _)| *i));
    let mut index = match (found.tab, found.index) {
        (None, Some(index)) => Some(index),
        (Some(tab), _) if p.has('a') || p.has('b') => {
            k.sessions[&session].tabs.iter().find(|(_, t)| *t == tab).map(|(i, _)| *i)
        }
        (Some(tab), _) if p.get('t').is_some() && !p.has('k') => {
            let i = k.sessions[&session].tabs.iter().find(|(_, t)| *t == tab).map(|(i, _)| *i);
            if p.get('t').is_some_and(|t| t.contains(':')) {
                return Err(Error::invalid_params(format!("index {} in use", i.unwrap_or(0))));
            }
            None
        }
        (Some(tab), _) if p.has('k') => {
            let i = k.sessions[&session].tabs.iter().find(|(_, t)| *t == tab).map(|(i, _)| *i);
            call(cx, "pumi_tab_close", json!([tab, true]))?;
            i
        }
        _ if p.has('a') => current_index,
        _ => None,
    };
    if p.has('a') {
        index = index.map(|i| i + 1);
        if let Some(i) = index {
            shift_up(cx, session, i)?;
        }
    } else if p.has('b')
        && let Some(i) = index
    {
        shift_up(cx, session, i)?;
    }
    let ty = p.long("type").unwrap_or("terminal").to_string();
    let args = pane_args(queue, p, &ty)?;
    let place = json!({
        "kind": "tab",
        "session": session,
        "index": index,
        "name": p.get('n'),
        "focus": !p.has('d'),
    });
    let pane = call(cx, "pumi_open_pane", json!([ty, args, place]))?.as_u64().unwrap_or(0);
    let row = super::pane_row(kernel(cx), pane);
    print_new(cx, queue, p, "#{session_name}:#{window_index}.#{pane_index}", row);
    Ok(Flow::Next)
}

/// `kill-tab [-a] [-t target]`: `-a` kills every other tab of its session.
pub fn kill_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let found = target(cx, p.get('t'), Kind::Tab)?;
    let tab = found.tab.ok_or_else(|| Error::not_found("no tab"))?;
    let doomed: Vec<u64> = if p.has('a') {
        kernel(cx).sessions[&found.session].tabs.iter().map(|(_, t)| *t).filter(|t| *t != tab).collect()
    } else {
        vec![tab]
    };
    for t in doomed {
        call(cx, "pumi_tab_close", json!([t, true]))?;
    }
    Ok(Flow::Next)
}

/// `rename-tab [-t target] name` (tmux's `rename-window`).
pub fn rename_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let tab = target_tab(cx, p.get('t'))?;
    call(cx, "pumi_tab_set_name", json!([tab, p.arg(0)]))?;
    Ok(Flow::Next)
}

/// The tab `offset` places from the session's current one, wrapping.
fn neighbour(k: &Kernel, session: SessionId, offset: i64) -> Option<u64> {
    let s = k.sessions.get(&session)?;
    let at = s.tabs.iter().position(|(_, t)| Some(*t) == s.current)? as i64;
    let n = s.tabs.len() as i64;
    Some(s.tabs[((at + offset).rem_euclid(n)) as usize].1)
}

/// `select-tab [-lnpT] [-t target]` (tmux's `select-window`).
pub fn select_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let found = target(cx, p.get('t'), Kind::Tab)?;
    let k = kernel(cx);
    let tab = if p.has('l') {
        k.sessions[&found.session].last.ok_or_else(|| Error::not_found("no last window"))?
    } else if p.has('n') {
        neighbour(k, found.session, 1).ok_or_else(|| Error::not_found("no next window"))?
    } else if p.has('p') {
        neighbour(k, found.session, -1).ok_or_else(|| Error::not_found("no previous window"))?
    } else {
        let tab = found.tab.ok_or_else(|| Error::not_found("no tab"))?;
        if p.has('T') && k.sessions[&found.session].current == Some(tab) {
            k.sessions[&found.session].last.unwrap_or(tab)
        } else {
            tab
        }
    };
    call(cx, "pumi_set_current_tab", json!([tab]))?;
    Ok(Flow::Next)
}

pub fn next_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = target_session(cx, p.get('t'))?;
    let tab = neighbour(kernel(cx), session, 1).ok_or_else(|| Error::not_found("no next window"))?;
    call(cx, "pumi_set_current_tab", json!([tab]))?;
    Ok(Flow::Next)
}

pub fn previous_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = target_session(cx, p.get('t'))?;
    let tab = neighbour(kernel(cx), session, -1).ok_or_else(|| Error::not_found("no previous window"))?;
    call(cx, "pumi_set_current_tab", json!([tab]))?;
    Ok(Flow::Next)
}

pub fn last_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = target_session(cx, p.get('t'))?;
    let tab = kernel(cx).sessions[&session].last.ok_or_else(|| Error::not_found("no last window"))?;
    call(cx, "pumi_set_current_tab", json!([tab]))?;
    Ok(Flow::Next)
}

/// `move-tab [-abdkr] [-s src] [-t dst]` (tmux's `move-window`); `-r` renumbers the session.
pub fn move_tab(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    if p.has('r') {
        let session = target_session(cx, p.get('t'))?;
        let k = kernel(cx);
        let base = k
            .options
            .get("base_index", &[crate::kernel::options::Key::Session(session), crate::kernel::options::Key::Global]);
        let base = base.and_then(|(v, _)| v.as_u64()).unwrap_or(0) as u32;
        let tabs: Vec<(u32, u64)> = k.sessions.get(&session).map(|s| s.tabs.clone()).unwrap_or_default();
        for (n, (index, tab)) in tabs.into_iter().enumerate() {
            if index != base + n as u32 {
                call(cx, "pumi_tab_set_place", json!([tab, { "session": session, "index": base + n as u32 }]))?;
            }
        }
        return Ok(Flow::Next);
    }
    place_tab(cx, queue, p, false)
}

pub fn link_tab(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    place_tab(cx, queue, p, true)
}

fn place_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed, link: bool) -> Result<Flow> {
    let tab = target_tab(cx, p.get('s'))?;
    let caller = cx.caller().clone();
    let found = crate::kernel::format::resolve_index(kernel(cx), &caller, p.get('t'))?;
    let k = kernel(cx);
    let mut index = found.index.or_else(|| {
        found.tab.and_then(|t| k.sessions[&found.session].tabs.iter().find(|(_, x)| *x == t).map(|(i, _)| *i))
    });
    if p.get('t').is_none_or(|t| !t.contains(':')) && found.tab.is_some() && !p.has('a') && !p.has('b') {
        index = None;
    }
    if p.has('a') {
        index = index.map(|i| i + 1);
        if let Some(i) = index {
            shift_up(cx, found.session, i)?;
        }
    } else if p.has('b')
        && let Some(i) = index
    {
        shift_up(cx, found.session, i)?;
    }
    call(
        cx,
        "pumi_tab_set_place",
        json!([tab, { "session": found.session, "index": index, "link": link, "kill": p.has('k') }]),
    )?;
    if !p.has('d') && !link {
        call(cx, "pumi_set_current_tab", json!([tab]))?;
    }
    Ok(Flow::Next)
}

/// `unlink-tab [-k] [-t target]` (tmux's `unlink-window`).
pub fn unlink_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let found = target(cx, p.get('t'), Kind::Tab)?;
    let tab = found.tab.ok_or_else(|| Error::not_found("no tab"))?;
    let k = kernel(cx);
    let linked = k.sessions.values().filter(|s| s.tabs.iter().any(|(_, t)| *t == tab)).count();
    if linked < 2 && !p.has('k') {
        return Err(Error::invalid_params("window only linked to one session"));
    }
    call(cx, "pumi_tab_set_place", json!([tab, { "unlink": found.session }]))?;
    Ok(Flow::Next)
}

/// `swap-tab [-d] [-s src] [-t dst]` (tmux's `swap-window`).
pub fn swap_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let source = target_tab(cx, p.get('s'))?;
    let destination = target_tab(cx, p.get('t'))?;
    call(cx, "pumi_tab_set_place", json!([source, { "swap": destination }]))?;
    if !p.has('d') {
        call(cx, "pumi_set_current_tab", json!([source]))?;
    }
    Ok(Flow::Next)
}

/// `list-tabs [-ar] [-F format] [-f filter] [-t session] [--json]` (tmux's `list-windows`).
pub fn list_tabs(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let k = kernel(cx);
    let sessions: Vec<u64> = if p.has('a') {
        k.sessions.keys().copied().collect()
    } else {
        let caller = cx.caller().clone();
        vec![crate::kernel::format::resolve(kernel(cx), &caller, p.get('t'), Kind::Session)?.session]
    };
    let k = kernel(cx);
    let rows: Vec<Row> = sessions
        .iter()
        .flat_map(|s| k.sessions[s].tabs.iter().map(|(_, t)| Row { session: Some(*s), tab: Some(*t), pane: None }))
        .collect();
    let default = if p.has('a') { LIST_ALL_TABS } else { LIST_TABS };
    list(cx, queue, p, rows, default, |k, row| {
        let tab = row.tab.unwrap_or(0);
        let mut value = k.tab_value(tab);
        value["session"] = json!(row.session);
        value["index"] =
            json!(row.session.and_then(|s| k.sessions[&s].tabs.iter().find(|(_, t)| *t == tab).map(|(i, _)| *i)));
        value
    })
}

/// `select-layout [-Enop] [-t target] [layout]`: a preset (`even-horizontal`, `tiled`, …), a
/// tmux layout string, or pumi's layout as JSON.
pub fn select_layout(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let tab = target_tab(cx, p.get('t'))?;
    if p.has('n') {
        return step_layout(cx, tab, 1);
    }
    if p.has('p') {
        return step_layout(cx, tab, -1);
    }
    let k = kernel(cx);
    let t = &k.tabs[&tab];
    let area = k.tab_area(tab);
    let panes = t.layout.panes();
    let layout = if p.has('o') {
        k.cmd().last_layout.get(&tab).cloned().ok_or_else(|| Error::not_found("no last layout"))?
    } else if p.has('E') {
        let mut layout = t.layout.clone();
        even_out(&mut layout.root);
        layout
    } else {
        match p.arg(0) {
            None => {
                let at = k.cmd().preset.get(&tab).copied().unwrap_or(0);
                layout::preset(layout::PRESETS[at], &panes, main_size(k, tab), area)?
            }
            Some(text) if text.starts_with('[') => Layout::from_value(
                &serde_json::from_str::<Value>(text).map_err(|err| Error::invalid_params(format!("layout: {err}")))?,
            )?,
            Some(text) => match layout::PRESETS.iter().position(|n| n.starts_with(text)) {
                Some(at) => {
                    k.cmd().preset.insert(tab, at);
                    layout::preset(layout::PRESETS[at], &panes, main_size(k, tab), area)?
                }
                None => Layout::from_tmux(text, &panes)?,
            },
        }
    };
    set_layout(cx, tab, layout)
}

fn even_out(node: &mut layout::Node) {
    if let layout::Node::Split { children, .. } = node {
        let n = children.len() as f64;
        for child in children {
            child.size = 1.0 / n;
            even_out(&mut child.node);
        }
    }
}

fn main_size(k: &Kernel, tab: u64) -> Option<Size> {
    let chain = k.chain(None, Some(tab), None);
    let width = k.options.get("main_pane_width", &chain).map(|(v, _)| v);
    width.and_then(|v| Size::parse(&v).ok())
}

fn step_layout(cx: &mut Cx, tab: u64, by: i64) -> Result<Flow> {
    let k = kernel(cx);
    let n = layout::PRESETS.len() as i64;
    let at = k.cmd().preset.get(&tab).map_or(if by > 0 { -1 } else { 0 }, |a| *a as i64);
    let next = (at + by).rem_euclid(n) as usize;
    k.cmd().preset.insert(tab, next);
    let panes = k.tabs[&tab].layout.panes();
    let layout = layout::preset(layout::PRESETS[next], &panes, main_size(k, tab), k.tab_area(tab))?;
    set_layout(cx, tab, layout)
}

pub(crate) fn set_layout(cx: &mut Cx, tab: u64, layout: Layout) -> Result<Flow> {
    let k = kernel(cx);
    let old = k.tabs[&tab].layout.clone();
    k.cmd().last_layout.insert(tab, old);
    call(cx, "pumi_tab_set_layout", json!([tab, layout.to_value()]))?;
    Ok(Flow::Next)
}

pub fn next_layout(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let tab = target_tab(cx, p.get('t'))?;
    step_layout(cx, tab, 1)
}

pub fn previous_layout(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let tab = target_tab(cx, p.get('t'))?;
    step_layout(cx, tab, -1)
}

/// `rotate-tab [-DUZ] [-t target]` (tmux's `rotate-window`).
pub fn rotate_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let tab = target_tab(cx, p.get('t'))?;
    let mut layout = kernel(cx).tabs[&tab].layout.clone();
    layout.rotate(p.has('D'));
    set_layout(cx, tab, layout)
}

/// `find-tab [-CiNrTZ] [-t target] match` (tmux's `find-window`): selects the first tab whose
/// name (`-N`), title (`-T`) or content (`-C`) matches.
pub fn find_tab(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = target_session(cx, p.get('t'))?;
    let pattern = p.arg(0).unwrap_or("").to_string();
    let all = !p.has('C') && !p.has('N') && !p.has('T');
    let fold = |s: &str| if p.has('i') { s.to_lowercase() } else { s.to_string() };
    let wanted = fold(&pattern);
    let matches = |text: &str| {
        if p.has('r') {
            regex::Regex::new(&pattern).is_ok_and(|re| re.is_match(text))
        } else {
            fold(text).contains(&wanted)
        }
    };
    let k = kernel(cx);
    let tabs: Vec<(u64, String)> =
        <Kernel as pumi_lang::target::Tree>::tabs(k, session).into_iter().map(|t| (t.id, t.name)).collect();
    for (tab, name) in tabs {
        let panes = kernel(cx).tabs[&tab].layout.panes();
        let mut hit = (all || p.has('N')) && matches(&name);
        for pane in panes {
            if hit {
                break;
            }
            if (all || p.has('T')) && matches(&crate::kernel::format::text(&kernel(cx).pane_option(pane, "title"))) {
                hit = true;
            }
            if !hit && (all || p.has('C')) {
                let text = call(cx, "pumi_pane_call", json!([pane, "read", {}])).unwrap_or(Value::Null);
                hit = text.as_str().is_some_and(&matches);
            }
        }
        if hit {
            call(cx, "pumi_set_current_tab", json!([tab]))?;
            return Ok(Flow::Next);
        }
    }
    Err(Error::not_found(format!("no windows matching: {pattern}")))
}

/// `respawn-tab [-k] [-c dir] [-e VAR=x] [-t target] [command…]` (tmux's `respawn-window`):
/// the tab keeps one pane, run again.
pub fn respawn_tab(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let tab = target_tab(cx, p.get('t'))?;
    let panes = kernel(cx).tabs[&tab].layout.panes();
    let Some((first, rest)) = panes.split_first() else { return Ok(Flow::Next) };
    if !p.has('k') && kernel(cx).pane_option(*first, "pane_dead") != json!(true) {
        return Err(Error::invalid_params(format!("window @{tab} still active")));
    }
    for pane in rest {
        call(cx, "pumi_pane_close", json!([pane, true]))?;
    }
    let args = pane_args(queue, p, "terminal")?;
    call(cx, "pumi_pane_call", json!([first, "respawn", args]))?;
    Ok(Flow::Next)
}
