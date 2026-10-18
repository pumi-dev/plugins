//! Scripting: `run-shell`, `if-shell`, `source-file`, `display-message`.

use std::time::Duration;

use serde_json::json;

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::{Arg, Command, Parsed};

use super::{call, kernel};
use crate::cmd::{Flow, JobKind, Outcome, Queue, arg_commands, expand, expand_time, path, target_pane, truthy};

pub const DISPLAY_MESSAGE: &str =
    "[#{session_name}] #{window_index}:#{window_name}, current pane #{pane_index} - (%H:%M %d-%b-%y)";

/// The directory a job runs in: `-c`, else the target pane's, else the CLI's.
fn job_cwd(cx: &mut Cx, queue: &Queue, p: &Parsed) -> Option<std::path::PathBuf> {
    if let Some(dir) = p.get('c') {
        return Some(path(queue, dir));
    }
    let pane = target_pane(cx, p.get('t')).ok();
    pane.map(|pane| kernel(cx).pane_option(pane, "pane_current_path"))
        .and_then(|v| v.as_str().filter(|s| !s.is_empty()).map(std::path::PathBuf::from))
        .or_else(|| queue.cwd.clone())
}

/// `run-shell [-bCE] [-c dir] [-d delay] [-t target] [command]`: runs a shell command and prints
/// its output, failing when it fails; `-C` runs a tmux command instead; `-b` does not wait.
pub fn run_shell(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    if let Some(delay) = p.get('d') {
        let seconds: f64 = delay.parse().map_err(|_| Error::invalid_params(format!("invalid delay time: {delay}")))?;
        // The same command again, without its delay, once the delay is over.
        let mut args: Vec<Arg> = Vec::new();
        for (flag, value) in p.flags.iter().filter(|(f, _)| *f != 'd') {
            args.push(Arg::String(format!("-{flag}")));
            if let Some(value) = value {
                args.push(value.clone());
            }
        }
        if !p.args.is_empty() {
            args.push(Arg::String("--".into()));
            args.extend(p.args.iter().cloned());
        }
        let again = Command { name: "run-shell".into(), args, line: 0 };
        let k = kernel(cx);
        let id = if p.has('b') { crate::cmd::fork(k, queue) } else { queue.id };
        let outcome = Outcome { insert: vec![again], ..Outcome::default() };
        if p.has('b') {
            crate::cmd::resume_after(k, id, Duration::from_secs_f64(seconds), outcome);
            return Ok(Flow::Next);
        }
        crate::cmd::wait_for_time(k, queue, Duration::from_secs_f64(seconds), outcome);
        return Ok(Flow::Wait);
    }
    let Some(command) = p.args.first() else { return Ok(Flow::Next) };
    if p.has('C') {
        let list = arg_commands(cx, queue, command)?;
        return Ok(Flow::Insert(list));
    }
    let text = command.to_text();
    let k = kernel(cx);
    let pane = k.current(&queue.caller).map(|c| c.pane);
    let text = expand(k, queue, None, None, pane, &text);
    let cwd = job_cwd(cx, queue, p);
    let k = kernel(cx);
    if p.has('b') {
        let id = crate::cmd::fork(k, queue);
        crate::cmd::spawn_job_for(
            k,
            id,
            &queue.caller,
            &text,
            cwd,
            JobKind::Run { command: text.clone(), show: false },
        )?;
        return Ok(Flow::Next);
    }
    crate::cmd::spawn_job(k, queue, &text, cwd, JobKind::Run { command: text.clone(), show: true })?;
    Ok(Flow::Wait)
}

/// `if-shell [-bF] [-t target] condition command [else]`: the condition is a shell command, or a
/// format with `-F`.
pub fn if_shell(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let condition = p.args[0].to_text();
    let then = p.args[1].clone();
    let otherwise = p.args.get(2).cloned();
    let pane = target_pane(cx, p.get('t')).ok();
    let condition = expand(kernel(cx), queue, None, None, pane, &condition);
    if p.has('F') {
        let chosen = if truthy(&condition) { Some(then) } else { otherwise };
        return match chosen {
            Some(arg) => Ok(Flow::Insert(arg_commands(cx, queue, &arg)?)),
            None => Ok(Flow::Next),
        };
    }
    let cwd = job_cwd(cx, queue, p);
    let k = kernel(cx);
    if p.has('b') {
        let id = crate::cmd::fork(k, queue);
        crate::cmd::spawn_job_for(k, id, &queue.caller, &condition, cwd, JobKind::If { then, otherwise })?;
        return Ok(Flow::Next);
    }
    crate::cmd::spawn_job(k, queue, &condition, cwd, JobKind::If { then, otherwise })?;
    Ok(Flow::Wait)
}

