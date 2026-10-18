//! tmux's formats and targets over the model: every option is a format variable, and so are
//! tmux's own (`session_name`, `window_index`, `pane_active`, …), with pumi's tabs answering
//! for tmux's windows.

use pumi_lang::format::{Context, Item, Loop, NameKind, Sort, SortOrder};
use pumi_lang::target::{self, PaneInfo, SessionInfo, TabInfo, Tree};
use serde_json::Value;

use super::{ChanId, Kernel, PaneId, Place, SessionId, TabId};

/// A format's context: what `#{pane_id}` and friends are about.
#[derive(Clone, Copy)]
pub struct Fmt<'k> {
    pub kernel: &'k Kernel,
    pub session: Option<SessionId>,
    pub tab: Option<TabId>,
    pub pane: Option<PaneId>,
    pub client: Option<ChanId>,
    /// Variables of the moment: a hook's `hook_pane`, a command's `command_name`.
    pub extra: Option<&'k std::collections::BTreeMap<String, String>>,
}

/// An option's value as text, as tmux's `format_find` gives it: flags as `1` and `0`.
pub fn text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(b) => if *b { "1" } else { "0" }.into(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

fn flag(b: bool) -> Option<String> {
    Some(if b { "1" } else { "0" }.into())
}

impl<'k> Fmt<'k> {
    /// The context of a pane, a tab or a session, completed upwards (a pane's tab and session).
    pub fn new(
        kernel: &'k Kernel,
        session: Option<SessionId>,
        tab: Option<TabId>,
        pane: Option<PaneId>,
    ) -> Fmt<'k> {
        let tab = tab.or_else(|| pane.and_then(|p| kernel.tab_of_pane(p)));
        let session = session.or_else(|| tab.and_then(|t| kernel.session_of_tab(t)));
        let pane = pane.or_else(|| tab.and_then(|t| kernel.tabs.get(&t).map(|t| t.active)));
        Fmt {
            kernel,
            session,
            tab,
            pane,
            client: None,
            extra: None,
        }
    }

    fn tab_name(&self, tab: TabId) -> String {
        let t = &self.kernel.tabs[&tab];
        match &t.name {
            Some(name) => name.clone(),
            None => {
                let auto = self
                    .kernel
                    .options
                    .get(
                        "automatic_rename",
                        &self.kernel.chain(None, Some(tab), None),
                    )
                    .is_none_or(|(v, _)| v != Value::Bool(false));
                let title = text(&self.kernel.pane_option(t.active, "title"));
                if auto && !title.is_empty() {
                    title
                } else {
                    text(&self.kernel.pane_option(t.active, "pane_current_command"))
                }
            }
        }
    }

    fn session_var(&self, name: &str) -> Option<String> {
        let s = self.kernel.sessions.get(&self.session?)?;
        match name {
            "session_id" => Some(format!("${}", s.id)),
            "session_name" => Some(s.name.clone()),
            "session_windows" => Some(s.tabs.len().to_string()),
            "session_path" => Some(s.cwd.clone().unwrap_or_default()),
            "session_activity" => Some(s.activity.to_string()),
            "session_attached" => Some(
                self.kernel
                    .chans
                    .values()
                    .filter(|c| c.ui.as_ref().is_some_and(|u| u.session == s.id))
                    .count()
                    .to_string(),
            ),
            "session_grouped" => flag(false),
            "session_group" | "session_group_list" | "session_alerts" | "session_stack" => {
                Some(String::new())
            }
            "session_created" | "session_last_attached" => Some(s.created.to_string()),
            "session_many_attached" => flag(
                self.kernel
                    .chans
                    .values()
                    .filter(|c| c.ui.as_ref().is_some_and(|u| u.session == s.id))
                    .count()
                    > 1,
            ),
            "session_format" => flag(true),
            "session_marked" => flag(false),
            _ => None,
        }
    }

    fn tab_var(&self, name: &str) -> Option<String> {
        let tab = self.tab?;
        let t = self.kernel.tabs.get(&tab)?;
        let session = self.session.and_then(|s| self.kernel.sessions.get(&s));
        match name {
            "window_id" => Some(format!("@{tab}")),
            "window_index" => session
                .and_then(|s| s.tabs.iter().find(|(_, t)| *t == tab))
                .map(|(i, _)| i.to_string()),
            "window_name" => Some(self.tab_name(tab)),
            "window_active" => flag(session.is_some_and(|s| s.current == Some(tab))),
            "window_last_flag" => flag(session.is_some_and(|s| s.last == Some(tab))),
            "window_panes" => Some(t.layout.panes().len().to_string()),
            "window_zoomed_flag" => flag(t.zoomed),
            "window_width" => Some(self.kernel.tab_area(tab).width.to_string()),
            "window_height" => Some(self.kernel.tab_area(tab).height.to_string()),
            "window_layout" | "window_visible_layout" => {
                Some(t.layout.to_tmux(self.kernel.tab_area(tab)))
            }
            "window_flags" | "window_raw_flags" => {
                let mut flags = String::new();
                if session.is_some_and(|s| s.current == Some(tab)) {
                    flags.push('*');
                } else if session.is_some_and(|s| s.last == Some(tab)) {
                    flags.push('-');
                }
                if t.zoomed {
                    flags.push('Z');
                }
                if name == "window_flags" && flags.is_empty() {
                    flags.push(' ');
                }
                Some(flags)
            }
            "window_start_flag" => {
                flag(session.is_some_and(|s| s.tabs.first().map(|(_, t)| *t) == Some(tab)))
            }
            "window_end_flag" => {
                flag(session.is_some_and(|s| s.tabs.last().map(|(_, t)| *t) == Some(tab)))
            }
            "window_linked" => flag(
                self.kernel
                    .sessions
                    .values()
                    .filter(|s| s.tabs.iter().any(|(_, x)| *x == tab))
                    .count()
                    > 1,
            ),
            "window_linked_sessions" => Some(
                self.kernel
                    .sessions
                    .values()
                    .filter(|s| s.tabs.iter().any(|(_, x)| *x == tab))
                    .count()
                    .to_string(),
            ),
            "window_activity_flag"
            | "window_bell_flag"
            | "window_silence_flag"
            | "window_marked_flag" => flag(false),
            "window_format" => flag(true),
            "window_active_clients" | "window_active_sessions" => Some(
                self.kernel
                    .sessions
                    .values()
                    .filter(|s| s.current == Some(tab))
                    .count()
                    .to_string(),
            ),
            _ => None,
        }
    }

    fn pane_var(&self, name: &str) -> Option<String> {
        let pane = self.pane?;
        let p = self.kernel.panes.get(&pane)?;
        let tab = p.place.tab().and_then(|t| self.kernel.tabs.get(&t));
        match name {
            "pane_id" => Some(format!("%{pane}")),
            "pane_index" => tab
                .and_then(|t| t.layout.panes().iter().position(|x| *x == pane))
                .map(|i| i.to_string()),
            "pane_active" => flag(tab.is_some_and(|t| t.active == pane)),
            "pane_last" => flag(tab.is_some_and(|t| t.last == Some(pane))),
            "pane_title" => Some(text(&self.kernel.pane_option(pane, "title"))),
            "pane_floating_flag" => flag(matches!(p.place, Place::Float { .. })),
            "pane_format" => flag(true),
            "pane_in_mode"
            | "pane_marked"
            | "pane_marked_set"
            | "pane_input_off"
            | "pane_pipe"
            | "pane_unseen_changes" => flag(false),
            "pane_mode" | "pane_search_string" | "pane_dead_signal" | "pane_dead_time" => {
                Some(String::new())
            }
            "pane_synchronized" => {
                flag(self.kernel.pane_option(pane, "synchronize_panes") == Value::Bool(true))
            }
            "pane_tty" | "pane_start_command" => Some(text(&self.kernel.pane_option(pane, name))),
            // The host keeps no screen; the core keeps bytes, not rows.
            "history_size" => Some("0".into()),
            "pane_start_path" => Some(text(&self.kernel.pane_option(pane, "pane_current_path"))),
            // Geometry is the layout's, in the tab's area (18 §3); the core keeps only sizes.
            "pane_left" | "pane_top" | "pane_right" | "pane_bottom" | "pane_at_left"
            | "pane_at_top" | "pane_at_right" | "pane_at_bottom" => {
                let rect = self.kernel.pane_rect(pane)?;
                let area = self.kernel.tab_area(p.place.tab()?);
                let (right, bottom) = (rect.x + rect.width, rect.y + rect.height);
                match name {
                    "pane_left" => Some(rect.x.to_string()),
                    "pane_top" => Some(rect.y.to_string()),
                    "pane_right" => Some(right.saturating_sub(1).to_string()),
                    "pane_bottom" => Some(bottom.saturating_sub(1).to_string()),
                    "pane_at_left" => flag(rect.x == 0),
                    "pane_at_top" => flag(rect.y == 0),
                    "pane_at_right" => flag(right >= area.width),
                    _ => flag(bottom >= area.height),
                }
            }
            _ => None,
        }
    }

    fn client_var(&self, name: &str) -> Option<String> {
        let client = self.client?;
        let chan = self.kernel.chans.get(&client)?;
        let ui = chan.ui.as_ref();
        match name {
            "client_name" => Some(if chan.info.name.is_empty() {
                format!("client{client}")
            } else {
                chan.info.name.clone()
            }),
            "client_pid" => Some(
                chan.info
                    .attributes
                    .get("pid")
                    .map(text)
                    .unwrap_or_default(),
            ),
            "client_tty" => Some(
                chan.info
                    .attributes
                    .get("tty")
                    .map(text)
                    .unwrap_or_default(),
            ),
            "client_termname" | "client_termtype" => Some(
                chan.info
                    .attributes
                    .get("term")
                    .map(text)
                    .unwrap_or_else(|| "pumi".into()),
            ),
            "client_session" => ui
                .and_then(|u| self.kernel.sessions.get(&u.session))
                .map(|s| s.name.clone()),
            "client_width" => ui.map(|u| u.width.to_string()),
            "client_height" => ui.map(|u| u.height.to_string()),
            "client_flags" => Some(if ui.is_some() {
                "attached,focused,UTF-8".into()
            } else {
                String::new()
            }),
            "client_utf8" => flag(true),
            "client_control_mode" => flag(chan.info.ty == "control"),
            "client_key_table" => Some(
                self.kernel
                    .options
                    .get(
                        "key_table",
                        &[
                            super::options::Key::Client(client),
                            super::options::Key::Global,
                        ],
                    )
                    .map(|(v, _)| text(&v))
                    .unwrap_or_default(),
            ),
            _ => None,
        }
    }

    fn server_var(&self, name: &str) -> Option<String> {
        match name {
            "start_time" => Some(self.kernel.started.to_string()),
            "socket_path" => Some(self.kernel.config.socket.display().to_string()),
            "host" => Some(host()),
            "host_short" => Some(host().split('.').next().unwrap_or("").to_string()),
            "pid" => Some(crate::kernel::PID.to_string()),
            "version" => Some(crate::kernel::version()),
            "server_sessions" => Some(self.kernel.sessions.len().to_string()),
            _ => None,
        }
    }
}

