//! A job: what runs, where, and what it waits for (docs/v2/04 §2, 23 §6).
//!
//! The waiting is decided here, over [`Facts`] — what a pane says of itself — so the queue's
//! rules can be tested without an app: `cargo test` in this workspace.

use serde_json::Value;

/// What a job waits for, on the pane it named.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum On {
    /// The pane's program reported `done`/`error` (OSC 7501, so an agent's turn), or the
    /// terminal is back at rest — a shell prompt after a plain command.
    Done,
    /// Its shell has the terminal again, and nothing says it is working.
    Idle,
    /// Its program exited (`pane_dead`, `TermClose`).
    Exit,
}

impl On {
    pub fn parse(word: &str) -> Option<Self> {
        Some(match word {
            "" | "done" => On::Done,
            "idle" => On::Idle,
            "exit" => On::Exit,
            _ => return None,
        })
    }

    pub fn word(self) -> &'static str {
        match self {
            On::Done => "done",
            On::Idle => "idle",
            On::Exit => "exit",
        }
    }
}

/// A program's own report (its pane's `@agent_status`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Agent {
    Idle,
    Working,
    Done,
    Blocked,
    Error,
}

impl Agent {
    pub fn parse(word: &str) -> Option<Self> {
        Some(match word {
            "idle" => Agent::Idle,
            "working" => Agent::Working,
            "done" => Agent::Done,
            "blocked" => Agent::Blocked,
            "error" => Agent::Error,
            _ => return None,
        })
    }
}

/// What a pane says of itself, read the way the host keeps it (23 §6, `crates/pumi-host/src/program.rs`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Facts {
    /// Its program exited (`pane_dead`).
    pub dead: bool,
    /// What it reported it is doing (`@agent_status`), if anything.
    pub agent: Option<Agent>,
    /// Its shell has the terminal (`pane_foreground_pgid == pane_pid`).
    pub at_rest: bool,
}

impl Facts {
    pub fn busy(&self) -> bool {
        matches!(self.agent, Some(Agent::Working | Agent::Blocked))
    }

    pub fn finished(&self) -> bool {
        matches!(self.agent, Some(Agent::Done | Agent::Error))
    }

    /// The wait is over.
    pub fn holds(&self, on: On) -> bool {
        match on {
            On::Exit => self.dead,
            On::Idle => self.dead || (self.at_rest && !self.busy()),
            On::Done => self.dead || self.finished() || (self.at_rest && !self.busy()),
        }
    }
}

/// The panes the queue typed a command into, and when: "at rest" is not "its command finished"
/// until it has been seen busy — or until [`Armed::GRACE`] says the command was too quick to see
/// (`true`, `echo hi`), which would otherwise wait for ever.
#[derive(Debug, Default)]
pub struct Armed(std::collections::BTreeMap<u64, u64>);

impl Armed {
    /// How long a pane may stay at rest after being typed into before its command counts as done.
    pub const GRACE: u64 = 2_000;

    pub fn stamp(&mut self, pane: u64, now: u64) {
        self.0.insert(pane, now);
    }

    /// One look at `pane`.
    pub fn observe(&mut self, pane: u64, at_rest: bool, now: u64) {
        let Some(&since) = self.0.get(&pane) else {
            return;
        };
        if !at_rest || now.saturating_sub(since) >= Self::GRACE {
            self.0.remove(&pane);
        }
    }

    /// Whether its command may still be starting.
    pub fn held(&self, pane: u64) -> bool {
        self.0.contains_key(&pane)
    }

    pub fn panes(&self) -> Vec<u64> {
        self.0.keys().copied().collect()
    }

    pub fn forget(&mut self, pane: u64) {
        self.0.remove(&pane);
    }
}

/// Where a job's command runs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Run {
    /// A terminal of its own, as a pane beside the one it waited on.
    New,
    /// `sh -c`, in the app, with no terminal (its output's last line is kept).
    Shell,
    /// Typed into an existing terminal, as `send-keys` does.
    Pane(u64),
}

impl Run {
    /// `"new"`, `"shell"`, or a pane (`"%3"`, `3`).
    pub fn parse(value: &Value) -> Result<Self, String> {
        match value {
            Value::Null => Ok(Run::New),
            Value::String(text) => match text.trim() {
                "" | "new" => Ok(Run::New),
                "shell" => Ok(Run::Shell),
                other => {
                    let target = other.strip_prefix("pane:").unwrap_or(other);
                    match pane_id(&Value::String(target.to_string())) {
                        Some(pane) => Ok(Run::Pane(pane)),
                        None => Err(format!("no place `{other}` (`new`, `shell`, or a pane id)")),
                    }
                }
            },
            Value::Number(_) => pane_id(value)
                .map(Run::Pane)
                .ok_or_else(|| format!("no pane {value}")),
            other => Err(format!("`run` is `new`, `shell` or a pane, not {other}")),
        }
    }
}

