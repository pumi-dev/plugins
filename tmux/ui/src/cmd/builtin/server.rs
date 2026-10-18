//! The server and its clients: `start-server`, `kill-server`, `attach-session`,
//! `detach-client`, `switch-client`, `list-clients`, `refresh-client`, `show-messages`,
//! `list-commands`, and Neovim's `checkhealth`, `help`, `lua`, `pack`, `restart`.

use serde_json::{Value, json};

use pumi_api::{Caller, Cx, Error, Result};
use pumi_lang::cmd::Parsed;
use pumi_lang::target::Kind;

use super::{call, kernel};
use crate::cmd::Cmd;
use crate::cmd::{Flow, Queue, expand, target};
use crate::kernel::ChanId;

pub const LIST_CLIENTS: &str =
    "#{client_name}: #{session_name} [#{client_width}x#{client_height} #{client_termname}] (#{client_flags})";

pub fn start_server(_: &mut Cx, _: &mut Queue, _: &Parsed) -> Result<Flow> {
    Ok(Flow::Next)
}

pub fn kill_server(cx: &mut Cx, _: &mut Queue, _: &Parsed) -> Result<Flow> {
    call(cx, "pumi_kill_server", json!([]))?;
    Ok(Flow::Next)
}

/// The client a command acts on: `-c` (`client3` or `3`), the caller when it is one, else the
/// client used last.
fn client(cx: &mut Cx, flag: Option<&str>) -> Result<ChanId> {
    let caller = cx.caller().channel;
    let k = kernel(cx);
    let uis: Vec<ChanId> = k.chans.values().filter(|c| c.ui.is_some()).map(|c| c.id).collect();
    if let Some(name) = flag {
        let id = name.trim_start_matches("client").parse::<u64>().ok();
        return k
            .chans
            .values()
            .find(|c| c.ui.is_some() && (Some(c.id) == id || c.info.name == name))
            .map(|c| c.id)
            .ok_or_else(|| Error::not_found(format!("can't find client: {name}")));
    }
    if uis.contains(&caller) {
        return Ok(caller);
    }
    let last = uis
        .iter()
        .copied()
        .max_by_key(|c| k.chans[c].ui.as_ref().and_then(|u| k.sessions.get(&u.session)).map_or(0, |s| s.activity));
    last.ok_or_else(|| Error::not_found("no current client"))
}

fn as_client(cx: &mut Cx, client: ChanId, name: &str, args: Value) -> Result<Value> {
    let caller = Caller { channel: client, ..Caller::default() };
    cx.as_caller(&caller, |cx| cx.call(name, args))
}

/// `attach-session [-dErx] [-c dir] [-t session]`: a client shows the session. The app attaches
/// a window; from a shell, the client used last switches to it.
pub fn attach_session(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = target(cx, p.get('t'), Kind::Session)?.session;
    let client =
        client(cx, None).map_err(|_| Error::not_found("no client to attach: open pumi, or run new-session -d"))?;
    as_client(cx, client, "pumi_set_current_session", json!([session]))?;
    if let Some(pane) = p.get('t').and_then(|_| target(cx, p.get('t'), Kind::Pane).ok()).and_then(|f| f.pane) {
        as_client(cx, client, "pumi_set_current_pane", json!([pane]))?;
    }
    let k = kernel(cx);
    k.send(client, pumi_api::rpc::notification("pumi_attach", json!([session])));
    Ok(Flow::Next)
}

/// `detach-client [-aP] [-E command] [-s session] [-t client]`.
pub fn detach_client(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let k = kernel(cx);
    let uis: Vec<(ChanId, u64)> = k.chans.values().filter_map(|c| c.ui.as_ref().map(|u| (c.id, u.session))).collect();
    let doomed: Vec<ChanId> = if let Some(session) = p.get('s') {
        let session = target(cx, Some(session), Kind::Session)?.session;
        uis.iter().filter(|(_, s)| *s == session).map(|(c, _)| *c).collect()
    } else {
        let one = client(cx, p.get('t'))?;
        if p.has('a') { uis.iter().map(|(c, _)| *c).filter(|c| *c != one).collect() } else { vec![one] }
    };
    for client in doomed {
        kernel(cx).send(client, pumi_api::rpc::notification("pumi_detach", json!([])));
        as_client(cx, client, "pumi_ui_detach", json!([]))?;
    }
    Ok(Flow::Next)
}

