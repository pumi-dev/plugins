//! Panes: splitting, floating, closing, focusing, resizing, moving, capturing and typing.

use std::time::Duration;

use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::Parsed;
use pumi_lang::target::Kind;

use super::{Row, call, kernel, list, pane_args, pane_row, print_new, size};
use crate::cmd::Cmd;
use crate::cmd::{Flow, Outcome, Queue, target, target_pane, target_tab};
use crate::kernel::layout::{PaneId, Side};
use crate::kernel::{Kernel, Place};

pub const LIST_PANES: &str = "#{pane_index}: [#{pane_width}x#{pane_height}] [history #{history_size}/#{history_limit}, #{history_bytes} bytes] #{pane_id}#{?pane_active, (active),}#{?pane_dead, (dead),}";
pub const LIST_PANES_TAB: &str = "#{window_index}.#{pane_index}: [#{pane_width}x#{pane_height}] [history #{history_size}/#{history_limit}, #{history_bytes} bytes] #{pane_id}#{?pane_active, (active),}#{?pane_dead, (dead),}";
pub const LIST_PANES_ALL: &str = "#{session_name}:#{window_index}.#{pane_index}: [#{pane_width}x#{pane_height}] [history #{history_size}/#{history_limit}, #{history_bytes} bytes] #{pane_id}#{?pane_active, (active),}#{?pane_dead, (dead),}";
const NEW_PANE: &str = "#{session_name}:#{window_index}.#{pane_index}";

/// Waits for a new pane's program to exit and finishes with its status (`-W`).
fn wait_exit(k: &mut Kernel, queue: &Queue, pane: PaneId) -> Flow {
    crate::cmd::wait_for_event(
        k,
        queue,
        vec!["TermClose".into(), "PaneClosed".into()],
        move |_, event| {
            let about = event
                .about
                .pane
                .or_else(|| event.data.get("pane").and_then(Value::as_u64));
            if about != Some(pane) {
                return None;
            }
            let status = event
                .data
                .get("status")
                .and_then(Value::as_i64)
                .map(|s| s as i32);
            Some(Outcome {
                status: Some(status.unwrap_or(0)),
                ..Outcome::default()
            })
        },
    );
    Flow::Wait
}

/// `split-pane [-bdfhIPvWZ] [-c dir] [-e VAR=x] [-F format] [-l size] [-p percent] [-T title]
/// [-t target] [--type TYPE] [command…]` (tmux's `split-window`).
pub fn split_pane(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let beside = target_pane(cx, p.get('t'))?;
    let side = match (p.has('h'), p.has('b')) {
        (true, false) => "right",
        (true, true) => "left",
        (false, false) => "down",
        (false, true) => "up",
    };
    let ty = p.long("type").unwrap_or("terminal").to_string();
    let mut args = pane_args(queue, p, &ty)?;
    if ty == "terminal"
        && p.get('c').is_none()
        && let Some(map) = args.as_object_mut()
    {
        // tmux starts a split where the pane it splits is.
        let cwd = kernel(cx).pane_option(beside, "pane_current_path");
        if cwd.as_str().is_some_and(|c| !c.is_empty()) {
            map.insert("cwd".into(), cwd);
        }
    }
    let size = p
        .get('l')
        .map(size)
        .or_else(|| p.get('p').map(|pc| json!(format!("{pc}%"))));
    let place = json!({ "beside": beside, "split": side, "size": size, "full": p.has('f'), "focus": !p.has('d') });
    let pane = call(cx, "pumi_open_pane", json!([ty, args, place]))?
        .as_u64()
        .unwrap_or(0);
    if let Some(title) = p.get('T') {
        call(
            cx,
            "pumi_set_option_value",
            json!(["title", title, {"pane": pane}]),
        )?;
    }
    if p.has('Z') {
        call(cx, "pumi_pane_set_zoom", json!([pane, true]))?;
    }
    let row = pane_row(kernel(cx), pane);
    print_new(cx, queue, p, NEW_PANE, row);
    if p.has('W') {
        return Ok(wait_exit(kernel(cx), queue, pane));
    }
    Ok(Flow::Next)
}

