//! The model behind the dashboard: every agent pane in this pumi, read from one
//! `pumi_get_state` (the whole model as an attaching client is first sent it).
//!
//! An agent says what it is doing itself (OSC 7501, 23 §6): the host keeps a pane's records as
//! `@program_status` and the most demanding state among them as `@agent_status`. Who the agent is
//! (`@agent`: `pi`, `claude`, …) and which conversation it is in (`@agent_session`) the agent's
//! hook writes. Nothing here reads a screen or a process.

use std::collections::HashMap;

use pumi_plugin::api;
use serde_json::Value;

/// What a program says it is doing: the five states of the protocol, and `unknown` for a pane
/// nothing has reported on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Blocked,
    Error,
    Working,
    Done,
    Idle,
    Unknown,
}

impl Status {
    pub fn parse(word: &str) -> Option<Self> {
        Some(match word {
            "blocked" => Status::Blocked,
            "error" => Status::Error,
            "working" => Status::Working,
            "done" => Status::Done,
            "idle" => Status::Idle,
            _ => return None,
        })
    }

    /// The word the API, the marks and the styles spell it by.
    pub fn word(self) -> &'static str {
        match self {
            Status::Blocked => "blocked",
            Status::Error => "error",
            Status::Working => "working",
            Status::Done => "done",
            Status::Idle => "idle",
            Status::Unknown => "unknown",
        }
    }

    /// What a card calls it.
    pub fn label(self) -> &'static str {
        match self {
            Status::Blocked => "Blocked",
            Status::Error => "Failed",
            Status::Working => "Working",
            Status::Done => "Done",
            Status::Idle => "Idle",
            Status::Unknown => "Unknown",
        }
    }

    /// Lower wants the user sooner: the order the table and the rail sort in.
    pub fn rank(self) -> u8 {
        match self {
            Status::Blocked => 0,
            Status::Error => 1,
            Status::Working => 2,
            Status::Done => 3,
            Status::Idle => 4,
            Status::Unknown => 5,
        }
    }

    pub fn needs_you(self) -> bool {
        matches!(self, Status::Blocked | Status::Error)
    }
}

/// Which agents the rail and the table show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    All,
    NeedsYou,
    Working,
    Idle,
}

impl Filter {
    pub const ALL: [Filter; 4] = [Filter::All, Filter::NeedsYou, Filter::Working, Filter::Idle];

    pub fn label(self) -> &'static str {
        match self {
            Filter::All => "Overview",
            Filter::NeedsYou => "Needs you",
            Filter::Working => "Working",
            Filter::Idle => "Idle",
        }
    }

    pub fn matches(self, status: Status) -> bool {
        match self {
            Filter::All => true,
            Filter::NeedsYou => status.needs_you(),
            Filter::Working => status == Status::Working,
            Filter::Idle => matches!(status, Status::Idle | Status::Done),
        }
    }
}

/// One agent pane: who, where, and what it is doing.
#[derive(Debug, Clone, PartialEq)]
pub struct Agent {
    pub pane: u64,
    pub session: u64,
    pub session_name: String,
    pub tab: u64,
    pub tab_name: String,
    /// `@agent`: the program's own name for itself (`pi`, `claude`, …), or the app that last
    /// reported if it has none.
    pub kind: String,
    pub status: Status,
    /// Why it wants the user: "needs permission", "has a question", …
    pub why: String,
    /// What it last said, when it said more than its state.
    pub message: String,
    /// `@agent_session`: the conversation it is in, when the agent's hook knows.
    pub conversation: String,
    pub cwd: String,
    pub command: String,
    pub title: String,
    /// The pane the user is in: the model's current pane.
    pub here: bool,
}

impl Agent {
    /// The last segment of its directory: what a row can afford to show.
    pub fn folder(&self) -> &str {
        self.cwd.rsplit('/').find(|leaf| !leaf.is_empty()).unwrap_or(&self.cwd)
    }

    /// `~/Kitchen/pumi`, for a detail line.
    pub fn path(&self) -> String {
        tilde(&self.cwd)
    }

    /// `main › tests`, the place it is in.
    pub fn place(&self) -> String {
        match (self.session_name.is_empty(), self.tab_name.is_empty()) {
            (true, true) => String::new(),
            (true, false) => self.tab_name.clone(),
            (false, true) => self.session_name.clone(),
            (false, false) => format!("{} › {}", self.session_name, self.tab_name),
        }
    }

    /// What a search looks through.
    pub fn haystack(&self) -> String {
        format!(
            "{} {} {} {} {} {} {}",
            self.kind, self.session_name, self.tab_name, self.cwd, self.title, self.command, self.conversation
        )
        .to_lowercase()
    }
}