/// `switch-client [-ElnprZ] [-c client] [-t target] [-T key-table]`.
pub fn switch_client(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let client = client(cx, p.get('c'))?;
    if let Some(table) = p.get('T') {
        as_client(
            cx,
            client,
            "pumi_set_option_value",
            json!(["key_table", table, {"scope": "client", "client": client}]),
        )?;
        return Ok(Flow::Next);
    }
    let k = kernel(cx);
    let current = k.chans[&client].ui.as_ref().map(|u| u.session).unwrap_or(0);
    let mut order: Vec<(String, u64)> = k.sessions.values().map(|s| (s.name.clone(), s.id)).collect();
    order.sort();
    let at = order.iter().position(|(_, id)| *id == current);
    let session = if p.has('n') || p.has('p') {
        let n = order.len() as i64;
        let by = if p.has('n') { 1 } else { -1 };
        let at = at.map_or(0, |a| a as i64);
        order
            .get(((at + by).rem_euclid(n.max(1))) as usize)
            .map(|(_, id)| *id)
            .ok_or_else(|| Error::not_found("no sessions"))?
    } else if p.has('l') {
        k.sessions
            .values()
            .filter(|s| s.id != current)
            .max_by_key(|s| s.activity)
            .map(|s| s.id)
            .ok_or_else(|| Error::not_found("no last session"))?
    } else {
        let found = target(cx, p.get('t'), Kind::Pane).or_else(|_| target(cx, p.get('t'), Kind::Session))?;
        if let Some(pane) = found.pane.filter(|_| p.get('t').is_some_and(|t| t.contains(['.', '%', ':'])))
            && found.tab.is_some()
        {
            as_client(cx, client, "pumi_set_current_session", json!([found.session]))?;
            as_client(cx, client, "pumi_set_current_pane", json!([pane]))?;
            return Ok(Flow::Next);
        }
        found.session
    };
    as_client(cx, client, "pumi_set_current_session", json!([session]))?;
    Ok(Flow::Next)
}

/// `list-clients [-r] [-F format] [-f filter] [-t session] [--json]`.
pub fn list_clients(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let session = p.get('t').map(|t| target(cx, Some(t), Kind::Session)).transpose()?.map(|f| f.session);
    let k = kernel(cx);
    let format = p.get('F').unwrap_or(LIST_CLIENTS).to_string();
    let mut clients: Vec<(ChanId, u64)> =
        k.chans.values().filter_map(|c| c.ui.as_ref().map(|u| (c.id, u.session))).collect();
    if p.has('r') {
        clients.reverse();
    }
    for (client, s) in clients {
        if session.is_some_and(|want| want != s) {
            continue;
        }
        let mut fmt = crate::kernel::format::Fmt::new(k, Some(s).filter(|s| k.sessions.contains_key(s)), None, None);
        fmt.client = Some(client);
        fmt.extra = Some(&queue.vars);
        if let Some(filter) = p.get('f')
            && !crate::cmd::truthy(&pumi_lang::format::expand(&fmt, filter))
        {
            continue;
        }
        let line = if p.has_long("json") {
            let info = &k.chans[&client];
            json!({ "client": client, "name": info.info.name, "session": s, "width": info.ui.as_ref().map(|u| u.width), "height": info.ui.as_ref().map(|u| u.height) }).to_string()
        } else {
            pumi_lang::format::expand(&fmt, &format)
        };
        queue.print(line);
    }
    Ok(Flow::Next)
}

/// `refresh-client [-cDlLRSU] [-C size] [-t client] …`: `-C WxH` sets a client's size.
pub fn refresh_client(cx: &mut Cx, _queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    if let Some(size) = p.get('C') {
        let client = client(cx, p.get('t'))?;
        let (w, h) =
            size.split_once(['x', ',']).ok_or_else(|| Error::invalid_params(format!("bad size argument: {size}")))?;
        let (w, h): (u32, u32) = (
            w.parse().map_err(|_| Error::invalid_params("bad width"))?,
            h.parse().map_err(|_| Error::invalid_params("bad height"))?,
        );
        as_client(cx, client, "pumi_ui_try_resize", json!([w, h]))?;
    }
    Ok(Flow::Next)
}

/// `show-messages [-JT] [-t client]`: the server's message log.
pub fn show_messages(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    if p.has('J') || p.has('T') {
        let k = kernel(cx);
        queue.print(format!("pumi {} (tmux runs in the app)", crate::kernel::version()));
        queue.print(format!("socket {}", k.config.socket.display()));
        return Ok(Flow::Next);
    }
    // The host's (notifications, Lua's errors) and pumi-tmux's own (errors in queues), in order.
    let mut messages: Vec<crate::kernel::Message> =
        call(cx, "pumi_list_messages", json!([])).ok().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    messages.extend(kernel(cx).messages.iter().cloned());
    messages.sort_by_key(|m| m.at);
    let lines: Vec<String> = messages
        .iter()
        .map(|m| {
            let at = local_time(m.at);
            if m.level == "info" { format!("{at}: {}", m.text) } else { format!("{at}: [{}] {}", m.level, m.text) }
        })
        .collect();
    for line in lines {
        queue.print(line);
    }
    Ok(Flow::Next)
}

