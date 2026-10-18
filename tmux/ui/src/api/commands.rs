//! Commands, user commands, paste buffers and the environment (02 §2, "Pane types, functions,
//! commands"). Commands are tmux's language; these are the functions every surface reaches them
//! by. Key maps are the host's (it resolves keys): `bind-key` calls `pumi_set_keymap`. Their
//! descriptions and examples are `specs.json`'s; `super::handler` calls them.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use pumi_api::{Cx, Error, Result};
use pumi_lang::cmd::{Arg, Command};

use super::kernel;
use crate::cmd::{self, Buffer, Cmd, Start, UserCommand, Var};

/// Where and how a command line runs.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CmdOpts {
    /// The directory relative paths are in: the CLI's.
    #[serde(default)]
    pub cwd: Option<String>,
    /// The pane it is about, as if run from there.
    #[serde(default)]
    pub pane: Option<u64>,
    /// Format variables for it (`hook_pane`, …).
    #[serde(default)]
    pub vars: BTreeMap<String, String>,
}

/// What a command line printed, and the status of a program it waited for (`wait-pane`,
/// `new-pane -W`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct CmdResult {
    pub output: String,
    pub status: Option<i32>,
    /// The call returned before the commands ended (it was made inside another call).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub waiting: bool,
}

/// One command as data: Neovim's `nvim_cmd` table, as `pumi_parse_cmd` gives it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CmdTable {
    /// The command; its flags and positional arguments follow.
    pub cmd: String,
    /// `{"t": "%3", "h": true}`; a flag given twice is a list.
    #[serde(default)]
    pub flags: BTreeMap<String, Value>,
    /// `{"type": "browser"}`: long options.
    #[serde(default)]
    pub long: BTreeMap<String, Value>,
    #[serde(default)]
    pub args: Vec<Arg>,
    /// Instead of `flags`, `long` and `args`: the arguments exactly as a shell split them, for
    /// the server to read (what the CLI sends).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<Vec<Arg>>,
}

impl CmdTable {
    fn to_command(&self) -> Command {
        if let Some(raw) = &self.raw {
            return Command { name: self.cmd.clone(), args: raw.clone(), line: 0 };
        }
        let mut args = Vec::new();
        for (flag, value) in &self.flags {
            let values = match value {
                Value::Array(list) => list.clone(),
                other => vec![other.clone()],
            };
            for value in values {
                match value {
                    Value::Bool(true) => args.push(Arg::String(format!("-{flag}"))),
                    Value::Bool(false) | Value::Null => {}
                    Value::String(s) => {
                        args.push(Arg::String(format!("-{flag}")));
                        args.push(Arg::String(s));
                    }
                    other => {
                        args.push(Arg::String(format!("-{flag}")));
                        args.push(Arg::String(match other {
                            Value::Number(n) => n.to_string(),
                            o => o.to_string(),
                        }));
                    }
                }
            }
        }
        for (name, value) in &self.long {
            match value {
                Value::Bool(true) => args.push(Arg::String(format!("--{name}"))),
                Value::Bool(false) | Value::Null => {}
                Value::String(s) => args.push(Arg::String(format!("--{name}={s}"))),
                other => args.push(Arg::String(format!("--{name}={other}"))),
            }
        }
        if !self.args.is_empty() {
            args.push(Arg::String("--".into()));
            args.extend(self.args.iter().cloned());
        }
        Command { name: self.cmd.clone(), args, line: 0 }
    }
}

/// Commands as data: a string is the command language; a table, or a list of them, is
/// `pumi_parse_cmd`'s shape.
fn commands(cx: &mut Cx, cmd: Value, queue: &cmd::Queue) -> Result<Vec<Command>> {
    match cmd {
        Value::String(text) => cmd::parse_text(cx, queue, &text),
        Value::Array(list) => list
            .into_iter()
            .map(|item| {
                let table: CmdTable = pumi_api::from_value(item, "a command")?;
                Ok(table.to_command())
            })
            .collect(),
        object @ Value::Object(_) => {
            let table: CmdTable = pumi_api::from_value(object, "a command")?;
            Ok(vec![table.to_command()])
        }
        other => Err(Error::invalid_params(format!("a command is a string or a table, not {other}"))),
    }
}