/// A float's size or position: cells, or a share of the tab (`50%`).
fn float_value(text: Option<&str>) -> Option<Value> {
    text.map(size)
}

/// `new-pane [-AbCdDhIkKLOPvWZ] [-x w] [-y h] [-X x] [-Y y] … [command…]`: tmux 3.8's floating
/// pane; `-L` splits instead.
pub fn new_pane(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    if p.has('L') {
        return split_pane(cx, queue, p);
    }
    let anchor = target_pane(cx, p.get('t'))?;
    let tab = kernel(cx)
        .tab_of_pane(anchor)
        .ok_or_else(|| Error::invalid_params("the target pane is in no tab"))?;
    let ty = p.long("type").unwrap_or("terminal").to_string();
    let args = pane_args(queue, p, &ty)?;
    let place = json!({
        "kind": "float",
        "tab": tab,
        "width": float_value(p.get('x')).unwrap_or(json!("50%")),
        "height": float_value(p.get('y')).unwrap_or(json!("25%")),
        "col": p.get('X').and_then(|x| x.parse::<i64>().ok()),
        "row": p.get('Y').and_then(|y| y.parse::<i64>().ok()),
        "focus": !p.has('d'),
    });
    let pane = call(cx, "pumi_open_pane", json!([ty, args, place]))?
        .as_u64()
        .unwrap_or(0);
    if let Some(title) = p.get('T') {
        call(
            cx,
            "pumi_set_option_value",
            json!(["title", title, {"pane": pane}]),
        )?;
    }
    let row = pane_row(kernel(cx), pane);
    print_new(cx, queue, p, NEW_PANE, row);
    if p.has('W') {
        return Ok(wait_exit(kernel(cx), queue, pane));
    }
    Ok(Flow::Next)
}

/// `display-popup [-BCEk] [-b border] [-d dir] [-e VAR=x] [-h height] [-w width] [-x x] [-y y]
/// [-T title] [-t target] [command…]`: tmux's older popup, a floating pane. Without `-E` the
/// popup stays when its program exits.
pub fn display_popup(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let anchor = target_pane(cx, p.get('t'))?;
    let tab = kernel(cx)
        .tab_of_pane(anchor)
        .ok_or_else(|| Error::invalid_params("the target pane is in no tab"))?;
    if p.has('C') {
        let floats: Vec<u64> = kernel(cx)
            .panes
            .values()
            .filter(|pane| matches!(&pane.place, Place::Float { tab: t, .. } if *t == tab))
            .map(|pane| pane.id)
            .collect();
        for pane in floats {
            call(cx, "pumi_pane_close", json!([pane, true]))?;
        }
        return Ok(Flow::Next);
    }
    let ty = p.long("type").unwrap_or("terminal").to_string();
    let mut args = pane_args(queue, p, &ty)?;
    if let (Some(dir), Some(map)) = (p.get('d'), args.as_object_mut()) {
        map.insert(
            "cwd".into(),
            json!(crate::cmd::path(queue, dir).display().to_string()),
        );
    }
    let place = json!({
        "kind": "float",
        "tab": tab,
        "width": float_value(p.get('w')).unwrap_or(json!("50%")),
        "height": float_value(p.get('h')).unwrap_or(json!("50%")),
        "col": p.get('x').and_then(|x| x.parse::<i64>().ok()),
        "row": p.get('y').and_then(|y| y.parse::<i64>().ok()),
        "border": if p.has('B') { Some("none") } else { p.get('b') },
    });
    let pane = call(cx, "pumi_open_pane", json!([ty, args, place]))?
        .as_u64()
        .unwrap_or(0);
    if !p.has('E') && ty == "terminal" {
        call(
            cx,
            "pumi_set_option_value",
            json!(["remain_on_exit", true, {"pane": pane}]),
        )?;
    }
    if let Some(title) = p.get('T') {
        call(
            cx,
            "pumi_set_option_value",
            json!(["title", title, {"pane": pane}]),
        )?;
    }
    Ok(Flow::Next)
}

