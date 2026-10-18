//! pumi's model as herdr's clients see it: sessions are workspaces, tabs are tabs, panes are
//! panes, read from the core's state (`pumi_get_state`) for each request.
//!
//! herdr's ids are derived from pumi's, so they never need a table: a session `$5` is the
//! workspace `w5` (in herdr's alphabet), its tab `@7` is `w5:t7`, and a pane `%9` in it is
//! `w5:p9`, terminal `term_9`. A pane's id names its workspace, but only its number is read.

use std::collections::BTreeMap;

use crate::proto::ids;
use crate::proto::types::{AgentInfo, AgentStatus, PaneInfo, SessionSnapshot, TabInfo, WorkspaceInfo};
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct Session {
    pub id: u64,
    pub name: String,
    pub tabs: Vec<(u32, u64)>,
    pub current: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct Tab {
    pub name: Option<String>,
    pub active: u64,
    pub zoomed: bool,
    pub panes: Vec<u64>,
}

#[derive(Clone, Debug)]
pub struct Pane {
    pub id: u64,
    pub ty: String,
    pub tab: Option<u64>,
    pub options: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug)]
pub struct View {
    pub sessions: Vec<Session>,
    pub tabs: BTreeMap<u64, Tab>,
    pub panes: BTreeMap<u64, Pane>,
    pub current: Option<(u64, u64, u64)>,
}

fn leaves(layout: &Value, out: &mut Vec<u64>) {
    let Some(list) = layout.as_array() else { return };
    match list.first().and_then(Value::as_str) {
        Some("leaf") => out.extend(list.get(1).and_then(Value::as_u64)),
        _ => {
            for child in list.get(1).and_then(Value::as_array).into_iter().flatten() {
                leaves(child, out);
            }
        }
    }
}

impl View {
    pub fn from_state(state: &Value) -> View {
        let empty = Vec::new();
        let list = |key: &str| state.get(key).and_then(Value::as_array).unwrap_or(&empty);
        let sessions = list("sessions")
            .iter()
            .filter_map(|s| {
                Some(Session {
                    id: s["id"].as_u64()?,
                    name: s["name"].as_str().unwrap_or_default().to_string(),
                    tabs: serde_json::from_value(s["tabs"].clone()).unwrap_or_default(),
                    current: s["current"].as_u64(),
                })
            })
            .collect();
        let tabs = list("tabs")
            .iter()
            .filter_map(|t| {
                let mut panes = Vec::new();
                leaves(&t["layout"], &mut panes);
                Some((
                    t["id"].as_u64()?,
                    Tab {
                        name: t["name"].as_str().map(str::to_string),
                        active: t["active"].as_u64()?,
                        zoomed: t["zoomed"].as_bool().unwrap_or(false),
                        panes,
                    },
                ))
            })
            .collect();
        let panes = list("panes")
            .iter()
            .filter_map(|p| {
                let tab = (p["place"]["kind"] == "tiled").then(|| p["place"]["tab"].as_u64()).flatten();
                Some((
                    p["id"].as_u64()?,
                    Pane {
                        id: p["id"].as_u64()?,
                        ty: p["type"].as_str().unwrap_or_default().to_string(),
                        tab,
                        options: p["options"].as_object().cloned().unwrap_or_default(),
                    },
                ))
            })
            .collect();
        let current =
            state.get("current").and_then(|c| Some((c["session"].as_u64()?, c["tab"].as_u64()?, c["pane"].as_u64()?)));
        View { sessions, tabs, panes, current }
    }

    pub fn session_of_tab(&self, tab: u64) -> Option<&Session> {
        self.sessions.iter().find(|s| s.tabs.iter().any(|(_, t)| *t == tab))
    }

    fn ws_id(session: u64) -> String {
        ids::workspace(session as usize)
    }