fn run(cx: &mut Cx, cmd: Value, opts: CmdOpts, interactive: bool) -> Result<CmdResult> {
    let mut caller = cx.caller().clone();
    if let Some(pane) = opts.pane {
        let (c, k) = kernel(cx)?;
        caller.pane = Some(k.pane_id(&c, pane)?);
    }
    let shadow = cmd::Queue {
        id: 0,
        caller: caller.clone(),
        cwd: None,
        vars: opts.vars.clone(),
        items: Default::default(),
        output: String::new(),
        status: None,
        reply: None,
        interactive,
    };
    let list = commands(cx, cmd, &shadow)?;
    let start = Start { caller: caller.clone(), cwd: opts.cwd.map(PathBuf::from), vars: opts.vars, interactive };
    // The commands' own calls are not the request: only the queue answers it later.
    let rpc = kernel(cx)?.1.rpc.take();
    let started = cmd::start(cx, list, start);
    kernel(cx)?.1.rpc = rpc;
    let (queue, mut result) = started?;
    if result.is_none() {
        // The app answers when this returns, not later: the jobs the queue waits on run now,
        // and a queue that still waits (on an event, a timer, `wait-for`) goes on without a
        // caller, as one started inside another call did.
        result = cmd::drive(cx, queue);
    }
    let value = cmd::into_result(result)?;
    pumi_api::from_value(value, "a command's result")
}

/// Run commands (Neovim's `nvim_cmd`, tmux's command line): a string in tmux's language
/// (`"split-pane -h ; select-pane -L"`), or `pumi_parse_cmd`'s tables. Returns what they printed.
/// A command that waits (`run-shell`, `wait-for`, `new-pane -W`) holds the reply until it ends.
pub fn pumi_cmd(cx: &mut Cx, cmd: Value, opts: Option<CmdOpts>) -> Result<CmdResult> {
    run(cx, cmd, opts.unwrap_or_default(), true)
}

/// Run a script of commands, one or more lines with `%if` and `NAME=value` (Neovim's
/// `nvim_exec2`, tmux's `source-file` on a string).
pub fn pumi_exec2(cx: &mut Cx, src: String, opts: Option<CmdOpts>) -> Result<CmdResult> {
    run(cx, Value::String(src), opts.unwrap_or_default(), true)
}

/// Parse a command line into tables (Neovim's `nvim_parse_cmd`): each command's name as the
/// server knows it, its flags and its arguments. A list, since a line may hold several.
pub fn pumi_parse_cmd(cx: &mut Cx, str: String, opts: Option<Value>) -> Result<Vec<CmdTable>> {
    let _ = opts;
    let list = pumi_lang::cmd::parse_str(&str, &mut pumi_lang::cmd::NoEnv)?;
    let (_, k) = kernel(cx)?;
    let mut out = Vec::new();
    for command in list {
        match cmd::find(k, &command.name)? {
            cmd::Found2::Builtin(entry) => {
                let mut longs: Vec<(&str, pumi_lang::cmd::Long)> = entry.longs.to_vec();
                longs.extend(pumi_lang::cmd::COMMON_LONGS.iter().copied());
                let parsed = if entry.raw {
                    pumi_lang::cmd::Parsed { args: command.args.clone(), ..Default::default() }
                } else {
                    pumi_lang::cmd::parse_args(entry.template, entry.min, entry.max, &longs, &command.args)?
                };
                let value = parsed.to_value();
                out.push(CmdTable {
                    cmd: entry.name.into(),
                    flags: pumi_api::from_value(value["flags"].clone(), "flags")?,
                    long: pumi_api::from_value(value["long"].clone(), "long options")?,
                    args: parsed.args,
                    raw: None,
                });
            }
            cmd::Found2::User(user) => out.push(CmdTable {
                cmd: user.name,
                flags: BTreeMap::new(),
                long: BTreeMap::new(),
                args: command.args,
                raw: None,
            }),
            cmd::Found2::Alias(list) => {
                for command in list {
                    out.push(CmdTable {
                        cmd: command.name,
                        flags: BTreeMap::new(),
                        long: BTreeMap::new(),
                        args: command.args,
                        raw: None,
                    });
                }
            }
        }
    }
    Ok(out)
}

/// A command as `pumi_get_commands` describes it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct CommandInfo {
    pub name: String,
    pub aliases: Vec<String>,
    pub usage: String,
    pub desc: String,
    /// tmux's flag template: `t:` takes a value, `t::` an optional one.
    pub flags: String,
    pub long: Vec<String>,
    pub min: i32,
    pub max: i32,
    /// A user command (Neovim's `:command`), and what it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<UserCommand>,
}

/// Which commands `pumi_get_commands` lists.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CommandsOpts {
    /// Include the built-in commands; `true` by default (Neovim's `builtin`).
    #[serde(default)]
    pub builtin: Option<bool>,
}

