//! Paste buffers: `set-buffer`, `show-buffer`, `paste-buffer`, `list-buffers`, `delete-buffer`,
//! `load-buffer`, `save-buffer`.

use serde_json::{Value, json};

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::Parsed;

use super::{call, kernel};
use crate::cmd::Cmd;
use crate::cmd::{Flow, Queue, path, target_pane};

pub const LIST_BUFFERS: &str = "#{buffer_name}: #{buffer_size} bytes: \"#{buffer_sample}\"";

/// `set-buffer [-aw] [-b name] [-n new-name] [data]`.
pub fn set_buffer(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    if let Some(new) = p.get('n') {
        let k = kernel(cx);
        let old = k.cmd().buffer(p.get('b')).map(|b| b.name.clone()).ok_or_else(|| Error::not_found("no buffer"))?;
        if let Some(buffer) = k.cmd().buffers.iter_mut().find(|b| b.name == old) {
            buffer.name = new.to_string();
            buffer.automatic = false;
        }
        return Ok(Flow::Next);
    }
    let data = p.arg(0).ok_or_else(|| Error::invalid_params("no data specified"))?;
    call(cx, "pumi_set_buffer", json!([p.get('b'), data, {"append": p.has('a')}]))?;
    Ok(Flow::Next)
}

/// `show-buffer [-b name]`.
pub fn show_buffer(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let buffer = call(cx, "pumi_get_buffer", json!([p.get('b')]))?;
    let data = buffer["data"].as_str().unwrap_or("");
    queue.output.push_str(data);
    if !data.ends_with('\n') {
        queue.output.push('\n');
    }
    Ok(Flow::Next)
}

/// `paste-buffer [-dpr] [-b name] [-s separator] [-t target]`: into a pane as a paste; `-p`
/// brackets it when the program asked, `-r` keeps newlines.
pub fn paste_buffer(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t'))?;
    let buffer = call(cx, "pumi_get_buffer", json!([p.get('b')]))?;
    let mut data = buffer["data"].as_str().unwrap_or("").to_string();
    if !p.has('r') {
        let separator = p.get('s').unwrap_or("\r");
        data = data.replace('\n', separator);
    }
    let input = if p.has('p') { json!({"paste": data}) } else { json!({"text": data}) };
    call(cx, "pumi_pane_call", json!([pane, "input", input]))?;
    if p.has('d') {
        call(cx, "pumi_del_buffer", json!([buffer["name"]]))?;
    }
    Ok(Flow::Next)
}

/// `list-buffers [-r] [-F format] [-f filter] [--json]`.
pub fn list_buffers(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let buffers = call(cx, "pumi_list_buffers", json!([]))?;
    let mut buffers: Vec<Value> = buffers.as_array().cloned().unwrap_or_default();
    if p.has('r') {
        buffers.reverse();
    }
    let format = p.get('F').unwrap_or(LIST_BUFFERS).to_string();
    for buffer in buffers {
        let data = buffer["data"].as_str().unwrap_or("");
        let mut vars = queue.vars.clone();
        vars.insert("buffer_name".into(), buffer["name"].as_str().unwrap_or("").into());
        vars.insert("buffer_size".into(), data.len().to_string());
        vars.insert("buffer_created".into(), buffer["created"].to_string());
        let sample: String = data.chars().take(50).flat_map(char::escape_default).collect();
        vars.insert("buffer_sample".into(), sample);
        vars.insert("buffer_full".into(), data.into());
        let shadow = Queue { vars, ..super::shell(queue) };
        let k = kernel(cx);
        if let Some(filter) = p.get('f')
            && !crate::cmd::truthy(&crate::cmd::expand(k, &shadow, None, None, None, filter))
        {
            continue;
        }
        if p.has_long("json") {
            queue.print(buffer.to_string());
        } else {
            queue.print(crate::cmd::expand(k, &shadow, None, None, None, &format));
        }
    }
    Ok(Flow::Next)
}

/// `delete-buffer [-b name]`.
pub fn delete_buffer(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    call(cx, "pumi_del_buffer", json!([p.get('b')]))?;
    Ok(Flow::Next)
}

/// `load-buffer [-w] [-b name] path`.
pub fn load_buffer(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let file = p.arg(0).unwrap_or("");
    if file == "-" {
        return Err(Error::invalid_params("load-buffer -: the CLI sends standard input as a path"));
    }
    let full = path(queue, file);
    let data = std::fs::read(&full).map_err(|err| Error::exception(format!("{}: {err}", full.display())))?;
    call(cx, "pumi_set_buffer", json!([p.get('b'), String::from_utf8_lossy(&data), {}]))?;
    Ok(Flow::Next)
}

/// `save-buffer [-a] [-b name] path`: `-` prints it.
pub fn save_buffer(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let buffer = call(cx, "pumi_get_buffer", json!([p.get('b')]))?;
    let data = buffer["data"].as_str().unwrap_or("");
    let file = p.arg(0).unwrap_or("-");
    if file == "-" {
        queue.output.push_str(data);
        return Ok(Flow::Next);
    }
    let full = path(queue, file);
    let result = if p.has('a') {
        use std::io::Write;
        std::fs::OpenOptions::new().create(true).append(true).open(&full).and_then(|mut f| f.write_all(data.as_bytes()))
    } else {
        std::fs::write(&full, data)
    };
    result.map_err(|err| Error::exception(format!("{}: {err}", full.display())))?;
    Ok(Flow::Next)
}
