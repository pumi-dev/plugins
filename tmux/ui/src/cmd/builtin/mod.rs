//! The commands. Each reads its flags, calls the API's functions (so what a command does, a
//! script can do with `pumi_call`), and prints what tmux prints.

pub mod buffer;
pub mod hook;
pub mod key;
pub mod option;
pub mod pane;
pub mod pumi;
pub mod script;
pub mod server;
pub mod session;
pub mod style;
pub mod tab;
pub mod user;

use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::Parsed;

use super::{Flow, Queue, expand, truthy};
use crate::kernel::Kernel;
use crate::kernel::layout::PaneId;
use crate::kernel::{SessionId, TabId};

pub(crate) fn kernel<'a>(cx: &'a mut Cx) -> &'a mut Kernel {
    super::kernel(cx)
}

/// Calls a function as the command's caller.
pub(crate) fn call(cx: &mut Cx, name: &str, args: Value) -> Result<Value> {
    cx.call(name, args)
}

/// One object a listing shows: what its formats are about.
#[derive(Clone, Copy)]
pub(crate) struct Row {
    pub session: Option<SessionId>,
    pub tab: Option<TabId>,
    pub pane: Option<PaneId>,
}

/// Prints a listing as tmux does: each row's `-F` format (or the default), only rows whose
/// `-f` filter is true; `--json` prints `json(row)` instead, one object per line.
pub(crate) fn list(
    cx: &mut Cx,
    queue: &mut Queue,
    p: &Parsed,
    rows: Vec<Row>,
    default: &str,
    json: impl Fn(&Kernel, Row) -> Value,
) -> Result<Flow> {
    let k = kernel(cx);
    let format = p.get('F').unwrap_or(default).to_string();
    let filter = p.get('f').map(str::to_string);
    let mut rows = rows;
    if p.has('r') {
        rows.reverse();
    }
    for (line, row) in rows.into_iter().enumerate() {
        let mut vars = queue.vars.clone();
        vars.insert("line".into(), line.to_string());
        let shadow = Queue { vars, ..shell(queue) };
        if let Some(filter) = &filter
            && !truthy(&expand(k, &shadow, row.session, row.tab, row.pane, filter))
        {
            continue;
        }
        if p.has_long("json") {
            queue.print(json(k, row).to_string());
        } else {
            queue.print(expand(k, &shadow, row.session, row.tab, row.pane, &format));
        }
    }
    Ok(Flow::Next)
}

/// A queue's context without its commands: for expanding formats beside it.
pub(crate) fn shell(queue: &Queue) -> Queue {
    Queue {
        id: queue.id,
        caller: queue.caller.clone(),
        cwd: queue.cwd.clone(),
        vars: queue.vars.clone(),
        items: Default::default(),
        output: String::new(),
        status: None,
        reply: None,
        interactive: queue.interactive,
    }
}

/// Prints `-P` output: the new object's format.
pub(crate) fn print_new(cx: &mut Cx, queue: &mut Queue, p: &Parsed, default: &str, row: Row) {
    if !p.has('P') {
        return;
    }
    let k = kernel(cx);
    let format = p.get('F').unwrap_or(default);
    let line = expand(k, queue, row.session, row.tab, row.pane, format);
    queue.print(line);
}

/// A row about a pane: its tab and session too.
pub(crate) fn pane_row(k: &Kernel, pane: PaneId) -> Row {
    let tab = k.tab_of_pane(pane);
    Row { session: tab.and_then(|t| k.session_of_tab(t)), tab, pane: Some(pane) }
}

/// `-e VAR=value`, as many times as given.
pub(crate) fn env_flags(p: &Parsed) -> Result<serde_json::Map<String, Value>> {
    let mut env = serde_json::Map::new();
    for pair in p.all('e') {
        let (name, value) =
            pair.split_once('=').ok_or_else(|| Error::invalid_params(format!("-e needs VAR=value, not {pair}")))?;
        env.insert(name.into(), json!(value));
    }
    Ok(env)
}

/// The command a new pane runs, from the arguments after the flags: one is a shell command,
/// several are a program and its arguments, as tmux takes them.
pub(crate) fn command_args(p: &Parsed) -> Option<Value> {
    let words = p.words();
    match words.len() {
        0 => None,
        1 => Some(json!(words[0])),
        _ => Some(json!(words)),
    }
}

