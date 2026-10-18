//! Lua is the app's (23 §4): scripts it runs while it is open, kept by the host. The commands
//! that ran Lua in the host (`lua`, `source-file x.lua`, `pack`, `colorscheme`, `checkhealth`)
//! say where it went.

use std::path::Path;

use serde_json::Value;

use pumi_api::{Cx, Error, Result};

use crate::cmd::{Flow, Queue};

const NO_LUA: &str = "Lua runs in the app as scripts (Settings → Scripts, `pumi script`)";

/// A command that ran Lua: it is refused, naming where Lua went.
pub fn run_for_queue(
    cx: &mut Cx,
    queue: &mut Queue,
    code: Option<&str>,
    file: Option<&Path>,
    name: &str,
) -> Result<Flow> {
    let _ = (cx, queue, code, file);
    Err(Error::invalid_params(format!("{name}: {NO_LUA}")))
}

/// What `checkhealth` asked Lua: nothing to ask.
pub fn eval(cx: &mut Cx, code: &str) -> Result<Value> {
    let _ = (cx, code);
    Err(Error::invalid_params(NO_LUA))
}