    pub fn tab_id(&self, tab: u64) -> String {
        let ws = self.session_of_tab(tab).map(|s| s.id).unwrap_or(0);
        ids::tab(&View::ws_id(ws), tab as usize)
    }

    pub fn pane_id(&self, pane: u64) -> String {
        let ws =
            self.panes.get(&pane).and_then(|p| p.tab).and_then(|t| self.session_of_tab(t)).map(|s| s.id).unwrap_or(0);
        ids::pane(&View::ws_id(ws), pane as usize)
    }

    /// A session from a workspace id (`w5`, or pumi's `$5`).
    pub fn session(&self, id: &str) -> Option<u64> {
        let n = ids::workspace_number(id).map(|n| n as u64).or_else(|| id.strip_prefix('$')?.parse().ok())?;
        self.sessions.iter().any(|s| s.id == n).then_some(n)
    }

    pub fn tab(&self, id: &str) -> Option<u64> {
        let n = ids::split_tab(id).map(|(_, n)| n as u64).or_else(|| id.strip_prefix('@')?.parse().ok())?;
        self.tabs.contains_key(&n).then_some(n)
    }

    /// A pane from a pane id (`w5:p9`), a terminal id (`term_9`) or pumi's `%9`.
    pub fn pane(&self, id: &str) -> Option<u64> {
        let n = ids::split_pane(id)
            .map(|(_, n)| n as u64)
            .or_else(|| id.strip_prefix("term_")?.parse().ok())
            .or_else(|| id.strip_prefix('%')?.parse().ok())?;
        self.panes.contains_key(&n).then_some(n)
    }

    fn text(&self, pane: u64, key: &str) -> Option<String> {
        self.panes.get(&pane)?.options.get(key)?.as_str().filter(|s| !s.is_empty()).map(str::to_string)
    }

    pub fn status(&self, pane: u64) -> AgentStatus {
        self.text(pane, "@agent_status").and_then(|s| AgentStatus::parse(&s)).unwrap_or_default()
    }

    /// A terminal's own reports (OSC 7501), which the pane carries as `@program_status`.
    fn program_status(&self, pane: u64) -> Vec<Value> {
        self.panes
            .get(&pane)
            .and_then(|p| p.options.get("@program_status"))
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default()
    }

    /// The most demanding of some panes' statuses, herdr's order.
    fn rollup(&self, panes: impl Iterator<Item = u64>) -> AgentStatus {
        let rank = |s: AgentStatus| match s {
            AgentStatus::Blocked => 4,
            AgentStatus::Working => 3,
            AgentStatus::Done => 2,
            AgentStatus::Idle => 1,
            AgentStatus::Unknown => 0,
        };
        panes.map(|p| self.status(p)).max_by_key(|s| rank(*s)).unwrap_or_default()
    }

    fn tab_panes(&self, tab: u64) -> Vec<u64> {
        self.tabs.get(&tab).map(|t| t.panes.clone()).unwrap_or_default()
    }

    pub fn workspace_info(&self, session: u64) -> Option<WorkspaceInfo> {
        let (number, s) = self.sessions.iter().enumerate().find(|(_, s)| s.id == session)?;
        let panes: Vec<u64> = s.tabs.iter().flat_map(|(_, t)| self.tab_panes(*t)).collect();
        Some(WorkspaceInfo {
            workspace_id: View::ws_id(session),
            number: number + 1,
            label: s.name.clone(),
            focused: self.current.is_some_and(|c| c.0 == session),
            pane_count: panes.len(),
            tab_count: s.tabs.len(),
            active_tab_id: s.current.map(|t| self.tab_id(t)).unwrap_or_default(),
            agent_status: self.rollup(panes.into_iter()),
            tokens: BTreeMap::new(),
            worktree: None,
        })
    }