/// A time as `show-messages` prints it, in local time: tmux's `#{t:…}`, which pumi-lang
/// formats (the C library's `strftime` is not this guest's to call).
fn local_time(secs: u64) -> String {
    let vars = pumi_lang::format::Vars::new([("at", secs.to_string())]);
    pumi_lang::format::expand(&vars, "#{t:at}")
}

/// `list-commands [-F format] [command]`.
pub fn list_commands(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let commands = call(cx, "pumi_get_commands", json!([{}]))?;
    let format = p.get('F').map(str::to_string);
    for (name, info) in commands.as_object().cloned().unwrap_or_default() {
        if p.arg(0).is_some_and(|want| {
            want != name && !info["aliases"].as_array().is_some_and(|a| a.iter().any(|x| x == want))
        }) {
            continue;
        }
        let alias =
            info["aliases"].as_array().and_then(|a| a.iter().filter_map(Value::as_str).next_back()).map(str::to_string);
        let usage = info["usage"].as_str().unwrap_or("").to_string();
        match &format {
            Some(format) => {
                let mut vars = queue.vars.clone();
                vars.insert("command_list_name".into(), name.clone());
                vars.insert("command_list_alias".into(), alias.clone().unwrap_or_default());
                vars.insert("command_list_usage".into(), usage.clone());
                let shadow = Queue { vars, ..super::shell(queue) };
                let line = expand(kernel(cx), &shadow, None, None, None, format);
                queue.print(line);
            }
            None => match alias {
                Some(alias) => queue.print(format!("{name} ({alias}) {usage}").trim_end()),
                None => queue.print(format!("{name} {usage}").trim_end()),
            },
        }
    }
    Ok(Flow::Next)
}

/// `lua CODE` (Neovim's `:lua`): runs in the server's VM; what it prints is the output.
/// `lua =EXPR` prints the values.
pub fn lua(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let code = p.words().join(" ");
    let code = match code.trim_start().strip_prefix('=') {
        Some(expr) => format!(
            "local function show(...) for i = 1, select('#', ...) do print(pumi.inspect((select(i, ...)))) end end\nshow({expr})"
        ),
        None => code,
    };
    crate::lua::run_for_queue(cx, queue, Some(&code), None, "=lua")
}

/// `pack add|update|del|list|info|disable|enable|reload|search [-y] [name …]` (07 §3): the
/// `pumi_pack_*` functions, printed. `update` shows what would change; `-y` applies it.
pub fn pack(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let words: Vec<String> = p.words().iter().map(|w| lua_string(w)).collect();
    let code = format!("require('pumi.pack')._cmd({{{}}})", words.join(", "));
    crate::lua::run_for_queue(cx, queue, Some(&code), None, "=pack")
}

/// `packadd name` (Neovim's `:packadd`): an installed package, or a `pack/*/opt/<name>` under the
/// runtimepath, loads.
pub fn packadd(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let name = p.arg(0).unwrap_or_default();
    let code = format!("require('pumi.pack').load({})", lua_string(name));
    crate::lua::run_for_queue(cx, queue, Some(&code), None, "=packadd")
}

/// `text` as a Lua long string, whatever it holds.
pub(crate) fn lua_string(text: &str) -> String {
    let mut level = 0;
    while text.contains(&format!("]{}]", "=".repeat(level))) || text.ends_with(&format!("]{}", "=".repeat(level))) {
        level += 1;
    }
    let eq = "=".repeat(level);
    // A long string drops a newline that starts it; one more keeps it.
    let lead = if text.starts_with('\n') { "\n" } else { "" };
    format!("[{eq}[{lead}{text}]{eq}]")
}

pub fn restart(_: &mut Cx, _: &mut Queue, _: &Parsed) -> Result<Flow> {
    Err(Error::invalid_params("restart comes with the client rewrite (phase 4); kill-server stops the server"))
}