/// Every command, built-in and user, by name: what the CLI's `--help`, completion and
/// `list-commands` read.
pub fn pumi_get_commands(cx: &mut Cx, opts: Option<CommandsOpts>) -> Result<BTreeMap<String, CommandInfo>> {
    let (_, k) = kernel(cx)?;
    let mut out = BTreeMap::new();
    if opts.unwrap_or_default().builtin != Some(false) {
        for entry in cmd::table::ENTRIES {
            let mut long: Vec<String> = entry.longs.iter().map(|(n, _)| n.to_string()).collect();
            long.extend(pumi_lang::cmd::COMMON_LONGS.iter().map(|(n, _)| n.to_string()));
            out.insert(
                entry.name.to_string(),
                CommandInfo {
                    name: entry.name.into(),
                    aliases: entry.aliases.iter().map(|a| a.to_string()).collect(),
                    usage: entry.usage.into(),
                    desc: entry.desc.into(),
                    flags: entry.template.into(),
                    long,
                    min: entry.min,
                    max: entry.max,
                    user: None,
                },
            );
        }
    }
    for user in k.cmd().user.values() {
        out.insert(
            user.name.clone(),
            CommandInfo {
                name: user.name.clone(),
                aliases: Vec::new(),
                usage: match user.nargs.as_str() {
                    "0" => String::new(),
                    "1" => "arg".into(),
                    "?" => "[arg]".into(),
                    _ => "[args…]".into(),
                },
                desc: user.desc.clone(),
                flags: String::new(),
                long: Vec::new(),
                min: 0,
                max: -1,
                user: Some(user.clone()),
            },
        );
    }
    Ok(out)
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UserCommandOpts {
    /// How many arguments it takes: `0` (the default), `1`, `*`, `?` or `+` (Neovim's).
    #[serde(default)]
    pub nargs: Option<Value>,
    #[serde(default)]
    pub desc: Option<String>,
    /// Replace a command of that name (Neovim's `force`, `true` by default).
    #[serde(default)]
    pub force: Option<bool>,
    /// The function it calls instead of a command line; its flags are the function's parameters
    /// (`--name value`, `name=value`, or in order).
    #[serde(default)]
    pub call: Option<String>,
    /// The function it calls with `{name, args, fargs, bang}`, as Neovim calls a Lua callback
    /// (the host makes one of a Lua function given as `command`).
    #[serde(default)]
    pub callback: Option<String>,
}

/// What a user command runs: a command line, or a Lua function (`{"luaref": n}`, which the
/// host holds: from Lua, the host turns it into `opts.callback`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum CommandBody {
    Line(String),
    Lua(LuaRef),
}

/// A Lua function the host's VM keeps.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LuaRef {
    pub luaref: u64,
}

/// Create a user command (Neovim's `nvim_create_user_command`): its name is Capitalised, so it
/// never collides with a built-in. `command` is a command line, with `<args>`, `<q-args>`,
/// `<f-args>` and `<bang>` replaced; a Lua function, called with `{name, args, fargs, bang}`;
/// or `null` with `opts.call` naming a function.
pub fn pumi_create_user_command(
    cx: &mut Cx,
    name: String,
    command: Option<CommandBody>,
    opts: Option<UserCommandOpts>,
) -> Result<()> {
    let opts = opts.unwrap_or_default();
    if !name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
    {
        return Err(Error::invalid_params(format!("a user command is Capitalised and alphanumeric: {name}")));
    }
    if command.is_none() && opts.call.is_none() && opts.callback.is_none() {
        return Err(Error::invalid_params("a user command needs a command line or `call`"));
    }
    if let Some(CommandBody::Lua(_)) = command {
        return Err(Error::invalid_params("a Lua function is the host's: give it from Lua"));
    }
    if let Some(call) = &opts.call
        && crate::api::function_info(cx, call).is_none()
    {
        return Err(Error::not_found(format!("no function `{call}`")));
    }
    let nargs = match opts.nargs {
        None => if opts.call.is_some() { "*" } else { "0" }.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) if ["0", "1", "*", "?", "+"].contains(&s.as_str()) => s,
        Some(other) => return Err(Error::invalid_params(format!("nargs is 0, 1, *, ? or +, not {other}"))),
    };
    let (caller, k) = kernel(cx)?;
    if opts.force == Some(false) && k.cmd().user.contains_key(&name) {
        return Err(Error::invalid_params(format!("command {name} exists")));
    }
    let source = k.source(&caller);
    let desc = opts.desc.unwrap_or_default();
    let command = match command {
        Some(CommandBody::Line(line)) => Some(line),
        _ => None,
    };
    let callback = opts.callback;
    k.cmd().user.insert(name.clone(), UserCommand { name, command, call: opts.call, callback, nargs, desc, source });
    Ok(())
}

/// Delete a user command (Neovim's `nvim_del_user_command`).
pub fn pumi_del_user_command(cx: &mut Cx, name: String) -> Result<()> {
    let (_, k) = kernel(cx)?;
    k.cmd().user.remove(&name).map(|_| ()).ok_or_else(|| Error::not_found(format!("no user command {name}")))
}