/// `kill-pane [-a] [-t target]`: `-a` kills every other pane of its tab.
pub fn kill_pane(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    let doomed: Vec<u64> = if p.has('a') {
        let tab = kernel(cx).tab_of_pane(pane);
        kernel(cx)
            .panes
            .values()
            .filter(|x| x.place.tab() == tab && x.id != pane)
            .map(|x| x.id)
            .collect()
    } else {
        vec![pane]
    };
    for pane in doomed {
        call(cx, "pumi_pane_close", json!([pane, true]))?;
    }
    Ok(Flow::Next)
}

/// The pane beside `pane` on `side`, the one used last of several (tmux's `{left-of}`).
fn neighbour(k: &Kernel, pane: PaneId, side: Side) -> Option<PaneId> {
    let tab = k.tab_of_pane(pane)?;
    let rects = k.tabs.get(&tab)?.layout.rects(k.tab_area(tab));
    let (_, me) = *rects.iter().find(|(p, _)| *p == pane)?;
    let overlap = |a0: u32, a1: u32, b0: u32, b1: u32| a0 < b1 && b0 < a1;
    rects
        .iter()
        .filter(|(p, r)| {
            *p != pane
                && match side {
                    Side::Left => {
                        r.x + r.width + 1 == me.x
                            && overlap(r.y, r.y + r.height, me.y, me.y + me.height)
                    }
                    Side::Right => {
                        me.x + me.width + 1 == r.x
                            && overlap(r.y, r.y + r.height, me.y, me.y + me.height)
                    }
                    Side::Up => {
                        r.y + r.height + 1 == me.y
                            && overlap(r.x, r.x + r.width, me.x, me.x + me.width)
                    }
                    Side::Down => {
                        me.y + me.height + 1 == r.y
                            && overlap(r.x, r.x + r.width, me.x, me.x + me.width)
                    }
                }
        })
        .max_by_key(|(p, _)| k.panes.get(p).map_or(0, |p| p.activity))
        .map(|(p, _)| *p)
}

fn side_flag(p: &Parsed) -> Option<Side> {
    if p.has('L') {
        Some(Side::Left)
    } else if p.has('R') {
        Some(Side::Right)
    } else if p.has('U') {
        Some(Side::Up)
    } else if p.has('D') {
        Some(Side::Down)
    } else {
        None
    }
}

/// `select-pane [-DdeLlMmRUZ] [-T title] [-t target]`.
pub fn select_pane(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut pane = target_pane(cx, p.get('t'))?;
    if p.has('m') || p.has('M') {
        let k = kernel(cx);
        k.cmd().marked = if p.has('M') || k.cmd().marked == Some(pane) {
            None
        } else {
            Some(pane)
        };
        return Ok(Flow::Next);
    }
    if let Some(title) = p.get('T') {
        call(
            cx,
            "pumi_set_option_value",
            json!(["title", title, {"pane": pane}]),
        )?;
        return Ok(Flow::Next);
    }
    if p.has('d') || p.has('e') {
        call(
            cx,
            "pumi_set_option_value",
            json!(["@input_off", p.has('d'), {"pane": pane}]),
        )?;
        return Ok(Flow::Next);
    }
    if p.has('l') {
        let tab = kernel(cx)
            .tab_of_pane(pane)
            .ok_or_else(|| Error::not_found("no tab"))?;
        pane = kernel(cx).tabs[&tab]
            .last
            .ok_or_else(|| Error::not_found("no last pane"))?;
    } else if let Some(side) = side_flag(p) {
        match neighbour(kernel(cx), pane, side) {
            Some(next) => pane = next,
            None => return Ok(Flow::Next),
        }
    }
    let zoomed = kernel(cx)
        .tab_of_pane(pane)
        .and_then(|t| kernel(cx).tabs.get(&t))
        .is_some_and(|t| t.zoomed);
    call(cx, "pumi_set_current_pane", json!([pane]))?;
    if zoomed && p.has('Z') {
        call(cx, "pumi_pane_set_zoom", json!([pane, true]))?;
    } else if zoomed {
        call(cx, "pumi_pane_set_zoom", json!([pane, false]))?;
    }
    Ok(Flow::Next)
}

