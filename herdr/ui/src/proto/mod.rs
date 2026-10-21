//! herdr's JSON API vocabulary, as herdr 0.9.x speaks it on its socket.
//!
//! PROVENANCE: herdr `src/api/schema/*.rs`, `src/workspace.rs` (public ids) and
//! `src/api/server.rs` (framing) @ v0.9.3 (Apache-2.0). The shapes are herdr's; the tables
//! ([`methods::METHODS`], [`events::EVENTS`]) are pumi's way of listing them.

pub mod events;
pub mod ids;
pub mod methods;
pub mod types;
pub mod wire;

/// The herdr version whose API pumi implements, and what `ping` reports.
pub const HERDR_VERSION: &str = "0.9.4";

/// herdr's API protocol number (`ping` reports it; herdr's CLI refuses a mismatch).
pub const HERDR_PROTOCOL: u32 = 22;

/// The envelope of a successful result: `{"id": …, "result": {"type": kind, …fields}}`.
pub fn result(kind: &str, fields: serde_json::Value) -> serde_json::Value {
    let mut object = match fields {
        serde_json::Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    object.insert("type".into(), kind.into());
    serde_json::Value::Object(object)
}

/// herdr's error codes, by what went wrong.
pub mod codes {
    pub const INVALID_REQUEST: &str = "invalid_request";
    pub const INVALID_PARAMS: &str = "invalid_params";
    pub const UNKNOWN_METHOD: &str = "unknown_method";
    pub const NOT_FOUND: &str = "not_found";
    pub const WORKSPACE_NOT_FOUND: &str = "workspace_not_found";
    pub const TAB_NOT_FOUND: &str = "tab_not_found";
    pub const PANE_NOT_FOUND: &str = "pane_not_found";
    pub const AGENT_NOT_FOUND: &str = "agent_not_found";
    pub const UNSUPPORTED: &str = "unsupported";
    pub const TIMEOUT: &str = "timeout";
    pub const INTERNAL: &str = "internal_error";
    pub const INVALID_KEY: &str = "invalid_key";
}
