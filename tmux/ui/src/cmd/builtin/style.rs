//! Style rules on the command line (06 §4): `set-style` and `show-styles`, over
//! `pumi_set_style` and `pumi_get_style`, in tmux's `-style` vocabulary.

use serde_json::{Map, Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::Parsed;

use super::call;
use crate::cmd::{Flow, Queue};

fn namespace(cx: &mut Cx, p: &Parsed) -> Result<u64> {
    match p.get('n') {
        None => Ok(0),
        Some(name) => call(cx, "pumi_create_namespace", json!([name]))?
            .as_u64()
            .ok_or_else(|| Error::exception("a namespace is a number")),
    }
}

/// `set-style [-u] [-n namespace] [-t target] selector [property=value ...]`: set a rule, or
/// with `-u` (or no properties) delete it.
pub fn set_style(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let ns = namespace(cx, p)?;
    let selector = p
        .arg(0)
        .ok_or_else(|| Error::invalid_params("no selector"))?
        .to_string();
    let mut val = Map::new();
    if !p.has('u') {
        for i in 1.. {
            let Some(pair) = p.arg(i) else { break };
            let (name, value) = pair.split_once('=').ok_or_else(|| {
                Error::invalid_params(format!("a property is name=value: {pair}"))
            })?;
            val.insert(
                name.trim().to_string(),
                Value::String(value.trim().to_string()),
            );
        }
    }
    let mut opts = json!({});
    if let Some(target) = p.get('t') {
        opts["target"] = json!(target);
    }
    call(cx, "pumi_set_style", json!([ns, selector, val, opts]))?;
    Ok(Flow::Next)
}

/// `show-styles [-n namespace] [-t target] [selector]`: each rule as `selector { name: value; … }`,
/// in the order they apply.
pub fn show_styles(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut opts = json!({});
    if p.has('n') {
        opts["ns"] = json!(namespace(cx, p)?);
    }
    if let Some(target) = p.get('t') {
        opts["target"] = json!(target);
    }
    if let Some(selector) = p.arg(0) {
        opts["selector"] = json!(selector);
    }
    for rule in call(cx, "pumi_get_style", json!([opts]))?
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        let props: Vec<String> = rule["val"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, v)| {
                format!(
                    "{k}: {}",
                    v.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string())
                )
            })
            .collect();
        let target = rule["target"]
            .as_str()
            .map(|t| format!(" -t {t}"))
            .unwrap_or_default();
        queue.print(format!(
            "{}{target} {{ {} }}",
            rule["selector"].as_str().unwrap_or(""),
            props.join("; ")
        ));
    }
    Ok(Flow::Next)
}