/// `checkhealth [section]` (Neovim's `:checkhealth`): what the server is, and what is wrong.
pub fn checkhealth(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let functions = crate::api::functions(cx).len();
    let k = kernel(cx);
    let ok = |q: &mut Queue, text: String| q.print(format!("- OK {text}"));
    let warn = |q: &mut Queue, text: String| q.print(format!("- WARNING {text}"));
    queue.print("pumi: server");
    ok(
        queue,
        format!(
            "pumi {}, tmux in the app, API level {}",
            crate::kernel::version(),
            pumi_api::API_LEVEL
        ),
    );
    ok(queue, format!("socket {}", k.config.socket.display()));
    ok(queue, format!("the core's data in {}", k.config.data.display()));
    ok(queue, format!("{} sessions, {} tabs, {} panes", k.sessions.len(), k.tabs.len(), k.panes.len()));
    ok(
        queue,
        format!(
            "{functions} functions, {} commands, {} user commands",
            crate::cmd::table::ENTRIES.len(),
            k.cmd().user.len()
        ),
    );
    match &k.config.bin_dir {
        Some(dir) if dir.join("pumi").exists() => ok(queue, format!("the pumi CLI is in {}", dir.display())),
        Some(dir) => warn(queue, format!("no pumi CLI in {}: panes cannot run pumi or tmux", dir.display())),
        None => warn(queue, "no bin directory: panes cannot run pumi or tmux".into()),
    }
    let shell = k.global_option("default_shell");
    if let Some(shell) = shell.as_str().filter(|s| !s.is_empty())
        && !std::path::Path::new(shell).exists()
    {
        warn(queue, format!("default-shell {shell} does not exist"));
    }
    let errors: Vec<String> =
        k.messages.iter().rev().filter(|m| m.level == "error").take(5).map(|m| m.text.clone()).collect();
    if errors.is_empty() {
        ok(queue, "no errors in show-messages".into());
    }
    for error in errors {
        warn(queue, error);
    }
    // Lua's, and every package's `lua/<name>/health.lua`.
    let report = crate::lua::eval(cx, &lua_health(p.arg(0)));
    match report {
        Ok(Value::String(text)) => {
            for line in text.lines() {
                queue.print(line);
            }
        }
        Ok(_) => {}
        Err(err) => queue.print(format!("\npumi: Lua\n- ERROR {}", err.message)),
    }
    Ok(Flow::Next)
}

/// The Lua that runs the health checks: pumi's own, then the packages' (or the one named).
fn lua_health(name: Option<&str>) -> String {
    let names = match name {
        Some(name) => {
            let mut quoted = String::new();
            super::pumi::lua_value(&serde_json::json!([name]), &mut quoted);
            quoted
        }
        None => "nil".into(),
    };
    format!(
        r#"local h = pumi.health
local names = {names}
local own = ''
if names == nil or names[1] == 'lua' then
  local lines = {{ '', 'pumi: Lua', '- OK ' .. (jit and jit.version or _VERSION) }}
  for _, dir in ipairs(pumi.runtimepath()) do
    lines[#lines + 1] = '- runtimepath: ' .. dir
  end
  own = table.concat(lines, '\n')
end
return own .. '\n' .. pumi.health._run(names)"#
    )
}

/// `help [topic]`: a function, a command, an option or an event.
pub fn help(cx: &mut Cx, queue: &mut Queue, p: &Parsed) -> Result<Flow> {
    let Some(topic) = p.arg(0) else {
        queue.print("pumi help TOPIC: a command (split-pane), a function (pumi_open_pane), an option (remain-on-exit) or an event (TermClose).");
        queue.print("pumi list-commands, pumi api list, pumi show -g, pumi help agents.");
        return Ok(Flow::Next);
    };
    if topic == "agents" {
        queue.print(super::pumi::AGENTS_GUIDE);
        return Ok(Flow::Next);
    }
    if let Some(info) = crate::api::function_info(cx, topic) {
        queue.print(format!(
            "{}  ({}, {})",
            info.name,
            info.provider,
            match info.effect {
                pumi_api::Effect::Read => "read",
                pumi_api::Effect::Write => "write",
                pumi_api::Effect::Forward => "forward",
            }
        ));
        queue.print(&info.desc);
        for example in &info.examples {
            queue.print(format!("  pumi call {} '{}'", info.name, example.args));
        }
        return Ok(Flow::Next);
    }
    let k = kernel(cx);
    if let Ok(crate::cmd::Found2::Builtin(entry)) = crate::cmd::find(k, topic) {
        queue.print(format!("usage: {} {}", entry.name, entry.usage));
        if !entry.aliases.is_empty() {
            queue.print(format!("aliases: {}", entry.aliases.join(", ")));
        }
        if !entry.desc.is_empty() {
            queue.print(entry.desc);
        }
        return Ok(Flow::Next);
    }
    if let Some(decl) = k.options.decl(topic) {
        queue.print(
            format!(
                "{} ({:?}, {:?}, default {})",
                super::option::tmux_name(&decl.name),
                decl.ty,
                decl.scope,
                decl.default
            )
            .to_lowercase(),
        );
        queue.print(&decl.desc);
        return Ok(Flow::Next);
    }
    if crate::kernel::events::EVENTS.contains(&topic) {
        queue.print(format!(
            "{topic}: an event; `pumi events {topic}` shows it as it fires, `autocmd {topic} * …` acts on it."
        ));
        return Ok(Flow::Next);
    }
    Err(Error::not_found(format!("no help for {topic}")))
}