/// Whether `agent` passes a filter and a search query (case-insensitive, every word has to be
/// in its text).
pub fn matches(agent: &Agent, filter: Filter, query: &str) -> bool {
    filter.matches(agent.status)
        && query
            .split_whitespace()
            .all(|word| agent.haystack().contains(&word.to_lowercase()))
}

/// Every agent, and which pane the user is in.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Overview {
    /// In the order the table shows them: what wants the user first, then by session and tab.
    pub agents: Vec<Agent>,
    pub current_pane: Option<u64>,
}

impl Overview {
    pub fn parse(reply: &Value) -> Self {
        let state = reply.get("state").unwrap_or(reply);
        let empty: Vec<Value> = Vec::new();
        let list = |key: &str| state.get(key).and_then(Value::as_array).unwrap_or(&empty);

        // Where a tab sits: its session, its index in it, and its name.
        #[derive(Clone, Default)]
        struct Where {
            session: u64,
            session_name: String,
            name: String,
        }
        let mut places: HashMap<u64, Where> = HashMap::new();
        for session in list("sessions") {
            let Some(id) = session.get("id").and_then(Value::as_u64) else { continue };
            let name = session.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
            let tabs = session.get("tabs").and_then(Value::as_array).unwrap_or(&empty);
            for pair in tabs {
                let Some(tab) = pair.get(1).and_then(Value::as_u64) else { continue };
                places.insert(tab, Where { session: id, session_name: name.clone(), name: String::new() });
            }
        }
        for tab in list("tabs") {
            let Some(id) = tab.get("id").and_then(Value::as_u64) else { continue };
            let name = tab.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
            if let Some(place) = places.get_mut(&id) {
                place.name = name;
            }
        }

        let current = state.get("current").cloned().unwrap_or(Value::Null);
        let current_pane = current.get("pane").and_then(Value::as_u64);

        let mut agents: Vec<Agent> = Vec::new();
        for pane in list("panes") {
            let Some(id) = pane.get("id").and_then(Value::as_u64) else { continue };
            // Agents live in terminals placed in a tab; floats, slots and detached panes are the
            // chrome's and other views' business.
            if pane.get("type").and_then(Value::as_str) != Some("terminal") {
                continue;
            }
            let place = pane.get("place").cloned().unwrap_or(Value::Null);
            if place.get("kind").and_then(Value::as_str) != Some("tiled") {
                continue;
            }
            let Some(tab) = place.get("tab").and_then(Value::as_u64) else { continue };
            let Some(site) = places.get(&tab) else { continue };

            let options = pane.get("options").and_then(Value::as_object).cloned().unwrap_or_default();
            let text = |key: &str| {
                options.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_string()
            };
            let records = options.get("@program_status").and_then(Value::as_array);
            let (status, why) = status_of(&text("@agent_status"), records);
            let agent = text("@agent");
            // A shell nobody has reported on is not an agent; a program that said what it is doing
            // is one even when it never named itself.
            if agent.is_empty() && matches!(status, Status::Idle | Status::Unknown) {
                continue;
            }
            let record = worst(records);
            let message = record.and_then(|r| r.get("msg")).and_then(Value::as_str).unwrap_or_default().to_string();
            let kind = if agent.is_empty() {
                record
                    .and_then(|r| r.get("app"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .filter(|app| !app.is_empty())
                    .unwrap_or_else(|| text("pane_current_command"))
            } else {
                agent
            };
            agents.push(Agent {
                pane: id,
                session: site.session,
                session_name: site.session_name.clone(),
                tab,
                tab_name: site.name.clone(),
                kind,
                status,
                why,
                message,
                conversation: text("@agent_session"),
                cwd: text("pane_current_path"),
                command: text("pane_current_command"),
                title: strip(&text("title")),
                here: Some(id) == current_pane,
            });
        }
        agents.sort_by(|a, b| {
            (a.status.rank(), &a.session_name, a.session, &a.tab_name, a.pane).cmp(&(
                b.status.rank(),
                &b.session_name,
                b.session,
                &b.tab_name,
                b.pane,
            ))
        });
        Overview { agents, current_pane }
    }

    pub fn total(&self) -> usize {
        self.agents.len()
    }

    pub fn count(&self, status: Status) -> usize {
        self.agents.iter().filter(|agent| agent.status == status).count()
    }

    /// Blocked and failed: the agents that will not go on without the user.
    pub fn needs_you(&self) -> usize {
        self.agents.iter().filter(|agent| agent.status.needs_you()).count()
    }

    /// How many sessions the agents are spread over.
    pub fn sessions(&self) -> usize {
        let mut ids: Vec<u64> = self.agents.iter().map(|agent| agent.session).collect();
        ids.sort_unstable();
        ids.dedup();
        ids.len()
    }

    /// The agents a filter and a query let through, in table order.
    pub fn visible(&self, filter: Filter, query: &str) -> Vec<&Agent> {
        self.agents.iter().filter(|agent| matches(agent, filter, query)).collect()
    }

    /// The sessions the agents are in, in table order, each with its agents.
    pub fn groups(&self, filter: Filter, query: &str) -> Vec<(u64, String, Vec<&Agent>)> {
        let mut groups: Vec<(u64, String, Vec<&Agent>)> = Vec::new();
        for agent in self.visible(filter, query) {
            match groups.iter_mut().find(|(session, _, _)| *session == agent.session) {
                Some((_, _, agents)) => agents.push(agent),
                None => groups.push((agent.session, agent.session_name.clone(), vec![agent])),
            }
        }
        groups
    }
}

/// `@agent_status`, corrected by the records behind it: a host that predates `error` said `done`
/// for one, and the record still tells. `why` is what the protocol's `kind` says it waits for.
fn status_of(word: &str, records: Option<&Vec<Value>>) -> (Status, String) {
    let record = worst(records);
    let said = record.and_then(|r| r.get("state")).and_then(Value::as_str);
    let mut status = Status::parse(word).or_else(|| said.and_then(Status::parse)).unwrap_or(Status::Unknown);
    if status == Status::Done && said == Some("error") {
        status = Status::Error;
    }
    let kind = record.filter(|r| r.get("state").and_then(Value::as_str) == Some(status.word())).and_then(|r| r.get("kind"));
    let why = match (status, kind.and_then(Value::as_str)) {
        (Status::Blocked, Some("permission")) => "needs permission",
        (Status::Blocked, Some("question")) => "has a question",
        (Status::Blocked, Some("auth")) => "needs a login",
        (Status::Blocked, _) => "waiting on you",
        (Status::Error, _) => "failed",
        _ => "",
    };
    (status, why.to_string())
}

/// The record that wants the user most, the protocol's set: its root first, then the most
/// urgent state.
fn worst<'a>(records: Option<&'a Vec<Value>>) -> Option<&'a Value> {
    let rank = |state: Option<&str>| state.and_then(Status::parse).map_or(0, |status| 9 - status.rank());
    records?
        .iter()
        .max_by_key(|record| {
            let state = record.get("state").and_then(Value::as_str);
            (rank(state), record.get("id").and_then(Value::as_str).is_none_or(str::is_empty))
        })
}

