//! User commands (Neovim's `:command`): running one, and `command`/`delcommand`.

use serde_json::{Map, Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::{Arg, Parsed, quote};

use super::{call, kernel};
use crate::cmd::{Flow, Queue, UserCommand, parse_text};

/// Runs a user command with its arguments.
pub fn run(cx: &mut Cx, queue: &mut Queue, user: &UserCommand, args: &[Arg]) -> Result<Flow> {
    let words: Vec<String> = args.iter().map(Arg::to_text).collect();
    let ok = match user.nargs.as_str() {
        "0" => words.is_empty(),
        "1" => words.len() == 1,
        "?" => words.len() <= 1,
        "+" => !words.is_empty(),
        _ => true,
    };
    if !ok {
        return Err(Error::invalid_params(format!(
            "{}: takes {} arguments (nargs={})",
            user.name,
            words.len(),
            user.nargs
        )));
    }
    if let Some(function) = &user.call {
        return call_function(cx, queue, &user.name, function, &words);
    }
    if let Some(callback) = &user.callback {
        let opts =
            json!({ "name": user.name, "args": words.join(" "), "fargs": words, "bang": false, "nargs": user.nargs });
        let caller = queue.caller.clone();
        cx.as_caller(&caller, |cx| call(cx, callback, json!([opts])))?;
        return Ok(Flow::Next);
    }
    let template = user.command.clone().unwrap_or_default();
    let line = template
        .replace("<args>", &words.join(" "))
        .replace("<q-args>", &quote(&words.join(" ")))
        .replace("<f-args>", &words.iter().map(|w| quote(w)).collect::<Vec<_>>().join(" "))
        .replace("<bang>", "");
    Ok(Flow::Insert(parse_text(cx, queue, &line)?))
}

/// A value as a word means it: JSON when it is JSON, else the word itself.
pub fn word_value(word: &str) -> Value {
    serde_json::from_str(word).unwrap_or_else(|_| json!(word))
}

/// A function's arguments from words, by its parameters: `--name value`, `name=value`, or in
/// order; one JSON array or object is the arguments themselves.
pub fn function_args(cx: &mut Cx, function: &str, words: &[String]) -> Result<Value> {
    let info =
        crate::api::function_info(cx, function).ok_or_else(|| Error::not_found(format!("no function `{function}`")))?;
    if let [one] = words
        && let Ok(value @ (Value::Array(_) | Value::Object(_))) = serde_json::from_str::<Value>(one)
    {
        return Ok(value);
    }
    let names = info.param_names();
    let mut named = Map::new();
    let mut positional = 0;
    let mut i = 0;
    while i < words.len() {
        let word = &words[i];
        if let Some(long) = word.strip_prefix("--") {
            let (name, value) = match long.split_once('=') {
                Some((n, v)) => (n.to_string(), word_value(v)),
                None => {
                    let next = words.get(i + 1);
                    match next {
                        Some(v) if !v.starts_with("--") => {
                            i += 1;
                            (long.to_string(), word_value(v))
                        }
                        _ => (long.to_string(), Value::Bool(true)),
                    }
                }
            };
            named.insert(name.replace('-', "_"), value);
        } else if let Some((name, value)) = word.split_once('=').filter(|(n, _)| names.iter().any(|x| x == n)) {
            named.insert(name.to_string(), word_value(value));
        } else {
            let name = names.get(positional).ok_or_else(|| {
                Error::invalid_params(format!("{function} takes {} arguments: {}", names.len(), names.join(", ")))
            })?;
            named.insert(name.clone(), word_value(word));
            positional += 1;
        }
        i += 1;
    }
    Ok(Value::Object(named))
}

fn call_function(cx: &mut Cx, queue: &mut Queue, name: &str, function: &str, words: &[String]) -> Result<Flow> {
    let args =
        function_args(cx, function, words).map_err(|err| Error::new(err.kind, format!("{name}: {}", err.message)))?;
    let result = call(cx, function, args)?;
    print_result(queue, &result);
    Ok(Flow::Next)
}

/// A function's result, printed: text as it is, anything else as JSON.
pub fn print_result(queue: &mut Queue, result: &Value) {
    match result {
        Value::Null => {}
        Value::String(text) => queue.print(text),
        other => queue.print(serde_json::to_string_pretty(other).unwrap_or_default()),
    }
}

/// `command [-nargs=N] [-desc=text] Name command…` (Neovim's `:command`); alone, lists them.
pub fn command(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut words: Vec<Arg> = p.args.clone();
    if words.is_empty() {
        let commands = call(cx, "pumi_get_commands", json!([{"builtin": false}]))?;
        for (name, info) in commands.as_object().cloned().unwrap_or_default() {
            let user = &info["user"];
            let action = user["command"]
                .as_str()
                .map(str::to_string)
                .or_else(|| user["call"].as_str().map(|f| format!("(calls {f})")))
                .unwrap_or_default();
            queue.print(format!("{name:<16} {:<3} {action}", user["nargs"].as_str().unwrap_or("0")));
        }
        return Ok(Flow::Next);
    }
    let mut opts = json!({});
    while let Some(Arg::String(word)) = words.first().cloned() {
        let Some(attribute) = word.strip_prefix('-') else { break };
        words.remove(0);
        let (key, value) = attribute.split_once('=').unwrap_or((attribute, ""));
        match key {
            "nargs" => opts["nargs"] = json!(value),
            "desc" => opts["desc"] = json!(value),
            "call" => opts["call"] = json!(value),
            "bang" | "bar" | "complete" | "range" | "count" | "register" | "buffer" | "keepscript" => {}
            other => return Err(Error::invalid_params(format!("unknown attribute -{other}"))),
        }
    }
    let name = words.first().map(Arg::to_text).ok_or_else(|| Error::invalid_params("command needs a name"))?;
    let rest = &words[1..];
    let line = match rest {
        [] => None,
        [Arg::Commands(list)] => Some(pumi_lang::cmd::print_list(list)),
        [Arg::String(one)] => Some(one.clone()),
        [first, others @ ..] => Some(pumi_lang::cmd::print(&pumi_lang::cmd::Command {
            name: first.to_text(),
            args: others.to_vec(),
            line: 0,
        })),
    };
    if line.is_none() && opts.get("call").is_none() {
        let commands = call(cx, "pumi_get_commands", json!([{"builtin": false}]))?;
        match commands.get(&name) {
            Some(info) => queue.print(info.to_string()),
            None => return Err(Error::not_found(format!("no user command {name}"))),
        }
        return Ok(Flow::Next);
    }
    call(cx, "pumi_create_user_command", json!([name, line, opts]))?;
    Ok(Flow::Next)
}

/// `delcommand Name` (Neovim's `:delcommand`).
pub fn delcommand(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    call(cx, "pumi_del_user_command", json!([p.arg(0).unwrap_or("")]))?;
    let _ = kernel(cx);
    Ok(Flow::Next)
}
