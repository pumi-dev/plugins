//! `pi-session.strip`: the bar on a pi pane (its `winbar`, placed by `plugin/pi-session.lua`).
//! Fork opens `pi --fork <session>` in a pane beside it, in the same directory; Copy puts the
//! session's id, path and directory on the clipboard.

use std::io::BufRead;

use pumi_plugin::gpui::{ClickEvent, FontWeight};
use pumi_plugin::prelude::*;

/// What the bar knows of its pane, read when it acts so it is never stale.
struct Session {
    /// What pi's hook reported: an id, or a session file's path.
    value: String,
    cwd: Option<String>,
}

impl Session {
    fn of(pane: u64) -> Result<Self, String> {
        let text = |name: &str| {
            api::option(name, json!({ "pane": pane }))
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
        };
        let value = text("@agent_session")
            .filter(|s| !s.is_empty())
            .ok_or("pi has not said which session it is in")?;
        Ok(Session {
            value,
            cwd: text("pane_current_path"),
        })
    }

    /// The session's id: the value itself, or read from its file's name or first record.
    fn id(&self) -> Option<String> {
        if is_id(&self.value) {
            return Some(self.value.clone());
        }
        name_id(&self.value).or_else(|| header_id(&self.value))
    }

    fn summary(&self) -> String {
        let mut lines = Vec::new();
        if let Some(id) = self.id() {
            lines.push(format!("pi session {id}"));
        }
        if self.value.ends_with(".jsonl") {
            lines.push(format!("path: {}", self.value));
        }
        if let Some(dir) = &self.cwd {
            lines.push(format!("cwd:  {dir}"));
        }
        lines.join("\n")
    }
}

/// A UUID: 8-4-4-4-12 hex digits.
fn is_id(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// pi names its session files `<time>_<id>.jsonl`.
fn name_id(path: &str) -> Option<String> {
    let stem = std::path::Path::new(path).file_stem()?.to_str()?;
    let id = stem.rsplit_once('_')?.1;
    is_id(id).then(|| id.to_string())
}

/// A session file's first record is `{"type": "session", "id": …}`.
fn header_id(path: &str) -> Option<String> {
    let mut line = String::new();
    std::io::BufReader::new(std::fs::File::open(path).ok()?)
        .read_line(&mut line)
        .ok()?;
    let record: Value = serde_json::from_str(&line).ok()?;
    (record["type"] == "session")
        .then(|| record["id"].as_str().map(str::to_string))
        .flatten()
}

fn setting(name: &str, default: &str) -> String {
    let value = api::option(&format!("pi_session.{name}"), json!({})).ok();
    value
        .and_then(|v| v.as_str().map(str::trim).map(str::to_string))
        .filter(|s| !s.is_empty())
        .unwrap_or(default.into())
}

fn fork(pane: u64) -> Result<(), String> {
    let session = Session::of(pane)?;
    let command = setting("command", "pi");
    let side = if setting("side", "right") == "down" {
        "down"
    } else {
        "right"
    };
    let mut args = json!({ "command": [command, "--fork", session.value] });
    if let Some(cwd) = session.cwd {
        args["cwd"] = json!(cwd);
    }
    api::pumi_open_pane("terminal", args, json!({ "beside": pane, "split": side }))
        .map_err(|e| e.message)?;
    Ok(())
}

fn copy(pane: u64) -> Result<String, String> {
    let summary = Session::of(pane)?.summary();
    system::set_clipboard_text(&summary).map_err(|e| e.message)?;
    Ok(summary)
}

fn notify(text: &str, level: &str) {
    let _ = api::pumi_notify(text, Some(level), json!({}));
}

struct Strip {
    pane: u64,
}

fn button(id: &'static str, label: &'static str) -> Stateful<Div> {
    div()
        .id(id)
        .flex_none()
        .px_2()
        .rounded_sm()
        .cursor_pointer()
        .text_color(rgb(0xbac2de))
        .hover(|s| s.bg(rgb(0x45475a)).text_color(rgb(0xcdd6f4)))
        .child(label)
}

use pumi_plugin::gpui::{Div, Stateful};

impl Render for Strip {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("strip")
            .class("pi-session")
            .size_full()
            .flex()
            .items_center()
            .gap_1()
            .px_2()
            .text_xs()
            .bg(rgb(0x1e1e2e))
            .text_color(rgb(0x7f849c))
            .child(div().flex_1().font_weight(FontWeight::MEDIUM).child("pi"))
            .child(button("fork", "Fork").on_click(cx.listener(
                |strip: &mut Strip, _: &ClickEvent, _, _| {
                    if let Err(err) = fork(strip.pane) {
                        notify(&format!("pi-session: {err}"), "error");
                    }
                },
            )))
            .child(button("copy", "Copy").on_click(cx.listener(
                |strip: &mut Strip, _: &ClickEvent, _, _| match copy(strip.pane) {
                    Ok(summary) => notify(&format!("Copied\n{summary}"), "info"),
                    Err(err) => notify(&format!("pi-session: {err}"), "error"),
                },
            )))
    }
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    plugin.view("strip", |open, _window, cx| {
        let pane = open.args["pane"].as_u64().unwrap_or(open.pane);
        cx.new(|_| Strip { pane }).into()
    });
}

pumi_plugin::plugin!(init);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_is_known_by_its_id_or_its_files_name() {
        let id = "0198c3e2-7a51-7c62-9a53-3f1a2b4c5d6e";
        assert!(is_id(id));
        assert!(!is_id("not-an-id"));
        assert_eq!(
            name_id(&format!("/s/2026-10-17T10-00-00_{id}.jsonl")).as_deref(),
            Some(id)
        );
        let session = Session {
            value: id.into(),
            cwd: Some("/repo".into()),
        };
        assert_eq!(session.summary(), format!("pi session {id}\ncwd:  /repo"));
    }
}