/// `last-pane [-deZ] [-t target]`.
pub fn last_pane(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let tab = target_tab(cx, p.get('t'))?;
    let last = kernel(cx).tabs[&tab]
        .last
        .ok_or_else(|| Error::not_found("no last pane"))?;
    call(cx, "pumi_set_current_pane", json!([last]))?;
    Ok(Flow::Next)
}

/// `resize-pane [-DLMRTUZ] [-x width] [-y height] [-t target] [adjustment]`.
pub fn resize_pane(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    if p.has('Z') {
        let tab = kernel(cx)
            .tab_of_pane(pane)
            .ok_or_else(|| Error::not_found("no tab"))?;
        let zoomed = kernel(cx).tabs[&tab].zoomed;
        call(cx, "pumi_pane_set_zoom", json!([pane, !zoomed]))?;
        return Ok(Flow::Next);
    }
    if p.has('M') || p.has('T') {
        return Ok(Flow::Next);
    }
    let tab = kernel(cx)
        .tab_of_pane(pane)
        .ok_or_else(|| Error::not_found("the pane is in no tab"))?;
    let k = kernel(cx);
    let area = k.tab_area(tab);
    let mut layout = k.tabs[&tab].layout.clone();
    let cells = |text: &str, total: u32| -> Result<u32> {
        match text.strip_suffix('%') {
            Some(pc) => pc
                .parse::<u32>()
                .map(|pc| total * pc / 100)
                .map_err(|_| Error::invalid_params(format!("bad size: {text}"))),
            None => text
                .parse()
                .map_err(|_| Error::invalid_params(format!("bad size: {text}"))),
        }
    };
    if let Some(width) = p.get('x') {
        layout.set_size(pane, true, cells(width, area.width)?, area);
    }
    if let Some(height) = p.get('y') {
        layout.set_size(pane, false, cells(height, area.height)?, area);
    }
    if let Some(side) = side_flag(p) {
        let by: i64 = p
            .arg(0)
            .map(|a| {
                a.parse()
                    .map_err(|_| Error::invalid_params(format!("adjustment {a} is invalid")))
            })
            .transpose()?
            .unwrap_or(1);
        // tmux's -L grows the pane leftwards: the border on that side moves.
        layout.resize(pane, side, by, area);
    }
    super::tab::set_layout(cx, tab, layout)
}

/// `swap-pane [-dDUZ] [-s src] [-t dst]`: `-D`/`-U` swap with the next or previous pane.
pub fn swap_pane(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let destination = target_pane(cx, p.get('t'))?;
    let source = if p.has('D') || p.has('U') {
        let tab = kernel(cx)
            .tab_of_pane(destination)
            .ok_or_else(|| Error::not_found("no tab"))?;
        let panes = kernel(cx).tabs[&tab].layout.panes();
        let at = panes.iter().position(|x| *x == destination).unwrap_or(0) as i64;
        let by = if p.has('D') { 1 } else { -1 };
        panes[((at + by).rem_euclid(panes.len() as i64)) as usize]
    } else {
        match p.get('s') {
            Some(s) => target_pane(cx, Some(s))?,
            None => {
                let caller = cx.caller().clone();
                let k = kernel(cx);
                k.cmd()
                    .marked
                    .filter(|m| k.panes.contains_key(m))
                    .or_else(|| k.current(&caller).map(|c| c.pane))
                    .ok_or_else(|| Error::not_found("no source pane"))?
            }
        }
    };
    if source == destination {
        return Ok(Flow::Next);
    }
    call(
        cx,
        "pumi_pane_set_place",
        json!([source, { "swap": destination }]),
    )?;
    if !p.has('d') {
        call(cx, "pumi_set_current_pane", json!([source]))?;
    }
    Ok(Flow::Next)
}