/// A `%3`, `3`, `{"pane": 3}`.
pub fn pane_id(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.get("pane").and_then(Value::as_u64))
        .or_else(|| value.get("id").and_then(Value::as_u64))
        .or_else(|| {
            let text = value.as_str()?.trim();
            text.trim_start_matches('%').parse().ok()
        })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum State {
    Waiting,
    /// Running: where, and since when (milliseconds since the epoch).
    Running {
        pane: Option<u64>,
        at: u64,
    },
    Done {
        status: Option<i32>,
        took: u64,
    },
    Failed {
        why: String,
    },
    Cancelled,
}

impl State {
    pub fn running(&self) -> bool {
        matches!(self, State::Running { .. })
    }

    pub fn settled(&self) -> bool {
        matches!(
            self,
            State::Done { .. } | State::Failed { .. } | State::Cancelled
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Job {
    pub id: u64,
    /// What is run, as the shell reads it.
    pub command: String,
    /// What the bar calls it (a `name`, else the command's first line).
    pub label: String,
    /// The pane it waits for, and what it waits for there.
    pub after: Option<(u64, On)>,
    pub run: Run,
    pub cwd: Option<String>,
    pub state: State,
    /// When it was added (milliseconds).
    pub queued: u64,
    /// The pane whose caller added it: where its bar shows it when it waits for nothing.
    pub origin: u64,
    /// The terminal it opened (`Run::New`), to close it when the job is cleared.
    pub opened: Option<u64>,
    /// When it was over (milliseconds): its bar shows it a little longer.
    pub ended: Option<u64>,
    /// The last line a headless job printed.
    pub tail: String,
}

/// How long a job that is over stays in its pane's bar.
pub const RECENT: u64 = 10_000;

impl Job {
    /// `queue.add`'s argument: a command, or a table. `origin` is the pane whose caller added it.
    pub fn parse(id: u64, args: &Value, now: u64, origin: u64) -> Result<Self, String> {
        let spec = match args {
            Value::String(command) => return Self::made(id, command, &Value::Null, now, origin),
            Value::Object(_) => args.clone(),
            Value::Array(list) if list.len() == 1 => return Self::parse(id, &list[0], now, origin),
            Value::Array(list) if list.is_empty() => {
                return Err("queue.add needs a `command`".into());
            }
            other => return Err(format!("queue.add takes a command or a table, not {other}")),
        };
        let command = spec
            .get("command")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .ok_or("queue.add needs a `command`")?;
        Self::made(id, command, &spec, now, origin)
    }

    fn made(id: u64, command: &str, spec: &Value, now: u64, origin: u64) -> Result<Self, String> {
        let after = match spec.get("after") {
            None | Some(Value::Null) => None,
            Some(value) => {
                let (target, on) = match value {
                    Value::Object(map) => (
                        map.get("pane").cloned().unwrap_or(Value::Null),
                        map.get("on").and_then(Value::as_str).unwrap_or("done"),
                    ),
                    other => (other.clone(), "done"),
                };
                let pane = pane_id(&target)
                    .ok_or_else(|| format!("`after` needs a pane (`%3`), not {target}"))?;
                let on = On::parse(on)
                    .ok_or_else(|| format!("no wait `{on}` (`done`, `idle`, `exit`)"))?;
                Some((pane, on))
            }
        };
        let run = Run::parse(spec.get("run").unwrap_or(&Value::Null))?;
        let label = spec
            .get("name")
            .and_then(Value::as_str)
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| first_line(command));
        Ok(Job {
            id,
            command: command.to_string(),
            label,
            after,
            run,
            cwd: spec.get("cwd").and_then(Value::as_str).map(str::to_string),
            state: State::Waiting,
            queued: now,
            origin,
            opened: None,
            ended: None,
            tail: String::new(),
        })
    }

    /// The pane whose bar shows it: the one it waits for, else the one it was added from.
    pub fn home(&self) -> u64 {
        self.after.map(|(pane, _)| pane).unwrap_or(self.origin)
    }

    /// Whether its bar still shows it: while it waits or runs, and a little after it is over.
    pub fn shown(&self, now: u64) -> bool {
        !self.over() || self.ended.is_some_and(|at| now.saturating_sub(at) < RECENT)
    }

    /// What the bar says of it, past the command.
    pub fn detail(&self, now: u64) -> String {
        match &self.state {
            State::Waiting => match self.after {
                Some((pane, on)) => format!("after %{pane} · {}", on.word()),
                None => "next".into(),
            },
            State::Running { pane, at } => {
                let took = clock(now.saturating_sub(*at));
                match pane {
                    Some(pane) => format!("in %{pane} · {took}"),
                    None => format!("running · {took}"),
                }
            }
            State::Done { status, took } => {
                let mark = match status {
                    Some(0) => "ok".to_string(),
                    Some(code) => format!("exit {code}"),
                    None => "closed".to_string(),
                };
                format!("{mark} · {}", clock(*took))
            }
            State::Failed { why } => first_line(why),
            State::Cancelled => "cancelled".into(),
        }
    }

    /// Whether it is over: cleared or not shown.
    pub fn over(&self) -> bool {
        self.state.settled()
    }
}

/// `0:42`, `1:02:03`.
pub fn clock(ms: u64) -> String {
    let seconds = ms / 1000;
    let (m, s) = (seconds / 60, seconds % 60);
    match seconds >= 3600 {
        true => format!("{}:{:02}:{:02}", m / 60, m % 60, s),
        false => format!("{m}:{s:02}"),
    }
}

/// A command's first line, for a bar.
pub fn first_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    match line.chars().count() > 72 {
        true => line.chars().take(71).collect::<String>() + "…",
        false => line.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_bare_command_is_a_job() {
        let job = Job::parse(1, &json!("make test"), 0, 5).unwrap();
        assert_eq!(job.command, "make test");
        assert_eq!(job.label, "make test");
        assert_eq!(
            job.after, None,
            "no wait: it is the queue's order that holds it"
        );
        assert_eq!(job.run, Run::New);
        assert!(job.state == State::Waiting);
    }

    #[test]
    fn a_table_says_what_it_waits_for_and_where_it_runs() {
        let job = Job::parse(
            2,
            &json!({ "command": "cargo test", "after": "%3", "run": "pane:%7", "name": "tests" }),
            0,
            9,
        )
        .unwrap();
        assert_eq!(job.after, Some((3, On::Done)));
        assert_eq!(job.run, Run::Pane(7));
        assert_eq!(job.label, "tests");

        let job = Job::parse(
            3,
            &json!({ "command": "x", "after": { "pane": 4, "on": "exit" } }),
            0,
            9,
        )
        .unwrap();
        assert_eq!(job.after, Some((4, On::Exit)), "a wait other than `done`");
    }

    #[test]
    fn a_wait_needs_a_pane_and_a_known_word() {
        assert!(Job::parse(1, &json!({ "command": "x", "after": "later" }), 0, 9).is_err());
        assert!(
            Job::parse(
                1,
                &json!({ "command": "x", "after": { "pane": 3, "on": "soon" } }),
                0,
                9
            )
            .is_err()
        );
        assert!(
            Job::parse(1, &json!({ "run": "new" }), 0, 9).is_err(),
            "no command"
        );
    }

    #[test]
    fn a_pane_is_written_either_way() {
        assert_eq!(pane_id(&json!("%12")), Some(12));
        assert_eq!(pane_id(&json!(12)), Some(12));
        assert_eq!(pane_id(&json!({ "pane": 12 })), Some(12));
        assert_eq!(pane_id(&json!("pi")), None);
    }

    #[test]
    fn a_plain_command_in_a_shell_is_done_when_the_shell_is_back() {
        let busy = Facts {
            at_rest: false,
            ..Facts::default()
        };
        let back = Facts {
            at_rest: true,
            ..Facts::default()
        };
        assert!(!busy.holds(On::Done), "still running");
        assert!(back.holds(On::Done));
        assert!(
            Facts { dead: true, ..busy }.holds(On::Idle),
            "a program that exited is not running"
        );
    }

    #[test]
    fn an_agents_turn_ends_on_its_own_report() {
        let working = Facts {
            agent: Some(Agent::Working),
            at_rest: false,
            dead: false,
        };
        let done = Facts {
            agent: Some(Agent::Done),
            at_rest: false,
            dead: false,
        };
        let blocked = Facts {
            agent: Some(Agent::Blocked),
            at_rest: false,
            dead: false,
        };
        assert!(!working.holds(On::Done), "a working agent is not done");
        assert!(
            !blocked.holds(On::Done),
            "a blocked agent is waiting for a person"
        );
        assert!(
            done.holds(On::Done),
            "its turn ended, though it still has the terminal"
        );
        assert!(!done.holds(On::Idle), "it is not back at a prompt");
        assert!(
            Facts {
                dead: true,
                ..blocked
            }
            .holds(On::Exit),
            "a program that exited"
        );
    }

    #[test]
    fn a_pane_typed_into_is_not_done_until_it_was_busy_or_the_grace_passed() {
        let mut armed = Armed::default();
        armed.stamp(3, 1_000);
        assert!(armed.held(3));
        // Still at rest straight away: the shell has not started it yet.
        armed.observe(3, true, 1_100);
        assert!(armed.held(3));
        // Busy: from now on, at rest means done.
        armed.observe(3, false, 1_200);
        assert!(!armed.held(3));

        // A command too quick to see (`true`): the grace settles it.
        let mut armed = Armed::default();
        armed.stamp(4, 1_000);
        armed.observe(4, true, 1_000 + Armed::GRACE - 1);
        assert!(armed.held(4));
        armed.observe(4, true, 1_000 + Armed::GRACE);
        assert!(!armed.held(4));
    }

    #[test]
    fn a_clock_reads_like_one() {
        assert_eq!(clock(0), "0:00");
        assert_eq!(clock(42_000), "0:42");
        assert_eq!(clock(60_000), "1:00");
        assert_eq!(clock(3_723_000), "1:02:03");
    }

    #[test]
    fn a_label_is_the_first_line_of_the_command() {
        assert_eq!(first_line("make test\nmake run"), "make test");
        assert!(first_line(&"x".repeat(200)).ends_with('…'));
    }
}
