//! herdr's socket (`herdr.sock`): newline-delimited `{"id","method","params"}` requests, each
//! answered with `{"id","result"}` or `{"id","error":{"code","message"}}`; `events.subscribe`
//! answers `subscription_started` and then streams event envelopes on the same connection.
//!
//! The connections come from `system.listen`, so a request is a few calls to the core, run
//! where the plugin is woken; there is no thread per connection in wasm.
//!
//! PROVENANCE: framing and envelopes from herdr `src/api/server.rs` @ v0.9.3 (Apache-2.0).

use pumi_plugin::system::{self, SocketEvent};
use serde_json::{Value, json};

use crate::api::{Fail, Herdr, dispatch};
use crate::proto::codes;
use crate::proto::events::{self, Delivery};
use crate::state::{self, Want};

/// Serve herdr's socket. The listener goes when the plugin stops.
pub fn serve(path: &str) -> Result<u64, String> {
    system::listen(path, |conn, event, _cx| match event {
        SocketEvent::Accepted => state::accepted(conn),
        SocketEvent::Closed => state::closed(conn),
        SocketEvent::Data(bytes) => {
            for line in state::push(conn, &bytes) {
                request(conn, &line);
            }
        }
    })
}

/// A line one of herdr's clients sent: one request, one answer.
fn request(conn: u64, line: &str) {
    let request: Value = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(err) => {
            let error = Fail {
                code: codes::INVALID_REQUEST,
                message: format!("invalid request: {err}"),
            };
            return reply(conn, &json!(""), Err(error));
        }
    };
    let id = request.get("id").cloned().unwrap_or(json!(""));
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        let error = Fail {
            code: codes::INVALID_REQUEST,
            message: "missing method".into(),
        };
        return reply(conn, &id, Err(error));
    };
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    if method == "events.subscribe" {
        match parse(&params["subscriptions"]) {
            Ok(wants) => {
                state::subscribe(conn, wants);
                reply(conn, &id, Ok(json!({ "type": "subscription_started" })));
            }
            Err(error) => reply(conn, &id, Err(error)),
        }
        return;
    }
    reply(conn, &id, dispatch(&Herdr, method, &params));
}

/// What a subscription asked to hear, or why pumi cannot send it.
fn parse(subscriptions: &Value) -> Result<Vec<Want>, Fail> {
    let bad = |message: String| Fail {
        code: codes::INVALID_PARAMS,
        message,
    };
    let mut wants = Vec::new();
    for sub in subscriptions.as_array().into_iter().flatten() {
        let kind = sub["type"]
            .as_str()
            .ok_or_else(|| bad("a subscription needs `type`".into()))?;
        let event =
            events::find(kind).ok_or_else(|| bad(format!("unknown subscription type: {kind}")))?;
        wants.push(match (event.delivery, event.dotted) {
            (Delivery::Lifecycle, _) => Want::Lifecycle(event.snake),
            (_, "pane.agent_status_changed") => Want::Status {
                pane_id: sub["pane_id"]
                    .as_str()
                    .ok_or_else(|| bad("missing `pane_id`".into()))?
                    .to_string(),
                status: sub["agent_status"].as_str().map(str::to_string),
            },
            _ => return Err(bad(format!("{kind} cannot be subscribed to on pumi yet"))),
        });
    }
    Ok(wants)
}

fn reply(conn: u64, id: &Value, outcome: Result<Value, Fail>) {
    let message = match outcome {
        Ok(result) => json!({ "id": id, "result": result }),
        Err(err) => json!({ "id": id, "error": { "code": err.code, "message": err.message } }),
    };
    send(conn, &message);
}

/// One JSON value, as herdr's clients read the socket.
pub fn send(conn: u64, value: &Value) {
    let mut line = value.to_string();
    line.push('\n');
    if system::send(conn, line.as_bytes()).is_err() {
        state::closed(conn);
    }
}

/// An event of the core's: what it means to herdr's clients goes to whoever asked for it.
pub fn on_event(event: Value) {
    if !state::subscribed() {
        return;
    }
    let herdr = Herdr;
    // The pane an event is about has changed.
    if let Some(pane) = event["pane"].as_u64() {
        state::bump(pane);
    }
    let Ok(now) = herdr.view() else { return };
    let before = state::view().unwrap_or_else(|| now.clone());
    let envelopes = crate::api::translate(&herdr, &now, &before, &event);
    state::set_view(now);
    if !envelopes.is_empty() {
        state::publish(&envelopes);
    }
}
