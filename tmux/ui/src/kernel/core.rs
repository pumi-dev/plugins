//! The core, reached through the app (23 §3): what `pumi_api::channel::Core` was over the core's
//! socket, with the same calls, so the mirror's code is unchanged. A call waits in
//! `api::call`, which answers the calls that reach tmux meanwhile (a user command whose body
//! calls `pumi_cmd` again) on this stack, as `call_serving` did.

use serde_json::Value;

use pumi_api::{Error, ErrorKind, Result};

pub struct Core;

/// The SDK's error as the API's.
pub fn error(err: pumi_plugin::api::Error) -> Error {
    let kind = ErrorKind::from_name(&err.kind).unwrap_or(ErrorKind::Exception);
    Error::new(kind, err.message)
}

impl Core {
    /// Calls a function and waits for its answer. `caller` (who tmux acts for) cannot be said
    /// through the app: a call made while tmux answers one acts as that call's caller.
    pub fn call(&self, method: &str, params: Value, caller: Option<Value>) -> Result<Value> {
        let _ = caller;
        pumi_plugin::api::call(method, params).map_err(error)
    }

    /// `call`: nested calls are answered by the SDK.
    pub fn call_serving(
        &self,
        method: &str,
        params: Value,
        caller: Option<Value>,
        serve: &mut dyn FnMut(String),
    ) -> Result<Value> {
        let _ = serve;
        self.call(method, params, caller)
    }

    /// A notification: a call whose answer is dropped.
    pub fn notify(&self, method: &str, params: Value) {
        if let Err(err) = self.call(method, params, None) {
            crate::kernel::log(&format!("{method}: {}", err.message));
        }
    }

    /// A raw line for the core: a reply to a request answered late. The app answers a provided
    /// function when it returns, so there is no late reply to send.
    pub fn write(&self, line: &str) {
        crate::kernel::log(&format!("dropped a late reply: {line}"));
    }
}