/// `move-pane [-bdfhv] [-l size] [-s src] [-t dst] [-S server]` and `join-pane`: the pane goes
/// beside the target; `-S` moves it to another server (14 §3).
pub fn move_pane(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let source = match p.get('s') {
        Some(s) => target_pane(cx, Some(s))?,
        None => {
            let caller = cx.caller().clone();
            let k = kernel(cx);
            k.cmd()
                .marked
                .filter(|m| k.panes.contains_key(m))
                .or_else(|| k.current(&caller).map(|c| c.pane))
                .ok_or_else(|| Error::not_found("no source pane"))?
        }
    };
    if let Some(server) = p.get('S') {
        let mut place = json!({ "server": server });
        if let Some(t) = p.get('t') {
            place["kind"] = json!("session");
            place["name"] = json!(t);
        }
        call(cx, "pumi_pane_set_place", json!([source, place]))?;
        let _ = queue;
        return Ok(Flow::Next);
    }
    let destination = target_pane(cx, p.get('t'))?;
    if source == destination {
        return Err(Error::invalid_params(
            "source and target panes must be different",
        ));
    }
    let side = match (p.has('h'), p.has('b')) {
        (true, false) => "right",
        (true, true) => "left",
        (false, false) => "down",
        (false, true) => "up",
    };
    let size = p
        .get('l')
        .map(size)
        .or_else(|| p.get('p').map(|pc| json!(format!("{pc}%"))));
    let place = json!({ "beside": destination, "split": side, "size": size, "full": p.has('f'), "focus": !p.has('d') });
    call(cx, "pumi_pane_set_place", json!([source, place]))?;
    Ok(Flow::Next)
}

/// `break-pane [-abdP] [-F format] [-n name] [-s src] [-t dst]`: the pane goes into a tab of its
/// own.
pub fn break_pane(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let source = target_pane(cx, p.get('s'))?;
    let caller = cx.caller().clone();
    let found = crate::kernel::format::resolve_index(kernel(cx), &caller, p.get('t'))?;
    let index = if p.get('t').is_some_and(|t| t.contains(':')) {
        found.index
    } else {
        None
    };
    let place = json!({ "kind": "tab", "session": found.session, "index": index, "name": p.get('n'), "focus": !p.has('d') });
    call(cx, "pumi_pane_set_place", json!([source, place]))?;
    let row = pane_row(kernel(cx), source);
    print_new(
        cx,
        queue,
        p,
        "#{session_name}:#{window_index}.#{pane_index}",
        row,
    );
    Ok(Flow::Next)
}

/// `respawn-pane [-k] [-c dir] [-e VAR=x] [-t target] [command…]`.
pub fn respawn_pane(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    if !p.has('k') && kernel(cx).pane_option(pane, "pane_dead") != json!(true) {
        return Err(Error::invalid_params(format!("pane %{pane} still active")));
    }
    let args = pane_args(queue, p, "terminal")?;
    call(cx, "pumi_pane_call", json!([pane, "respawn", args]))?;
    Ok(Flow::Next)
}

/// `list-panes [-asr] [-F format] [-f filter] [-t target] [--json]`.
pub fn list_panes(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let k = kernel(cx);
    let (rows, default): (Vec<Row>, &str) = if p.has('a') {
        let mut rows = Vec::new();
        for s in k.sessions.values() {
            for (_, t) in &s.tabs {
                for pane in k.tabs[t].layout.panes() {
                    rows.push(Row {
                        session: Some(s.id),
                        tab: Some(*t),
                        pane: Some(pane),
                    });
                }
            }
        }
        (rows, LIST_PANES_ALL)
    } else if p.has('s') {
        let found = target(cx, p.get('t'), Kind::Session)?;
        let k = kernel(cx);
        let s = &k.sessions[&found.session];
        let rows = s
            .tabs
            .iter()
            .flat_map(|(_, t)| {
                k.tabs[t].layout.panes().into_iter().map(|pane| Row {
                    session: Some(s.id),
                    tab: Some(*t),
                    pane: Some(pane),
                })
            })
            .collect();
        (rows, LIST_PANES_TAB)
    } else {
        let found = target(cx, p.get('t'), Kind::Tab)?;
        let tab = found.tab.ok_or_else(|| Error::not_found("no tab"))?;
        let k = kernel(cx);
        let mut panes = k.tabs[&tab].layout.panes();
        panes.extend(
            k.panes
                .values()
                .filter(|x| matches!(&x.place, Place::Float { tab: t, .. } if *t == tab))
                .map(|x| x.id),
        );
        let rows = panes
            .into_iter()
            .map(|pane| Row {
                session: Some(found.session),
                tab: Some(tab),
                pane: Some(pane),
            })
            .collect();
        (rows, LIST_PANES)
    };
    list(cx, queue, p, rows, default, |k, row| {
        let pane = row.pane.unwrap_or(0);
        let mut value = k.pane_value(pane);
        value["session"] = json!(row.session);
        value["tab"] = json!(row.tab);
        value
    })
}

