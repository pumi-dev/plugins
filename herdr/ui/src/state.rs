//! What herdr's socket keeps between callbacks (23 §3: a plugin has no thread of its own, so
//! its state is the plugin's): the connections and the line each is part of, what each asked
//! to hear, and each pane's revision.

use std::cell::RefCell;
use std::collections::BTreeMap;

use serde_json::Value;

use crate::view::View;

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|state| f(&mut state.borrow_mut()))
}

/// What one subscriber asked for.
#[derive(Clone, Debug)]
pub enum Want {
    /// Every event of this snake name.
    Lifecycle(&'static str),
    /// A pane's agent status changes, perhaps only to one status.
    Status {
        pane_id: String,
        status: Option<String>,
    },
}

impl Want {
    fn wants(&self, envelope: &Value) -> bool {
        let name = envelope["event"].as_str().unwrap_or_default();
        match self {
            Want::Lifecycle(snake) => *snake == name,
            Want::Status { pane_id, status } => {
                name == "pane.agent_status_changed"
                    && envelope["data"]["pane_id"] == pane_id.as_str()
                    && status
                        .as_ref()
                        .is_none_or(|s| envelope["data"]["agent_status"] == s.as_str())
            }
        }
    }
}

/// One connection: the bytes of the line being read, and whether its `events.subscribe` was
/// answered (from then on events go to it too).
struct Conn {
    line: Vec<u8>,
}

struct Sub {
    conn: u64,
    wants: Vec<Want>,
}

#[derive(Default)]
struct State {
    conns: BTreeMap<u64, Conn>,
    subs: Vec<Sub>,
    revisions: BTreeMap<u64, u64>,
    /// The model as of the last event translated: what an event took away is read from it.
    view: Option<View>,
}

/// A listener took a connection.
pub fn accepted(conn: u64) {
    with(|state| state.conns.insert(conn, Conn { line: Vec::new() }));
}

/// A connection went away: what it asked for goes with it.
pub fn closed(conn: u64) {
    with(|state| {
        state.conns.remove(&conn);
        state.subs.retain(|sub| sub.conn != conn);
    });
}

/// What a connection sent, as the complete lines it now holds.
pub fn push(conn: u64, bytes: &[u8]) -> Vec<String> {
    with(|state| {
        let Some(conn) = state.conns.get_mut(&conn) else {
            return Vec::new();
        };
        conn.line.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(at) = conn.line.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = conn.line.drain(..=at).collect();
            let text = String::from_utf8_lossy(&line).trim().to_string();
            if !text.is_empty() {
                lines.push(text);
            }
        }
        lines
    })
}

/// A connection's `events.subscribe`: herdr's events of these kinds go to it.
pub fn subscribe(conn: u64, wants: Vec<Want>) {
    with(|state| {
        state.subs.retain(|sub| sub.conn != conn);
        state.subs.push(Sub { conn, wants });
    });
}

/// Whether anyone is listening: without a subscriber no event is worth translating.
pub fn subscribed() -> bool {
    with(|state| !state.subs.is_empty())
}

/// What a pane has shown since herdr started watching.
pub fn revision(pane: u64) -> u64 {
    with(|state| state.revisions.get(&pane).copied().unwrap_or(0))
}

/// The pane changed: its revision moves on.
pub fn bump(pane: u64) {
    with(|state| {
        let revision = state.revisions.entry(pane).or_insert(0);
        *revision += 1;
    });
}

/// The model as of the last event translated.
pub fn view() -> Option<View> {
    with(|state| state.view.clone())
}

pub fn set_view(view: View) {
    with(|state| state.view = Some(view));
}

/// Sends herdr's envelopes to the subscribers that asked for them; one that cannot be
/// reached is gone.
pub fn publish(envelopes: &[Value]) {
    let mut sends: Vec<(u64, Value)> = Vec::new();
    with(|state| {
        for sub in &state.subs {
            for envelope in envelopes {
                if sub.wants.iter().any(|want| want.wants(envelope)) {
                    sends.push((sub.conn, envelope.clone()));
                }
            }
        }
    });
    for (conn, envelope) in sends {
        crate::socket::send(conn, &envelope);
    }
}
