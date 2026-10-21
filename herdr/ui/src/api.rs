//! herdr's methods over pumi: each reads the core's state, calls the core's functions, and
//! answers in herdr's shapes (`{"type": …, …}`). Methods for herdr's TUI, plugins and remotes
//! answer `unsupported` at once, from [`methods::METHODS`].

use crate::proto::methods::{self, Support};
use crate::proto::types::{AgentStatus, ReadFormat, ReadSource, SplitDirection};
use crate::proto::{HERDR_PROTOCOL, HERDR_VERSION, codes, result};
use crate::view::View;
use pumi_plugin::api as sdk;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

/// herdr's error: a code and a message.
#[derive(Debug, Clone, PartialEq)]
pub struct Fail {
    pub code: &'static str,
    pub message: String,
}

pub type Result<T = Value> = std::result::Result<T, Fail>;

fn fail(code: &'static str, message: impl Into<String>) -> Fail {
    Fail {
        code,
        message: message.into(),
    }
}

impl From<sdk::Error> for Fail {
    fn from(err: sdk::Error) -> Fail {
        let code = match err.kind.as_str() {
            "not_found" => codes::NOT_FOUND,
            "invalid_params" => codes::INVALID_PARAMS,
            "timeout" => codes::TIMEOUT,
            _ => codes::INTERNAL,
        };
        fail(code, err.message)
    }
}

/// What a handler has to work with: nothing of its own. The core is reached by name, through
/// the app's channel; what outlives a request is [`crate::state`].
#[derive(Clone, Copy)]
pub struct Herdr;

/// A request's params.
struct P<'a>(&'a Value);

impl P<'_> {
    fn opt_str(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(Value::as_str)
    }

    fn str(&self, key: &str) -> Result<&str> {
        self.opt_str(key)
            .ok_or_else(|| fail(codes::INVALID_PARAMS, format!("missing `{key}`")))
    }

    fn bool(&self, key: &str, default: bool) -> bool {
        self.0.get(key).and_then(Value::as_bool).unwrap_or(default)
    }

    fn strings(&self, key: &str) -> Vec<String> {
        self.0
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    }

    fn opt_de<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        match self.0.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => serde_json::from_value(v.clone())
                .map(Some)
                .map_err(|err| fail(codes::INVALID_PARAMS, format!("`{key}`: {err}"))),
        }
    }
}

impl Herdr {
    fn call(&self, name: &str, args: Value) -> Result {
        Ok(sdk::call(name, args)?)
    }

    pub fn view(&self) -> Result<View> {
        let state = self.call("pumi_get_state", json!([]))?;
        Ok(View::from_state(&state["state"]))
    }

    /// What a pane has shown since herdr started watching: herdr's own counter, since no
    /// screen is kept here (23 §6).
    pub fn revision(&self, pane: u64) -> u64 {
        crate::state::revision(pane)
    }

    fn workspace(&self, view: &View, p: &P) -> Result<u64> {
        let id = p.str("workspace_id")?;
        view.session(id).ok_or_else(|| {
            fail(
                codes::WORKSPACE_NOT_FOUND,
                format!("workspace not found: {id}"),
            )
        })
    }

    fn tab(&self, view: &View, p: &P) -> Result<u64> {
        let id = p.str("tab_id")?;
        view.tab(id)
            .ok_or_else(|| fail(codes::TAB_NOT_FOUND, format!("tab not found: {id}")))
    }

    fn pane(&self, view: &View, id: &str) -> Result<u64> {
        view.pane(id)
            .ok_or_else(|| fail(codes::PANE_NOT_FOUND, format!("pane not found: {id}")))
    }

    fn pane_info(&self, pane: u64) -> Result {
        let view = self.view()?;
        let info = view
            .pane_info(pane, self.revision(pane))
            .ok_or_else(|| fail(codes::PANE_NOT_FOUND, "the pane is not in a tab"))?;
        Ok(json!(info))
    }

    /// The text of a pane, from the core's own terminal (`pumi_pane_call`'s `read`): the last
    /// `lines` rows it keeps. The core keeps text, not a screen, so nothing is truncated and
    /// there is no unwrapped or visible variant.
    pub fn read(&self, pane: u64, lines: Option<u32>) -> (String, bool) {
        let lines = lines.unwrap_or(80);
        let text = self.call("pumi_pane_call", json!([pane, "read", { "lines": lines }]));
        (
            text.ok()
                .and_then(|t| t.as_str().map(str::to_string))
                .unwrap_or_default(),
            false,
        )
    }

