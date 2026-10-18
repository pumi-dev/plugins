//! tmux on pumi (docs/v2/23 §3, step 5): a wasm package that speaks tmux's language over the
//! model — command lines, formats, targets, hooks, paste buffers, `wait-for`, `run-shell`, the
//! environment — so tmux's configuration, scripts and habits drive pumi's sessions. It runs in
//! the app (the Plugins core plugin), while the app is open. It provides its functions
//! (`pumi_cmd`, `pumi_exec2`, …) to every caller, keeps the model as the core says it is
//! ([`kernel`]) and changes it only through the API. Lua is the app's (scripts): `lua` and
//! `source-file x.lua` say so.
//!
//! - [`cmd`]: the command language: queues, the commands, what they wait on.
//! - [`api`]: tmux's functions: `pumi_cmd`, user commands, buffers, the environment.
//! - [`server`]: what was the process: providing the functions, the mirror's events, timers and
//!   jobs.
//! - [`defaults`]: tmux's prefix keys and the Session menu, bound while it runs.

pub mod api;
pub mod cmd;
pub mod defaults;
pub mod kernel;
pub mod lua;
pub mod server;

use pumi_plugin::prelude::*;

fn init(_plugin: &mut Plugin, cx: &mut App) {
    server::start(cx);
}

pumi_plugin::plugin!(init);