    pub fn tab_info(&self, tab: u64) -> Option<TabInfo> {
        let session = self.session_of_tab(tab)?;
        let t = self.tabs.get(&tab)?;
        let number = session.tabs.iter().position(|(_, x)| *x == tab).unwrap_or(0) + 1;
        let label = t.name.clone().or_else(|| self.text(t.active, "title")).unwrap_or_else(|| number.to_string());
        Some(TabInfo {
            tab_id: self.tab_id(tab),
            workspace_id: View::ws_id(session.id),
            number,
            label,
            focused: self.current.is_some_and(|c| c.1 == tab),
            pane_count: t.panes.len(),
            agent_status: self.rollup(t.panes.iter().copied()),
        })
    }

    pub fn pane_info(&self, pane: u64, revision: u64) -> Option<PaneInfo> {
        let p = self.panes.get(&pane)?;
        let tab = p.tab?;
        let session = self.session_of_tab(tab)?;
        let title = self.text(pane, "title");
        Some(PaneInfo {
            pane_id: self.pane_id(pane),
            terminal_id: ids::terminal(pane),
            workspace_id: View::ws_id(session.id),
            tab_id: self.tab_id(tab),
            focused: self.current.is_some_and(|c| c.2 == pane),
            cwd: self.text(pane, "pane_current_path"),
            foreground_cwd: None,
            restore_error: None,
            label: self.text(pane, "@label"),
            agent: self.text(pane, "@agent"),
            title: title.clone(),
            terminal_title: title.clone(),
            terminal_title_stripped: title,
            display_agent: self.text(pane, "@agent"),
            agent_status: self.status(pane),
            state_labels: BTreeMap::new(),
            tokens: BTreeMap::new(),
            agent_session: None,
            scroll: None,
            revision,
            program_status: self.program_status(pane),
        })
    }

    pub fn agent_info(&self, pane: u64) -> Option<AgentInfo> {
        let agent = self.text(pane, "@agent")?;
        let info = self.pane_info(pane, 0)?;
        Some(AgentInfo {
            terminal_id: ids::terminal(pane),
            name: self.text(pane, "@label"),
            agent: Some(agent.clone()),
            title: info.title.clone(),
            terminal_title: info.title.clone(),
            terminal_title_stripped: info.title,
            display_agent: Some(agent),
            agent_status: info.agent_status,
            screen_detection_skipped: false,
            state_labels: BTreeMap::new(),
            tokens: BTreeMap::new(),
            agent_session: None,
            workspace_id: info.workspace_id,
            tab_id: info.tab_id,
            pane_id: info.pane_id,
            focused: info.focused,
            launch_pending: false,
            interactive_ready: true,
            state_change_seq: 0,
            completion_seq: None,
            cwd: info.cwd,
            foreground_cwd: None,
            revision: 0,
        })
    }

    /// Panes in tabs, in order: what herdr lists.
    pub fn tiled(&self) -> Vec<u64> {
        self.sessions.iter().flat_map(|s| s.tabs.iter().flat_map(|(_, t)| self.tab_panes(*t))).collect()
    }

    pub fn snapshot(&self, revision: impl Fn(u64) -> u64) -> SessionSnapshot {
        let panes = self.tiled();
        SessionSnapshot {
            version: crate::proto::HERDR_VERSION.into(),
            protocol: crate::proto::HERDR_PROTOCOL,
            focused_workspace_id: self.current.map(|c| View::ws_id(c.0)),
            focused_tab_id: self.current.map(|c| self.tab_id(c.1)),
            focused_pane_id: self.current.map(|c| self.pane_id(c.2)),
            workspaces: self.sessions.iter().filter_map(|s| self.workspace_info(s.id)).collect(),
            tabs: self.sessions.iter().flat_map(|s| s.tabs.iter().filter_map(|(_, t)| self.tab_info(*t))).collect(),
            panes: panes.iter().filter_map(|p| self.pane_info(*p, revision(*p))).collect(),
            layouts: Vec::new(),
            agents: panes.iter().filter_map(|p| self.agent_info(*p)).collect(),
        }
    }
}