/// `capture-pane [-aCeJNpPqT] [-b buffer] [-S start] [-E end] [-t target] [--format text|ansi]`:
/// what a pane shows, of any type, printed (`-p`) or into a buffer.
pub fn capture_pane(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    let ansi = p.has('e') || p.long("format") == Some("ansi");
    if let Some(format) = p.long("format")
        && !["text", "ansi"].contains(&format)
    {
        return Err(Error::invalid_params(format!(
            "capture format is text or ansi, not {format}"
        )));
    }
    let height = kernel(cx)
        .pane_option(pane, "pane_height")
        .as_i64()
        .unwrap_or(24);
    let start = p.get('S');
    let mut opts = json!({ "ansi": ansi });
    match start {
        Some("-") => {
            opts["lines"] = json!(
                kernel(cx)
                    .pane_option(pane, "history_limit")
                    .as_u64()
                    .unwrap_or(2000)
                    + height as u64
            );
        }
        Some(n) => {
            let n: i64 = n
                .parse()
                .map_err(|_| Error::invalid_params(format!("start line {n} is invalid")))?;
            if n < 0 {
                opts["lines"] = json!(height - n);
            } else {
                opts["source"] = json!("visible");
            }
        }
        None => opts["source"] = json!("visible"),
    }
    if p.has('J') && opts.get("lines").is_some() {
        opts["source"] = json!("unwrapped");
    }
    let text = call(cx, "pumi_pane_call", json!([pane, "read", opts]))?;
    let mut text = text
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| text.to_string());
    if let Some(end) = p.get('E').and_then(|e| e.parse::<usize>().ok()) {
        let lines: Vec<&str> = text.lines().collect();
        let skip = start.and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
        text = lines
            .iter()
            .skip(skip)
            .take(end.saturating_sub(skip) + 1)
            .copied()
            .collect::<Vec<_>>()
            .join("\n");
    } else if let Some(skip) = start.and_then(|s| s.parse::<usize>().ok()) {
        text = text.lines().skip(skip).collect::<Vec<_>>().join("\n");
    }
    if !p.has('N') {
        text = text
            .lines()
            .map(str::trim_end)
            .collect::<Vec<_>>()
            .join("\n");
    }
    if p.has('p') {
        queue.output.push_str(&text);
        if !text.ends_with('\n') {
            queue.output.push('\n');
        }
    } else {
        call(cx, "pumi_set_buffer", json!([p.get('b'), text, {}]))?;
    }
    Ok(Flow::Next)
}

/// tmux's key names that pumi's key parser spells differently.
fn tmux_key(name: &str) -> String {
    let (mods, key) = match name.rfind('-') {
        Some(at)
            if at > 0
                && at + 1 < name.len()
                && name[..at].split('-').all(|m| ["C", "M", "S"].contains(&m)) =>
        {
            (&name[..=at], &name[at + 1..])
        }
        _ => ("", name),
    };
    let key = match key {
        "BSpace" => "Backspace",
        "BTab" => return format!("{mods}S-Tab"),
        "DC" => "Delete",
        "IC" => "Insert",
        "NPage" | "PageDown" | "PgDn" => "PageDown",
        "PPage" | "PageUp" | "PgUp" => "PageUp",
        "Escape" => "Escape",
        other => other,
    };
    format!("{mods}{key}")
}