    /// Keys by name, encoded for the modes the pane's program set (the host does that).
    fn keys(&self, pane: u64, keys: &[String]) -> Result<()> {
        if keys.is_empty() {
            return Ok(());
        }
        self.call("pumi_pane_call", json!([pane, "input", { "keys": keys }]))?;
        Ok(())
    }

    fn write(&self, pane: u64, text: &str) -> Result<()> {
        self.call("pumi_pane_call", json!([pane, "input", { "text": text }]))?;
        Ok(())
    }

    fn launch(p: &P) -> Value {
        let mut args = serde_json::Map::new();
        if let Some(cwd) = p.opt_str("cwd") {
            args.insert("cwd".into(), json!(cwd));
        }
        if let Some(env) = p.0.get("env").filter(|e| e.is_object()) {
            args.insert("env".into(), env.clone());
        }
        if let Some(command) = p.0.get("command").filter(|c| !c.is_null()) {
            args.insert("command".into(), command.clone());
        }
        Value::Object(args)
    }
}

/// Runs one request.
pub fn dispatch(h: &Herdr, method: &str, params: &Value) -> Result {
    let Some(spec) = methods::find(method) else {
        return Err(fail(
            codes::UNKNOWN_METHOD,
            format!("unknown method: {method}"),
        ));
    };
    if let Support::Unsupported(why) = spec.support {
        return Err(fail(
            codes::UNSUPPORTED,
            format!("{method} is not supported by pumi: {why}"),
        ));
    }
    let p = P(params);
    match method {
        "ping" => Ok(result(
            "pong",
            json!({
                "version": HERDR_VERSION,
                "protocol": HERDR_PROTOCOL,
                "capabilities": { "live_handoff": true, "detached_server_daemon": true, "surface_interest": false, "health_check": true, "ssh_agent_registration": false },
            }),
        )),
        "server.stop" => {
            h.call("pumi_kill_server", json!([]))?;
            Ok(result("ok", json!({})))
        }
        "pumi.server.restart" => {
            h.call("pumi_restart", json!([]))?;
            Ok(result("restarting", json!({})))
        }
        "notification.show" => {
            let title = p.str("title")?;
            let text = match p.opt_str("body") {
                Some(body) => format!("{title}: {body}"),
                None => title.to_string(),
            };
            let shown = h.call("pumi_notify", json!([text, "info"])).is_ok();
            Ok(result(
                "notification_show",
                json!({ "shown": shown, "reason": if shown { "shown" } else { "no_foreground_client" } }),
            ))
        }
        "session.snapshot" => {
            let view = h.view()?;
            Ok(result(
                "session_snapshot",
                json!({ "snapshot": view.snapshot(|p| h.revision(p)) }),
            ))
        }

        "workspace.list" => {
            let view = h.view()?;
            let list: Vec<_> = view
                .sessions
                .iter()
                .filter_map(|s| view.workspace_info(s.id))
                .collect();
            Ok(result("workspace_list", json!({ "workspaces": list })))
        }
        "workspace.get" | "workspace.focus" | "workspace.rename" => {
            let view = h.view()?;
            let ws = h.workspace(&view, &p)?;
            match method {
                "workspace.focus" => {
                    h.call("pumi_set_current_session", json!([ws]))?;
                }
                "workspace.rename" => {
                    h.call("pumi_session_set_name", json!([ws, p.str("label")?.trim()]))?;
                }
                _ => {}
            }
            let view = h.view()?;
            Ok(result(
                "workspace_info",
                json!({ "workspace": view.workspace_info(ws) }),
            ))
        }
        "workspace.create" => {
            let mut place = json!({ "kind": "session", "focus": p.bool("focus", true) });
            if let Some(label) = p.opt_str("label") {
                place["name"] = json!(label);
            }
            let pane = h
                .call(
                    "pumi_open_pane",
                    json!(["terminal", Herdr::launch(&p), place]),
                )?
                .as_u64()
                .unwrap_or(0);
            let view = h.view()?;
            let tab = view.panes.get(&pane).and_then(|p| p.tab).unwrap_or(0);
            let ws = view.session_of_tab(tab).map(|s| s.id).unwrap_or(0);
            Ok(result(
                "workspace_created",
                json!({ "workspace": view.workspace_info(ws), "tab": view.tab_info(tab), "root_pane": view.pane_info(pane, 0) }),
            ))
        }
        "workspace.close" => {
            let view = h.view()?;
            let ws = h.workspace(&view, &p)?;
            h.call("pumi_session_close", json!([ws, true]))?;
            Ok(result("ok", json!({})))
        }

        "tab.list" => {
            let view = h.view()?;
            let only = match p.opt_str("workspace_id") {
                Some(_) => Some(h.workspace(&view, &p)?),
                None => None,
            };
            let tabs: Vec<_> = view
                .sessions
                .iter()
                .filter(|s| only.is_none_or(|o| o == s.id))
                .flat_map(|s| s.tabs.iter().filter_map(|(_, t)| view.tab_info(*t)))
                .collect();
            Ok(result("tab_list", json!({ "tabs": tabs })))
        }
        "tab.get" | "tab.focus" | "tab.rename" => {
            let view = h.view()?;
            let tab = h.tab(&view, &p)?;
            match method {
                "tab.focus" => {
                    h.call("pumi_set_current_tab", json!([tab]))?;
                }
                "tab.rename" => {
                    let label = p.str("label")?.trim();
                    h.call(
                        "pumi_tab_set_name",
                        json!([tab, (!label.is_empty()).then_some(label)]),
                    )?;
                }
                _ => {}
            }
            let view = h.view()?;
            Ok(result("tab_info", json!({ "tab": view.tab_info(tab) })))
        }
        "tab.create" => {
            let view = h.view()?;
            let mut place = json!({ "kind": "tab", "focus": p.bool("focus", true) });
            if p.opt_str("workspace_id").is_some() {
                place["session"] = json!(h.workspace(&view, &p)?);
            }
            if let Some(label) = p.opt_str("label") {
                place["name"] = json!(label);
            }
            let pane = h
                .call(
                    "pumi_open_pane",
                    json!(["terminal", Herdr::launch(&p), place]),
                )?
                .as_u64()
                .unwrap_or(0);
            let view = h.view()?;
            let tab = view.panes.get(&pane).and_then(|p| p.tab).unwrap_or(0);
            Ok(result(
                "tab_created",
                json!({ "tab": view.tab_info(tab), "root_pane": view.pane_info(pane, 0) }),
            ))
        }
        "tab.close" => {
            let view = h.view()?;
            let tab = h.tab(&view, &p)?;
            h.call("pumi_tab_close", json!([tab, true]))?;
            Ok(result("ok", json!({})))
        }

        "pane.list" => {
            let view = h.view()?;
            let only = match p.opt_str("workspace_id") {
                Some(_) => Some(h.workspace(&view, &p)?),
                None => None,
            };
            let panes: Vec<_> = view
                .tiled()
                .into_iter()
                .filter_map(|pane| view.pane_info(pane, h.revision(pane)))
                .filter(|info| only.is_none_or(|ws| view.session(&info.workspace_id) == Some(ws)))
                .collect();
            Ok(result("pane_list", json!({ "panes": panes })))
        }
        "pane.current" => {
            let view = h.view()?;
            let pane = match p.opt_str("caller_pane_id").and_then(|id| view.pane(id)) {
                Some(pane) => pane,
                None => view
                    .current
                    .map(|c| c.2)
                    .ok_or_else(|| fail(codes::PANE_NOT_FOUND, "no current pane"))?,
            };
            Ok(result(
                "pane_current",
                json!({ "pane": h.pane_info(pane)? }),
            ))
        }
        "pane.get" | "pane.focus" | "pane.rename" | "pane.zoom" | "pane.clear" => {
            let view = h.view()?;
            let pane = h.pane(&view, p.str("pane_id")?)?;
            match method {
                "pane.focus" => {
                    h.call("pumi_set_current_pane", json!([pane]))?;
                }
                "pane.rename" => {
                    let label = p.opt_str("label").map(str::trim).filter(|l| !l.is_empty());
                    h.call(
                        "pumi_set_option_value",
                        json!(["@label", label, { "pane": pane }]),
                    )?;
                }
                "pane.zoom" => {
                    let zoomed = view.panes[&pane]
                        .tab
                        .and_then(|t| view.tabs.get(&t))
                        .is_some_and(|t| t.zoomed);
                    let want =
                        p.0.get("zoomed")
                            .and_then(Value::as_bool)
                            .unwrap_or(!zoomed);
                    h.call("pumi_pane_set_zoom", json!([pane, want]))?;
                    return Ok(result(
                        "pane_zoom",
                        json!({ "pane_id": view.pane_id(pane), "zoomed": want }),
                    ));
                }
                "pane.clear" => {
                    h.call("pumi_pane_call", json!([pane, "clear_history"]))?;
                    return Ok(result("ok", json!({})));
                }
                _ => {}
            }
            Ok(result("pane_info", json!({ "pane": h.pane_info(pane)? })))
        }
        "pane.split" => {
            let view = h.view()?;
            let target = match (p.opt_str("target_pane_id"), p.opt_str("workspace_id")) {
                (Some(id), _) => h.pane(&view, id)?,
                (None, Some(_)) => {
                    let ws = h.workspace(&view, &p)?;
                    let s = view
                        .sessions
                        .iter()
                        .find(|s| s.id == ws)
                        .and_then(|s| s.current);
                    s.and_then(|t| view.tabs.get(&t))
                        .map(|t| t.active)
                        .ok_or_else(|| fail(codes::PANE_NOT_FOUND, "no pane"))?
                }
                (None, None) => view
                    .current
                    .map(|c| c.2)
                    .ok_or_else(|| fail(codes::PANE_NOT_FOUND, "no current pane"))?,
            };
            let direction: SplitDirection = p.opt_de("direction")?.unwrap_or(SplitDirection::Right);
            let split = match direction {
                SplitDirection::Right => "right",
                SplitDirection::Down => "down",
            };
            let mut place =
                json!({ "beside": target, "split": split, "focus": p.bool("focus", false) });
            if let Some(ratio) = p.0.get("ratio").and_then(Value::as_f64) {
                place["size"] = json!(format!("{}%", ((1.0 - ratio) * 100.0).round()));
            }
            let mut args = Herdr::launch(&p);
            if args.get("cwd").is_none()
                && let Some(cwd) = view
                    .panes
                    .get(&target)
                    .and_then(|t| t.options.get("pane_current_path"))
                    .cloned()
            {
                args["cwd"] = cwd;
            }
            let pane = h
                .call("pumi_open_pane", json!(["terminal", args, place]))?
                .as_u64()
                .unwrap_or(0);
            Ok(result("pane_info", json!({ "pane": h.pane_info(pane)? })))
        }
        "pane.process_info" => {
            let view = h.view()?;
            let pane = match p.opt_str("pane_id") {
                Some(id) => h.pane(&view, id)?,
                None => view
                    .current
                    .map(|c| c.2)
                    .ok_or_else(|| fail(codes::PANE_NOT_FOUND, "no current pane"))?,
            };
            let options = &view.panes[&pane].options;
            let info = crate::proto::types::PaneProcessInfo {
                pane_id: view.pane_id(pane),
                shell_pid: options
                    .get("pane_pid")
                    .and_then(Value::as_u64)
                    .map(|p| p as u32),
                tty: options
                    .get("pane_tty")
                    .and_then(Value::as_str)
                    .filter(|t| !t.is_empty())
                    .map(str::to_string),
            };
            Ok(result("pane_process_info", json!({ "process_info": info })))
        }
        "pane.close" => {
            let view = h.view()?;
            let pane = h.pane(&view, p.str("pane_id")?)?;
            h.call("pumi_pane_close", json!([pane, true]))?;
            Ok(result("ok", json!({})))
        }
        "pane.read" | "agent.read" => {
            let view = h.view()?;
            let id = if method == "pane.read" {
                p.str("pane_id")?
            } else {
                p.str("target")?
            };
            let pane = h.pane(&view, id)?;
            let source: ReadSource = p.opt_de("source")?.unwrap_or_default();
            let format: ReadFormat = p.opt_de("format")?.unwrap_or_default();
            let lines = p.0.get("lines").and_then(Value::as_u64).map(|l| l as u32);
            let (mut text, truncated) = h.read(pane, lines);
            if format == ReadFormat::Ansi && p.bool("strip_ansi", true) {
                text = keep_sgr(&text);
            }
            let info = view.pane_info(pane, h.revision(pane));
            Ok(result(
                "pane_read",
                json!({ "read": {
                    "pane_id": view.pane_id(pane),
                    "workspace_id": info.as_ref().map(|i| i.workspace_id.clone()),
                    "tab_id": info.as_ref().map(|i| i.tab_id.clone()),
                    "source": source, "format": format, "text": text,
                    "revision": h.revision(pane), "truncated": truncated,
                } }),
            ))
        }
        "pane.send_text" | "pane.send_keys" | "pane.send_input" | "agent.send_keys" => {
            let view = h.view()?;
            let id = if method == "agent.send_keys" {
                p.str("target")?
            } else {
                p.str("pane_id")?
            };
            let pane = h.pane(&view, id)?;
            if let Some(text) = p
                .opt_str("text")
                .filter(|_| method != "pane.send_keys" && method != "agent.send_keys")
            {
                h.write(pane, text)?;
            }
            if method != "pane.send_text" {
                h.keys(pane, &p.strings("keys"))?;
            }
            Ok(result("ok", json!({})))
        }

        "agent.list" => {
            let view = h.view()?;
            let agents: Vec<_> = view
                .tiled()
                .into_iter()
                .filter_map(|pane| view.agent_info(pane))
                .collect();
            Ok(result("agent_list", json!({ "agents": agents })))
        }
        "agent.get" | "agent.focus" => {
            let view = h.view()?;
            let pane = h.pane(&view, p.str("target")?)?;
            if method == "agent.focus" {
                h.call("pumi_set_current_pane", json!([pane]))?;
            }
            let agent = view
                .agent_info(pane)
                .ok_or_else(|| fail(codes::AGENT_NOT_FOUND, "no agent in that pane"))?;
            Ok(result("agent_info", json!({ "agent": agent })))
        }
        "pane.report_agent" => {
            let view = h.view()?;
            let pane = h.pane(&view, p.str("pane_id")?)?;
            if let Some(agent) = p.opt_str("agent") {
                h.call(
                    "pumi_set_option_value",
                    json!(["@agent", agent, { "pane": pane }]),
                )?;
            }
            // The state is the pane's program status, which the host keeps (OSC 7501): said
            // as the program would, so it lives and goes as the program's own reports do.
            if let Some(state) = p.opt_str("state") {
                let report = match AgentStatus::parse(state) {
                    Some(AgentStatus::Unknown) => "state=clear".to_string(),
                    Some(known) => match p.opt_str("agent").filter(|a| is_app(a)) {
                        Some(app) => format!("state={}:app={app}", known.as_str()),
                        None => format!("state={}", known.as_str()),
                    },
                    None => return Err(fail(codes::INVALID_PARAMS, format!("no agent state `{state}`"))),
                };
                h.call("pumi_pane_report", json!([pane, report]))?;
            }
            Ok(result("ok", json!({})))
        }
        _ => Err(fail(
            codes::UNSUPPORTED,
            format!("{method} is not implemented by pumi yet"),
        )),
    }
}