/// The machine's name: WASI has no `gethostname`, so the environment the app gave says it.
fn host() -> String {
    ["HOSTNAME", "HOST"]
        .iter()
        .find_map(|name| std::env::var(name).ok())
        .unwrap_or_default()
}

impl Context for Fmt<'_> {
    fn get(&self, name: &str) -> Option<String> {
        if let Some(value) = self.extra.and_then(|extra| extra.get(name)) {
            return Some(value.clone());
        }
        let computed = match name.split('_').next() {
            Some("session") => self.session_var(name),
            Some("window") => self.tab_var(name),
            Some("pane") => self.pane_var(name),
            Some("client") => self.client_var(name),
            _ => self.server_var(name),
        };
        if computed.is_some() {
            return computed;
        }
        let chain = self.kernel.chain(self.pane, self.tab, self.session);
        let mut chain = chain;
        if let Some(client) = self.client {
            chain.insert(chain.len() - 1, super::options::Key::Client(client));
        }
        self.kernel
            .options
            .get(name, &chain)
            .map(|(value, _)| text(&value))
    }

    fn each(&self, what: &Loop, sort: Sort) -> Option<Vec<Item<'_>>> {
        let kernel = self.kernel;
        let mut items: Vec<(String, Fmt, bool)> = match what {
            Loop::Sessions => kernel
                .sessions
                .values()
                .map(|s| {
                    (
                        s.name.clone(),
                        Fmt::new(kernel, Some(s.id), None, None),
                        Some(s.id) == self.session,
                    )
                })
                .collect(),
            Loop::Windows => {
                let s = kernel.sessions.get(&self.session?)?;
                s.tabs
                    .iter()
                    .map(|(i, t)| {
                        (
                            format!("{i:010}"),
                            Fmt::new(kernel, Some(s.id), Some(*t), None),
                            s.current == Some(*t),
                        )
                    })
                    .collect()
            }
            Loop::Panes => {
                let t = kernel.tabs.get(&self.tab?)?;
                t.layout
                    .panes()
                    .into_iter()
                    .enumerate()
                    .map(|(i, p)| {
                        (
                            format!("{i:010}"),
                            Fmt::new(kernel, self.session, Some(t.id), Some(p)),
                            t.active == p,
                        )
                    })
                    .collect()
            }
            _ => return None,
        };
        if sort.order == SortOrder::Name {
            items.sort_by(|a, b| a.0.cmp(&b.0));
        }
        if sort.reversed {
            items.reverse();
        }
        Some(
            items
                .into_iter()
                .map(|(_, context, current)| Item {
                    context: Box::new(Fmt {
                        extra: self.extra,
                        client: self.client,
                        ..context
                    }),
                    current,
                })
                .collect(),
        )
    }

    fn name_exists(&self, kind: NameKind, name: &str) -> Option<bool> {
        match kind {
            NameKind::Session => Some(self.kernel.sessions.values().any(|s| s.name == name)),
            NameKind::Window => {
                let s = self.kernel.sessions.get(&self.session?)?;
                Some(s.tabs.iter().any(|(_, t)| self.tab_name(*t) == name))
            }
        }
    }
}