/// Whether a `send-keys` argument is a key name rather than text: pumi-keys's names (its
/// parser is libghostty's, not this guest's), modifiers joined with `-` or `+`.
fn is_key(word: &str) -> bool {
    const MODIFIERS: &[&str] = &[
        "ctrl", "control", "c", "alt", "meta", "option", "opt", "m", "shift", "s", "super", "cmd",
        "command", "win",
    ];
    const NAMED: &[&str] = &[
        "enter",
        "return",
        "cr",
        "tab",
        "backtab",
        "btab",
        "esc",
        "escape",
        "backspace",
        "bs",
        "bspace",
        "up",
        "down",
        "left",
        "right",
        "home",
        "end",
        "pageup",
        "page_up",
        "pgup",
        "ppage",
        "pagedown",
        "page_down",
        "pgdn",
        "npage",
        "insert",
        "ins",
        "ic",
        "delete",
        "del",
        "dc",
        "space",
        "minus",
        "plus",
        "equal",
        "equals",
        "comma",
        "period",
        "dot",
        "slash",
        "backslash",
        "quote",
        "apostrophe",
        "doublequote",
        "semicolon",
        "colon",
        "percent",
        "ampersand",
        "backtick",
        "grave",
        "tilde",
        "lbracket",
        "rbracket",
        "pipe",
        "lt",
        "gt",
    ];
    if word.chars().count() <= 1 {
        return false;
    }
    let token = tmux_key(word);
    let mut rest = token.as_str();
    loop {
        let cut = rest
            .char_indices()
            .skip(1)
            .find(|(_, c)| *c == '+' || *c == '-')
            .map(|(i, _)| i);
        let Some(cut) = cut else { break };
        if !MODIFIERS.contains(&rest[..cut].to_ascii_lowercase().as_str()) {
            break;
        }
        rest = &rest[cut + 1..];
        if rest.is_empty() {
            return false;
        }
    }
    let lower = rest.to_ascii_lowercase();
    let function = lower
        .strip_prefix('f')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=12).contains(&n));
    rest.chars().count() == 1 || function || NAMED.contains(&lower.as_str())
}

/// `send-keys [-FHlMRX] [-N repeat] [-t target] key…`: each argument is a key name (`C-c`,
/// `Enter`) or text; `-l` sends every one as text, `-H` as hexadecimal bytes.
pub fn send_keys(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    if p.has('X') {
        return Err(Error::invalid_params("copy-mode commands need a client"));
    }
    if p.has('R') {
        call(
            cx,
            "pumi_pane_call",
            json!([pane, "input", {"text": "\x1bc"}]),
        )?;
    }
    let repeat = p
        .get('N')
        .map(|n| {
            n.parse::<usize>()
                .map_err(|_| Error::invalid_params(format!("repeat count {n} is invalid")))
        })
        .transpose()?
        .unwrap_or(1);
    let words: Vec<String> = if p.has('F') {
        let k = kernel(cx);
        p.words()
            .iter()
            .map(|w| crate::cmd::expand(k, queue, None, None, Some(pane), w))
            .collect()
    } else {
        p.words()
    };
    let mut inputs: Vec<Value> = Vec::new();
    for word in &words {
        if p.has('H') {
            let byte = u8::from_str_radix(word.trim_start_matches("0x"), 16)
                .map_err(|_| Error::invalid_params(format!("invalid hex: {word}")))?;
            inputs.push(json!({"bytes": [byte]}));
        } else if !p.has('l') && is_key(word) {
            inputs.push(json!({"keys": [tmux_key(word)]}));
        } else {
            inputs.push(json!({"text": word}));
        }
    }
    for _ in 0..repeat {
        for input in &inputs {
            call(cx, "pumi_pane_call", json!([pane, "input", input]))?;
        }
    }
    Ok(Flow::Next)
}

/// `send-prefix [-2] [-t target]`: the session's prefix key, to the pane.
pub fn send_prefix(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    let option = if p.has('2') { "prefix2" } else { "prefix" };
    let key = kernel(cx).pane_option(pane, option);
    let key = key
        .as_str()
        .filter(|k| *k != "None")
        .unwrap_or("C-b")
        .to_string();
    call(
        cx,
        "pumi_pane_call",
        json!([pane, "input", {"keys": [tmux_key(&key)]}]),
    )?;
    Ok(Flow::Next)
}

/// `clear-history [-H] [-t target]`.
pub fn clear_history(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    call(cx, "pumi_pane_call", json!([pane, "clear_history", {}]))?;
    Ok(Flow::Next)
}

