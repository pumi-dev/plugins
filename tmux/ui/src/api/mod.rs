//! tmux's functions (02 §2): the command line, user commands, paste buffers, the environment.
//! Each is in the registry, so tmux's own calls reach it here, and provided through the app
//! (`server`), so every other caller does. Their descriptions are the export's
//! (`specs.json`, from pumi's `api/pumi-api.json`, provider `tmux`).

pub mod commands;

use serde_json::Value;

use pumi_api::{Args, Caller, Cx, DynHandler, FunctionInfo, Result, to_value};

use crate::kernel::Kernel;

/// The kernel, and who is calling.
pub(crate) fn kernel<'a>(cx: &'a mut Cx) -> Result<(Caller, &'a mut Kernel)> {
    let caller = cx.caller().clone();
    let k = cx.host::<Kernel>()?;
    k.sync();
    Ok((caller, k))
}

/// tmux's functions as `pumi_get_api_info` lists them.
const SPECS: &str = include_str!("specs.json");

pub fn specs() -> Vec<FunctionInfo> {
    serde_json::from_str(SPECS).expect("specs.json lists functions")
}

/// What `#[api]` made of a function: its arguments taken by position or name, its result as
/// JSON.
macro_rules! handler {
    ($f:path, $name:literal, [$($i:literal $p:literal $opt:literal),*]) => {
        Box::new(|cx: &mut Cx<'_>, args: Value| -> Result<Value> {
            #[allow(unused_mut)]
            let mut _args = Args::new($name, args, &[$($p),*])?;
            to_value($f(cx $(, _args.take($i, $p, $opt)?)*)?)
        })
    };
}

/// How a function of tmux's is called.
pub fn handler(name: &str) -> Option<DynHandler> {
    use commands::*;
    let h: DynHandler = match name {
        "pumi_cmd" => handler!(pumi_cmd, "pumi_cmd", [0 "cmd" false, 1 "opts" true]),
        "pumi_exec2" => handler!(pumi_exec2, "pumi_exec2", [0 "src" false, 1 "opts" true]),
        "pumi_parse_cmd" => {
            handler!(pumi_parse_cmd, "pumi_parse_cmd", [0 "str" false, 1 "opts" true])
        }
        "pumi_get_commands" => handler!(pumi_get_commands, "pumi_get_commands", [0 "opts" true]),
        "pumi_create_user_command" => handler!(
            pumi_create_user_command,
            "pumi_create_user_command",
            [0 "name" false, 1 "command" true, 2 "opts" true]
        ),
        "pumi_del_user_command" => {
            handler!(pumi_del_user_command, "pumi_del_user_command", [0 "name" false])
        }
        "pumi_list_buffers" => handler!(pumi_list_buffers, "pumi_list_buffers", []),
        "pumi_get_buffer" => handler!(pumi_get_buffer, "pumi_get_buffer", [0 "name" true]),
        "pumi_set_buffer" => {
            handler!(pumi_set_buffer, "pumi_set_buffer", [0 "name" true, 1 "data" false, 2 "opts" true])
        }
        "pumi_del_buffer" => handler!(pumi_del_buffer, "pumi_del_buffer", [0 "name" true]),
        "pumi_get_environment" => {
            handler!(pumi_get_environment, "pumi_get_environment", [0 "opts" true])
        }
        "pumi_set_environment" => handler!(
            pumi_set_environment,
            "pumi_set_environment",
            [0 "name" false, 1 "value" true, 2 "opts" true]
        ),
        _ => return None,
    };
    Some(h)
}

/// Every function any plugin or the core provides, as the core lists them; read again when one
/// is missing.
#[derive(Default)]
struct Catalogue(Vec<FunctionInfo>);

fn catalogue(cx: &mut Cx, refresh: bool) -> Vec<FunctionInfo> {
    let Ok(k) = cx.host::<Kernel>() else {
        return Vec::new();
    };
    if refresh || k.ext.get::<Catalogue>().is_none_or(|c| c.0.is_empty()) {
        let listed = k
            .core
            .clone()
            .and_then(|core| {
                core.call("pumi_get_api_info", serde_json::json!([]), None)
                    .ok()
            })
            .and_then(|info| {
                serde_json::from_value::<Vec<FunctionInfo>>(info["functions"].clone()).ok()
            })
            .unwrap_or_default();
        k.ext.insert(Catalogue(listed));
    }
    k.ext
        .get::<Catalogue>()
        .map(|c| c.0.clone())
        .unwrap_or_default()
}

/// Every function: tmux's own, the core's, and every other plugin's.
pub fn functions(cx: &mut Cx) -> Vec<FunctionInfo> {
    let mut all = catalogue(cx, true);
    for own in cx.registry().functions() {
        if !all.iter().any(|f| f.name == own.name) {
            all.push(own);
        }
    }
    all.sort_by(|a, b| a.name.cmp(&b.name));
    all
}

/// One function, wherever it is.
pub fn function_info(cx: &mut Cx, name: &str) -> Option<FunctionInfo> {
    if let Some(info) = cx.registry().function_info(name) {
        return Some(info);
    }
    let find = |list: Vec<FunctionInfo>| list.into_iter().find(|f| f.name == name);
    find(catalogue(cx, false)).or_else(|| find(catalogue(cx, true)))
}