/// The model as tmux's target resolver asks it.
impl Tree for Kernel {
    fn sessions(&self) -> Vec<SessionInfo> {
        self.sessions
            .values()
            .map(|s| SessionInfo {
                id: s.id,
                name: s.name.clone(),
                activity: s.activity,
            })
            .collect()
    }

    fn tabs(&self, session: SessionId) -> Vec<TabInfo> {
        let Some(s) = self.sessions.get(&session) else {
            return Vec::new();
        };
        let fmt = Fmt::new(self, Some(session), None, None);
        s.tabs
            .iter()
            .map(|(index, t)| TabInfo {
                id: *t,
                index: *index,
                name: fmt.tab_name(*t),
            })
            .collect()
    }

    fn panes(&self, tab: TabId) -> Vec<PaneInfo> {
        let Some(t) = self.tabs.get(&tab) else {
            return Vec::new();
        };
        let area = self.tab_area(tab);
        t.layout
            .rects(area)
            .into_iter()
            .enumerate()
            .map(|(index, (pane, rect))| PaneInfo {
                id: pane,
                index: index as u32,
                kind: self
                    .panes
                    .get(&pane)
                    .map(|p| p.ty.clone())
                    .unwrap_or_default(),
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                last_active: self.panes.get(&pane).map_or(0, |p| p.activity),
            })
            .collect()
    }