/// A terminal title without the spinner a shell puts in front of it (`⠋ π - pumi` → `π - pumi`).
fn strip(title: &str) -> String {
    let trimmed = title.trim();
    let kept = trimmed.trim_start_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '~' && c != '.');
    kept.trim_start().to_string()
}

/// `/Users/me/x` as `~/x`.
pub fn tilde(path: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    match path.strip_prefix(&home) {
        Some(rest) if !home.is_empty() => format!("~{rest}"),
        _ => path.to_string(),
    }
}

/// Read the model: one call.
pub fn read() -> Result<Overview, api::Error> {
    Ok(Overview::parse(&api::pumi_get_state()?))
}

/// Every agent and what it is doing, as `pumi call agent_overview.list` answers.
pub fn list() -> Result<Value, api::Error> {
    let overview = read()?;
    let agents: Vec<Value> = overview
        .agents
        .iter()
        .map(|agent| {
            serde_json::json!({
                "pane": agent.pane,
                "session": agent.session,
                "session_name": agent.session_name,
                "tab": agent.tab,
                "tab_name": agent.tab_name,
                "agent": agent.kind,
                "status": agent.status.word(),
                "why": agent.why,
                "message": agent.message,
                "conversation": agent.conversation,
                "cwd": agent.cwd,
                "command": agent.command,
                "title": agent.title,
            })
        })
        .collect();
    Ok(serde_json::json!({
        "agents": agents,
        "counts": {
            "blocked": overview.count(Status::Blocked),
            "error": overview.count(Status::Error),
            "working": overview.count(Status::Working),
            "done": overview.count(Status::Done),
            "idle": overview.count(Status::Idle),
        },
        "sessions": overview.sessions(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A model as `pumi_get_state` answers it: two sessions, three panes, one agent blocked.
    fn state() -> Value {
        json!({
            "seq": 12,
            "state": {
                "sessions": [
                    { "id": 1, "name": "main", "tabs": [[0, 10], [1, 11]], "current": 10 },
                    { "id": 2, "name": "work", "tabs": [[0, 20]], "current": 20 },
                ],
                "tabs": [
                    { "id": 10, "name": "agents", "active": 100 },
                    { "id": 11, "name": "build", "active": 101 },
                    { "id": 20, "name": "review", "active": 200 },
                ],
                "panes": [
                    { "id": 100, "type": "terminal", "place": { "kind": "tiled", "tab": 10 }, "options": {
                        "@agent": "claude",
                        "@agent_status": "blocked",
                        "@agent_session": "conv-1",
                        "pane_current_path": "/Users/me/Kitchen/pumi",
                        "pane_current_command": "claude",
                        "title": "⠋ claude",
                        "@program_status": [
                            { "id": "", "state": "working", "app": "claude" },
                            { "id": "tool", "state": "blocked", "kind": "permission", "msg": "Bash(rm -rf build)?", "app": "claude" }
                        ]
                    }},
                    { "id": 101, "type": "terminal", "place": { "kind": "tiled", "tab": 11 }, "options": {
                        "pane_current_path": "/Users/me/Kitchen/pumi",
                        "pane_current_command": "make",
                        "@agent_status": "done",
                        "@program_status": [ { "id": "", "state": "error", "msg": "recipe failed" } ]
                    }},
                    { "id": 200, "type": "terminal", "place": { "kind": "tiled", "tab": 20 }, "options": {
                        "@agent": "pi",
                        "@agent_status": "idle",
                        "pane_current_path": "/Users/me/other",
                        "title": "π - other"
                    }},
                    { "id": 201, "type": "terminal", "place": { "kind": "tiled", "tab": 20 }, "options": {
                        "pane_current_path": "/tmp"
                    }},
                    { "id": 202, "type": "terminal", "place": { "kind": "float" }, "options": { "@agent": "pi", "@agent_status": "working" }},
                    { "id": 203, "type": "agent-overview.overview", "place": { "kind": "tiled", "tab": 20 }, "options": {} },
                ],
                "current": { "session": 1, "tab": 10, "pane": 100 },
            }
        })
    }

    #[test]
    fn only_terminals_in_tabs_are_agents() {
        let overview = Overview::parse(&state());
        let panes: Vec<u64> = overview.agents.iter().map(|agent| agent.pane).collect();
        assert_eq!(panes, vec![100, 101, 200], "the float, the plain shell and the view are not");
        assert_eq!(overview.current_pane, Some(100));
    }

    #[test]
    fn what_wants_the_user_comes_first() {
        let overview = Overview::parse(&state());
        let statuses: Vec<Status> = overview.agents.iter().map(|agent| agent.status).collect();
        assert_eq!(statuses, vec![Status::Blocked, Status::Error, Status::Idle]);
        assert_eq!(overview.needs_you(), 2);
        assert_eq!(overview.sessions(), 2);
        assert_eq!(overview.count(Status::Idle), 1);
    }

    #[test]
    fn a_blocked_agent_says_what_it_waits_for() {
        let overview = Overview::parse(&state());
        let claude = &overview.agents[0];
        assert_eq!(claude.kind, "claude");
        assert_eq!(claude.why, "needs permission");
        assert_eq!(claude.message, "Bash(rm -rf build)?");
        assert_eq!(claude.place(), "main › agents");
        assert_eq!(claude.folder(), "pumi");
        assert_eq!(claude.title, "claude");
        assert!(claude.here);
        assert_eq!(claude.conversation, "conv-1");
    }

    #[test]
    fn a_done_whose_record_failed_is_a_failure() {
        let overview = Overview::parse(&state());
        let built = &overview.agents[1];
        assert_eq!(built.status, Status::Error);
        assert_eq!(built.why, "failed");
        assert_eq!(built.kind, "make", "a program that named no agent is itself");
        assert_eq!(built.session_name, "main");
        assert!(!built.here);
    }

    #[test]
    fn filters_and_a_query_narrow_the_list() {
        let overview = Overview::parse(&state());
        let ids = |filter, query: &str| -> Vec<u64> {
            overview.visible(filter, query).iter().map(|agent| agent.pane).collect()
        };
        assert_eq!(ids(Filter::NeedsYou, ""), vec![100, 101]);
        assert_eq!(ids(Filter::Idle, ""), vec![200]);
        assert_eq!(ids(Filter::Working, ""), Vec::<u64>::new());
        assert_eq!(ids(Filter::All, "claude"), vec![100]);
        assert_eq!(ids(Filter::All, "pumi claude"), vec![100], "every word has to match");
        assert_eq!(ids(Filter::All, "review"), vec![200]);
        let groups = overview.groups(Filter::All, "");
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].1, "main", "a session appears where its first agent does");
        assert_eq!(groups[0].2.len(), 2);
        assert_eq!(groups[1].1, "work");
        assert_eq!(groups[1].2.len(), 1);
    }
}