/// `pipe-pane [-IOo] [-t target] [command]`: not yet; it says so.
pub fn pipe_pane(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    target_pane(cx, p.get('t'))?;
    if p.words().is_empty() {
        return Ok(Flow::Next);
    }
    Err(Error::invalid_params("pipe-pane is not available yet"))
}

/// `increase-font-size [-a] [-t pane] [N]` and friends: the pane option `font_size`.
fn font(cx: &mut Cx, p: &Parsed, change: impl Fn(f64) -> Option<f64>) -> Result<Flow> {
    let panes: Vec<u64> = if p.has('a') {
        kernel(cx).panes.keys().copied().collect()
    } else {
        vec![target_pane(cx, p.get('t'))?]
    };
    for pane in panes {
        let now = kernel(cx)
            .pane_option(pane, "font_size")
            .as_f64()
            .unwrap_or(13.0);
        let value = change(now).map(|v| json!(v.clamp(4.0, 96.0)));
        call(
            cx,
            "pumi_set_option_value",
            json!(["font_size", value, {"pane": pane}]),
        )?;
    }
    Ok(Flow::Next)
}

fn step(p: &Parsed) -> Result<f64> {
    p.arg(0)
        .map(|n| {
            n.parse::<f64>()
                .map_err(|_| Error::invalid_params(format!("not a size: {n}")))
        })
        .transpose()
        .map(|n| n.unwrap_or(1.0))
}

pub fn increase_font_size(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let by = step(p)?;
    font(cx, p, |now| Some(now + by))
}

pub fn decrease_font_size(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let by = step(p)?;
    font(cx, p, |now| Some(now - by))
}

pub fn reset_font_size(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    font(cx, p, |_| None)
}

/// Parses `10m`, `30s`, `2h`, `500ms` or seconds.
pub fn duration(text: &str) -> Result<Duration> {
    let bad = || Error::invalid_params(format!("not a duration: {text}"));
    let (number, unit) = text
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .map_or((text, ""), |at| text.split_at(at));
    let n: f64 = number.parse().map_err(|_| bad())?;
    let seconds = match unit {
        "" | "s" => n,
        "ms" => n / 1000.0,
        "m" => n * 60.0,
        "h" => n * 3600.0,
        _ => return Err(bad()),
    };
    Ok(Duration::from_secs_f64(seconds))
}

/// `wait-pane [-t pane] [--until FORMAT] [--for DURATION]`: waits for the pane's program to exit
/// (and exits with its status), or for a format about it to become true.
pub fn wait_pane(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    let k = kernel(cx);
    if let Some(after) = p.long("for") {
        crate::cmd::deadline(
            k,
            queue,
            duration(after)?,
            format!("timed out waiting for %{pane}"),
        );
    }
    if let Some(until) = p.long("until") {
        let until = until.to_string();
        if crate::cmd::truthy(&crate::cmd::expand(
            k,
            queue,
            None,
            None,
            Some(pane),
            &until,
        )) {
            return Ok(Flow::Next);
        }
        let vars = queue.vars.clone();
        let events: Vec<String> = crate::kernel::events::EVENTS
            .iter()
            .map(|e| e.to_string())
            .collect();
        crate::cmd::wait_for_event(k, queue, events, move |cx, event| {
            let k = kernel(cx);
            if event.event == "PaneClosed"
                && event.data.get("pane").and_then(Value::as_u64) == Some(pane)
            {
                return Some(Outcome {
                    error: Some(Error::not_found(format!("pane %{pane} closed"))),
                    ..Outcome::default()
                });
            }
            if !k.panes.contains_key(&pane) {
                return None;
            }
            let mut fmt = crate::kernel::format::Fmt::new(k, None, None, Some(pane));
            fmt.extra = Some(&vars);
            crate::cmd::truthy(&pumi_lang::format::expand(&fmt, &until)).then(Outcome::default)
        });
        return Ok(Flow::Wait);
    }
    if k.pane_option(pane, "pane_dead") == json!(true) {
        queue.status = k
            .pane_option(pane, "pane_dead_status")
            .as_i64()
            .map(|s| s as i32)
            .or(Some(0));
        return Ok(Flow::Next);
    }
    Ok(wait_exit(k, queue, pane))
}