    fn current_tab(&self, session: SessionId) -> Option<TabId> {
        self.sessions.get(&session)?.current
    }

    fn active_pane(&self, tab: TabId) -> Option<PaneId> {
        self.tabs.get(&tab).map(|t| t.active)
    }

    fn last_tab(&self, session: SessionId) -> Option<TabId> {
        self.sessions.get(&session)?.last
    }

    fn last_pane(&self, tab: TabId) -> Option<PaneId> {
        self.tabs.get(&tab)?.last
    }

    fn tab_of_pane(&self, pane: PaneId) -> Option<TabId> {
        Kernel::tab_of_pane(self, pane)
    }
}

/// Resolves a tmux target for a caller.
pub fn resolve(
    kernel: &Kernel,
    caller: &pumi_api::Caller,
    target: Option<&str>,
    kind: target::Kind,
) -> pumi_api::Result<target::Found> {
    let current = kernel.current(caller).map(|c| target::Current {
        session: c.session,
        tab: c.tab,
        pane: c.pane,
    });
    target::resolve(kernel, current, target, kind, target::Flags::default())
}

/// Resolves a tmux target that may name an unused tab index (`new-tab -t :5`).
pub fn resolve_index(
    kernel: &Kernel,
    caller: &pumi_api::Caller,
    target: Option<&str>,
) -> pumi_api::Result<target::Found> {
    let current = kernel.current(caller).map(|c| target::Current {
        session: c.session,
        tab: c.tab,
        pane: c.pane,
    });
    target::resolve(
        kernel,
        current,
        target,
        target::Kind::Tab,
        target::Flags { tab_index: true },
    )
}