/// The files a `source-file` path names: itself, or what its glob matches.
fn glob(pattern: &std::path::Path) -> Vec<std::path::PathBuf> {
    let text = pattern.display().to_string();
    if !text.contains(['*', '?', '[']) {
        return vec![pattern.to_path_buf()];
    }
    let (Some(dir), Some(name)) = (pattern.parent(), pattern.file_name().and_then(|n| n.to_str())) else {
        return Vec::new();
    };
    let mut found: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_name().to_str().is_some_and(|n| pumi_lang::format::fnmatch(name, n, false)))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found
}

/// `source-file [-Fnqv] [-t target] path…`: runs a file of commands (`~/.tmux.conf`).
pub fn source_file(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let mut all = Vec::new();
    for word in p.words() {
        let word = if p.has('F') {
            let k = kernel(cx);
            let pane = k.current(&queue.caller).map(|c| c.pane);
            expand(k, queue, None, None, pane, &word)
        } else {
            word
        };
        let files = glob(&path(queue, &word));
        if files.is_empty() && !p.has('q') {
            return Err(Error::not_found(format!("{word}: no such file or directory")));
        }
        for file in files {
            // A Lua file runs in the server's VM (Neovim's `:source x.lua`); the commands before it
            // run first.
            if file.extension().is_some_and(|e| e == "lua") {
                if p.has('n') {
                    continue;
                }
                if !all.is_empty() {
                    let mut rest = std::mem::take(&mut all);
                    rest.push(pumi_lang::cmd::Command {
                        name: "source-file".into(),
                        args: vec![pumi_lang::cmd::Arg::String(file.display().to_string())],
                        line: 0,
                    });
                    return Ok(Flow::Insert(rest));
                }
                let name = format!("@{}", file.display());
                return crate::lua::run_for_queue(cx, queue, None, Some(&file), &name);
            }
            let text = match std::fs::read_to_string(&file) {
                Ok(text) => text,
                Err(_) if p.has('q') => continue,
                Err(err) => return Err(Error::not_found(format!("{}: {err}", file.display()))),
            };
            let list = crate::cmd::parse_text(cx, queue, &text)
                .map_err(|err| Error::invalid_params(format!("{}:{}", file.display(), err.message)))?;
            if p.has('v') {
                for command in &list {
                    queue.print(format!("{}:{}: {}", file.display(), command.line, pumi_lang::cmd::print(command)));
                }
            }
            all.extend(list);
        }
    }
    if p.has('n') {
        return Ok(Flow::Next);
    }
    Ok(Flow::Insert(all))
}

/// `display-message [-alNpv] [-c client] [-d delay] [-F format] [-t target] [message]`: `-p`
/// prints it; otherwise it is shown to the user.
pub fn display_message(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let pane = target_pane(cx, p.get('t')).ok();
    let k = kernel(cx);
    if p.has('a') {
        let names = [
            "session_name",
            "session_id",
            "window_index",
            "window_name",
            "window_id",
            "pane_index",
            "pane_id",
            "pane_current_path",
            "pane_current_command",
            "pane_pid",
            "pane_width",
            "pane_height",
            "pane_title",
            "pane_type",
            "socket_path",
            "pid",
            "version",
            "host",
        ];
        for name in names {
            let value = expand(k, queue, None, None, pane, &format!("#{{{name}}}"));
            queue.print(format!("{name}={value}"));
        }
        return Ok(Flow::Next);
    }
    let template = p.arg(0).or(p.get('F')).unwrap_or(DISPLAY_MESSAGE).to_string();
    let message = if p.has('l') { template } else { expand_time(k, queue, None, None, pane, &template) };
    let printed = p.has('p') || (queue.interactive && !k.chans.values().any(|c| c.ui.is_some()));
    if printed {
        queue.print(message);
    } else {
        call(cx, "pumi_notify", json!([message, "info", {}]))?;
    }
    Ok(Flow::Next)
}