// ---- paste buffers

/// Every paste buffer, newest first (tmux's `list-buffers`).
pub fn pumi_list_buffers(cx: &mut Cx) -> Result<Vec<Buffer>> {
    let (_, k) = kernel(cx)?;
    let mut buffers = k.cmd().buffers.clone();
    buffers.sort_by_key(|b| std::cmp::Reverse(b.order));
    Ok(buffers)
}

/// A paste buffer by name; `null` is the newest (tmux's `show-buffer`).
pub fn pumi_get_buffer(cx: &mut Cx, name: Option<String>) -> Result<Buffer> {
    let (_, k) = kernel(cx)?;
    k.cmd().buffer(name.as_deref()).cloned().ok_or_else(|| match name {
        Some(name) => Error::not_found(format!("no buffer {name}")),
        None => Error::not_found("no buffers"),
    })
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SetBufferOpts {
    /// Add to its end (`set-buffer -a`).
    #[serde(default)]
    pub append: bool,
}

/// Set a paste buffer; without a name it is a new automatic one (`buffer0`, …), the oldest of
/// which go past `buffer-limit`. Returns its name.
pub fn pumi_set_buffer(cx: &mut Cx, name: Option<String>, data: String, opts: Option<SetBufferOpts>) -> Result<String> {
    let opts = opts.unwrap_or_default();
    let (_, k) = kernel(cx)?;
    let limit = k.global_option("buffer_limit").as_u64().unwrap_or(50) as usize;
    let data = match (&name, opts.append) {
        (Some(n), true) => format!("{}{data}", k.cmd().buffer(Some(n)).map(|b| b.data.as_str()).unwrap_or("")),
        (None, true) => {
            let newest = k.cmd().buffer(None).cloned();
            if let Some(newest) = newest {
                let joined = format!("{}{data}", newest.data);
                return Ok(k.cmd().set_buffer(Some(newest.name), joined, limit));
            }
            data
        }
        _ => data,
    };
    Ok(k.cmd().set_buffer(name, data, limit))
}

/// Delete a paste buffer; `null` is the newest.
pub fn pumi_del_buffer(cx: &mut Cx, name: Option<String>) -> Result<()> {
    let (_, k) = kernel(cx)?;
    let name = k.cmd().buffer(name.as_deref()).map(|b| b.name.clone()).ok_or_else(|| Error::not_found("no buffer"))?;
    k.cmd().buffers.retain(|b| b.name != name);
    Ok(())
}

// ---- the environment

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EnvOpts {
    /// A session's environment (`0`: the current one); the global one without it.
    #[serde(default)]
    pub session: Option<u64>,
    /// Hidden: given to panes, not shown by `show-environment` (`-h`).
    #[serde(default)]
    pub hidden: bool,
    /// Removed from new panes' environment, rather than forgotten (`-r`).
    #[serde(default)]
    pub remove: bool,
}

/// tmux's environment, global or a session's: what new panes get over the server's own.
/// `null` values are removed from panes' environments.
pub fn pumi_get_environment(cx: &mut Cx, opts: Option<EnvOpts>) -> Result<BTreeMap<String, Var>> {
    let opts = opts.unwrap_or_default();
    let (caller, k) = kernel(cx)?;
    match opts.session {
        Some(s) => {
            let s = k.session_id(&caller, s)?;
            Ok(k.cmd().env.sessions.get(&s).cloned().unwrap_or_default())
        }
        None => {
            let mut all: BTreeMap<String, Var> = k
                .config
                .base_env
                .iter()
                .map(|(name, value)| (name.clone(), Var { value: Some(value.clone()), hidden: false }))
                .collect();
            all.extend(k.cmd().env.global.clone());
            Ok(all)
        }
    }
}

/// Set an environment variable for new panes (tmux's `set-environment`); `null` forgets it.
pub fn pumi_set_environment(cx: &mut Cx, name: String, value: Option<String>, opts: Option<EnvOpts>) -> Result<()> {
    let opts = opts.unwrap_or_default();
    if name.is_empty() || name.contains('=') {
        return Err(Error::invalid_params(format!("not a variable name: {name:?}")));
    }
    let (caller, k) = kernel(cx)?;
    let vars = match opts.session {
        Some(s) => {
            let s = k.session_id(&caller, s)?;
            k.cmd().env.sessions.entry(s).or_default()
        }
        None => &mut k.cmd().env.global,
    };
    match (value, opts.remove) {
        (_, true) => {
            vars.insert(name, Var { value: None, hidden: opts.hidden });
        }
        (Some(value), false) => {
            vars.insert(name, Var { value: Some(value), hidden: opts.hidden });
        }
        (None, false) => {
            vars.remove(&name);
        }
    }
    Ok(())
}