/// An OSC 7501 `app`: what a report may name its program.
fn is_app(name: &str) -> bool {
    (1..=32).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.+-".contains(&b))
}

/// The length in bytes of the escape sequence at the start of `seq`.
fn escape_len(seq: &str) -> usize {
    let mut chars = seq.char_indices().skip(1);
    match chars.next() {
        Some((_, '[')) => chars
            .find(|(_, c)| ('@'..='~').contains(c))
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(seq.len()),
        Some((_, ']' | 'P' | '_' | '^')) => {
            let mut prev_esc = false;
            for (i, c) in chars {
                if c == '\x07' || (prev_esc && c == '\\') {
                    return i + 1;
                }
                prev_esc = c == '\x1b';
            }
            seq.len()
        }
        Some((i, c)) => i + c.len_utf8(),
        None => seq.len(),
    }
}

/// Keeps colours (SGR), drops every other escape.
pub fn keep_sgr(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('\x1b') {
        out.push_str(&rest[..start]);
        let seq = &rest[start..];
        let len = escape_len(seq);
        let piece = &seq[..len];
        if piece.starts_with("\x1b[") && piece.ends_with('m') {
            out.push_str(piece);
        }
        rest = &seq[len..];
    }
    out.push_str(rest);
    out
}

/// The core's events as herdr's: `{"event": snake, "data": {"type": snake, …}}`. `before` is the
/// view before the event, for what it no longer has.
pub fn translate(h: &Herdr, now: &View, before: &View, event: &Value) -> Vec<Value> {
    let envelope = |snake: &str, data: Value| {
        let mut data = data.as_object().cloned().unwrap_or_default();
        data.insert("type".into(), json!(snake));
        json!({ "event": snake, "data": data })
    };
    let pane = event["pane"].as_u64();
    let tab = event["tab"]
        .as_u64()
        .or_else(|| event["data"]["tab"]["id"].as_u64())
        .or_else(|| event["data"]["tab"].as_u64());
    let session = event["session"]
        .as_u64()
        .or_else(|| event["data"]["session"]["id"].as_u64())
        .or_else(|| event["data"]["session"].as_u64());
    match event["event"].as_str().unwrap_or_default() {
        "SessionNew" => session
            .and_then(|s| now.workspace_info(s))
            .map(|w| envelope("workspace_created", json!({ "workspace": w })))
            .into_iter()
            .collect(),
        "SessionClosed" => session
            .map(|s| envelope("workspace_closed", json!({ "workspace_id": crate::proto::ids::workspace(s as usize) })))
            .into_iter()
            .collect(),
        "SessionRenamed" => session
            .and_then(|s| now.workspace_info(s))
            .map(|w| envelope("workspace_renamed", json!({ "workspace_id": w.workspace_id, "label": w.label })))
            .into_iter()
            .collect(),
        "SessionEnter" => session
            .map(|s| envelope("workspace_focused", json!({ "workspace_id": crate::proto::ids::workspace(s as usize) })))
            .into_iter()
            .collect(),
        "TabNew" => tab
            .and_then(|t| now.tab_info(t))
            .map(|t| envelope("tab_created", json!({ "tab": t })))
            .into_iter()
            .collect(),
        "TabClosed" => tab.map(|t| envelope("tab_closed", json!({ "tab_id": before.tab_id(t) }))).into_iter().collect(),
        "TabEnter" => tab
            .and_then(|t| now.tab_info(t))
            .map(|t| envelope("tab_focused", json!({ "tab_id": t.tab_id, "workspace_id": t.workspace_id })))
            .into_iter()
            .collect(),
        "TabRenamed" => tab
            .and_then(|t| now.tab_info(t))
            .map(|t| {
                envelope("tab_renamed", json!({ "tab_id": t.tab_id, "workspace_id": t.workspace_id, "label": t.label }))
            })
            .into_iter()
            .collect(),
        "PaneNew" => pane
            .and_then(|p| now.pane_info(p, 0))
            .map(|p| envelope("pane_created", json!({ "pane": p })))
            .into_iter()
            .collect(),
        "PaneClosed" => pane
            .map(|p| {
                envelope(
                    "pane_closed",
                    json!({ "pane_id": before.pane_id(p), "terminal_id": crate::proto::ids::terminal(p) }),
                )
            })
            .into_iter()
            .collect(),
        "PaneEnter" => pane
            .and_then(|p| now.pane_info(p, h.revision(p)))
            .map(|p| {
                envelope(
                    "pane_focused",
                    json!({ "pane_id": p.pane_id, "tab_id": p.tab_id, "workspace_id": p.workspace_id }),
                )
            })
            .into_iter()
            .collect(),
        "TermClose" => {
            pane.map(|p| envelope("pane_exited", json!({ "pane_id": now.pane_id(p) }))).into_iter().collect()
        }
        "LayoutChanged" => tab
            .and_then(|t| now.tab_info(t))
            .map(|t| envelope("layout_updated", json!({ "tab_id": t.tab_id, "workspace_id": t.workspace_id })))
            .into_iter()
            .collect(),
        "OptionSet" if event["data"]["name"] == "@agent_status" => {
            let Some(p) = event["data"]["id"].as_u64() else { return Vec::new() };
            let Some(info) = now.pane_info(p, h.revision(p)) else { return Vec::new() };
            vec![json!({ "event": "pane.agent_status_changed", "data": {
                "pane_id": info.pane_id, "workspace_id": info.workspace_id, "agent_status": info.agent_status, "agent": info.agent,
            } })]
        }
        "OptionSet" if matches!(event["data"]["name"].as_str(), Some("title" | "@label" | "pane_current_path")) => {
            let Some(p) = event["data"]["id"].as_u64() else { return Vec::new() };
            now.pane_info(p, h.revision(p))
                .map(|p| envelope("pane_updated", json!({ "pane": p })))
                .into_iter()
                .collect()
        }
        _ => Vec::new(),
    }
}