/// A pane's arguments for its type: a terminal's command, cwd and environment; a browser's URL.
pub(crate) fn pane_args(queue: &Queue, p: &Parsed, ty: &str) -> Result<Value> {
    let cwd = p.get('c').map(|c| super::path(queue, c).display().to_string());
    match ty {
        "terminal" => {
            let mut args = serde_json::Map::new();
            if let Some(command) = command_args(p) {
                args.insert("command".into(), command);
            }
            if let Some(cwd) = cwd {
                args.insert("cwd".into(), json!(cwd));
            }
            let env = env_flags(p)?;
            if !env.is_empty() {
                args.insert("env".into(), Value::Object(env));
            }
            Ok(Value::Object(args))
        }
        "browser" => {
            let url = p.words().first().cloned().unwrap_or_else(|| "about:blank".into());
            Ok(json!({ "url": url }))
        }
        _ => {
            // Another type takes `key=value` arguments, or one JSON object.
            let words = p.words();
            if let [one] = words.as_slice()
                && let Ok(value @ Value::Object(_)) = serde_json::from_str::<Value>(one)
            {
                return Ok(value);
            }
            let mut args = serde_json::Map::new();
            for word in words {
                let (k, v) = word
                    .split_once('=')
                    .ok_or_else(|| Error::invalid_params(format!("{ty} takes key=value, not {word}")))?;
                args.insert(k.into(), serde_json::from_str(v).unwrap_or(json!(v)));
            }
            Ok(Value::Object(args))
        }
    }
}

/// A size flag: `30%`, or cells.
pub(crate) fn size(text: &str) -> Value {
    match text.strip_suffix('%') {
        Some(_) => json!(text),
        None => match text.parse::<u64>() {
            Ok(n) => json!(n),
            Err(_) => json!(text),
        },
    }
}

/// A command that needs an attached client to draw it (phase 4's client rewrite).
pub(crate) fn needs_client(_: &mut Cx, _: &mut Queue, _: &Parsed) -> Result<Flow> {
    Err(Error::invalid_params("this command draws in a client, and no client draws commands' UI yet"))
}

/// `command-prompt [-p prompt] [-I input] [template]` and `confirm-before [-p prompt] command`:
/// a `chrome.cmdline` float along the client's bottom (06 §1), which runs the template with
/// what was typed in place of `%%` (or `%1`), or the command on `y`.
pub(crate) fn command_prompt(cx: &mut Cx, q: &mut Queue, p: &Parsed) -> Result<Flow> {
    prompt(cx, q, p, false)
}

pub(crate) fn confirm_before(cx: &mut Cx, q: &mut Queue, p: &Parsed) -> Result<Flow> {
    prompt(cx, q, p, true)
}

fn prompt(cx: &mut Cx, _: &mut Queue, p: &Parsed, confirm: bool) -> Result<Flow> {
    let template = p.args.first().and_then(|a| a.as_str()).map(str::to_string).unwrap_or_default();
    if confirm && template.is_empty() {
        return Err(Error::invalid_params("confirm-before needs a command"));
    }
    let prompt = p
        .get('p')
        .map(str::to_string)
        .unwrap_or_else(|| if confirm { format!("Run '{template}'? (y/n)") } else { ":".into() });
    let caller = cx.caller().clone();
    let k = kernel(cx);
    let (width, height) = k
        .chans
        .get(&caller.channel)
        .and_then(|c| c.ui.as_ref())
        .or_else(|| k.chans.values().find_map(|c| c.ui.as_ref()))
        .map(|ui| (ui.width, ui.height))
        .unwrap_or((80, 24));
    // tmux expands formats in the prompt and the initial text.
    let expand = |cx: &mut Cx, text: &str| -> String {
        call(cx, "pumi_eval_format", json!([text, {}]))
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default()
    };
    let input = p.get('I').unwrap_or("").to_string();
    let (prompt, input) = (expand(cx, &prompt), expand(cx, &input));
    let args = json!({
        "mode": if confirm { "confirm" } else { "prompt" },
        "prompt": prompt,
        "input": input,
        "template": template,
    });
    let place = json!({ "kind": "float", "row": height.saturating_sub(2), "col": 0, "width": width, "height": 1, "zindex": 50 });
    call(cx, "pumi_open_pane", json!(["chrome.cmdline", args, place]))?;
    Ok(Flow::Next)
}
