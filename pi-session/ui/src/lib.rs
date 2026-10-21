//! `pi-session.strip`: the buttons at the end of a pi pane's strip, past its dot and title. Fork
//! opens `pi --fork <session>` in a pane beside it, in the same directory; Copy puts the session's
//! id, path and directory on the clipboard.
//!
//! `init` is the package's own half, with no Lua left in it: the options it declares, and the
//! buttons on every pane whose agent's hook said it is pi's (`@agent`, `@agent_session`). The view
//! is placed in that pane's `PaneStrip` slot (06 §1½) at the row's end (`@start` off), so it rides
//! the strip the pane already has rather than a bar of its own.

use std::collections::HashMap;
use std::io::BufRead;

use pumi_plugin::gpui::ClickEvent;
use pumi_plugin::prelude::*;
use pumi_plugin::ui::{self, Button};

/// What the strip knows of its pane, read when it acts so it is never stale.
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

/// How wide the buttons ask to be in the strip (its `@width`, in pixels): two of the app's
/// square icon buttons side by side, and what is left over stays between them and the title.
const WIDTH: f32 = 50.;

/// Which end of the strip the buttons sit at (`@start`): the row's end, to the right of the title
/// and beside the pane's own split and close buttons.
const START: bool = false;

struct Strip {
    pane: u64,
}

/// One of the strip's buttons: one of the app's icons (the theme import has them, `branch`,
/// `copy`), with what it does in the tooltip rather than a label.
fn button(id: &'static str, icon: &str, tip: &'static str) -> Button {
    let path = ui::theme::icon(icon).unwrap_or_else(|| SharedString::from("icons/circle.svg"));
    Button::icon_only(id, path).tooltip(tip)
}

impl Render for Strip {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("strip")
            .class("pi-session")
            .size_full()
            .flex()
            .items_center()
            .justify_end()
            .gap_1()
            .child(
                button(
                    "fork",
                    "branch",
                    "Fork: open pi --fork <session> beside this pane",
                )
                .on_click(cx.listener(
                    |strip: &mut Strip, _: &ClickEvent, _, _| {
                        if let Err(err) = fork(strip.pane) {
                            notify(&format!("pi-session: {err}"), "error");
                        }
                    },
                )),
            )
            .child(
                button("copy", "copy", "Copy the session's id, path and directory").on_click(
                    cx.listener(
                        |strip: &mut Strip, _: &ClickEvent, _, _| match copy(strip.pane) {
                            Ok(summary) => notify(&format!("Copied\n{summary}"), "info"),
                            Err(err) => notify(&format!("pi-session: {err}"), "error"),
                        },
                    ),
                ),
            )
    }
}

/// Declare one of its options, in its heading in Settings.
fn declare_option(name: &str, mut spec: Value) {
    spec["group"] = json!("Pi session");
    if let Err(err) = api::pumi_create_option(&format!("pi_session.{name}"), spec) {
        eprintln!("pi-session: {err}");
    }
}

/// `pi_session.focused_only`: the buttons on the focused pi pane alone (off, where they are by
/// default, puts them on every one: they are drawn with that pane's own strip buttons, so they
/// show on the focused or hovered pane and hide with them).
fn focused_only() -> bool {
    api::option("pi_session.focused_only", json!({}))
        .ok()
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

/// Whether `pane` runs pi in a conversation the hook named.
fn is_pi(pane: u64) -> bool {
    let text = |name: &str| {
        api::option(name, json!({ "pane": pane }))
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
    };
    text("@agent").as_deref() == Some("pi")
        && text("@agent_session").is_some_and(|session| !session.is_empty())
}

/// Whether a strip view is dressed the way this version dresses one: at the row's end, and as
/// wide as these buttons add up to. One an older version dressed (further along, another width)
/// is made again.
fn dressed(view: u64) -> bool {
    let at = json!({ "pane": view });
    let width = api::option("@width", at.clone())
        .ok()
        .and_then(|value| value.as_f64());
    let start = api::option("@start", at)
        .ok()
        .and_then(|value| value.as_bool());
    width == Some(WIDTH as f64) && start == Some(START)
}

/// Every pi pane has its buttons in its strip (or only the current one, with `focused_only`),
/// and no other pane has them.
fn sync() {
    // Where the buttons are: the pane each belongs to, and the view itself.
    let mut bars: HashMap<u64, u64> = HashMap::new();
    let listed = api::pumi_list_panes(json!({ "type": "pi-session.strip" })).unwrap_or(Value::Null);
    for bar in listed
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
    {
        let place = api::pumi_pane_get_place(bar).unwrap_or(Value::Null);
        // One left elsewhere (an older version's bar), or not dressed for the strip yet: made
        // again below, where it belongs.
        if place["name"] != "PaneStrip" || !dressed(bar) {
            let _ = api::pumi_pane_close(bar, Some(true));
            continue;
        }
        if let Some(owner) = place["owner"].as_u64() {
            bars.insert(owner, bar);
        }
    }
    let only = focused_only()
        .then(|| api::pumi_get_current_pane().ok())
        .flatten();
    let panes = api::pumi_list_panes(json!({ "type": "terminal" })).unwrap_or(Value::Null);
    for pane in panes
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
    {
        let wanted = is_pi(pane) && only.is_none_or(|only| only == pane);
        match bars.remove(&pane) {
            Some(bar) if !wanted => {
                let _ = api::pumi_pane_close(bar, Some(true));
            }
            None if wanted => {
                // At the end of the pane's own strip, past its dot and title.
                let place =
                    json!({ "kind": "slot", "slot": "PaneStrip", "owner": pane, "focus": false });
                let args = json!({ "pane": pane });
                match api::pumi_open_pane("pi-session.strip", args, place) {
                    Ok(view) => {
                        let at = json!({ "pane": view });
                        let _ = api::set_option("@width", json!(WIDTH), at.clone());
                        let _ = api::set_option("@start", json!(START), at);
                    }
                    Err(err) => eprintln!("pi-session: {err}"),
                }
            }
            _ => {}
        }
    }
    for bar in bars.into_values() {
        let _ = api::pumi_pane_close(bar, Some(true));
    }
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    declare_option(
        "side",
        json!({ "type": "string", "default": "right", "choices": ["right", "down"], "labels": ["To the right", "Below"], "label": "Open the fork", "desc": "Where the new pane goes, beside the one forked." }),
    );
    declare_option(
        "focused_only",
        json!({ "type": "boolean", "default": false, "label": "Only on the focused pane", "desc": "Show the buttons on the focused pi pane alone, not on every pi pane's strip." }),
    );
    declare_option(
        "command",
        json!({ "type": "string", "default": "pi", "label": "pi command", "desc": "The program run with `--fork <session>`." }),
    );
    // A pane that becomes pi's (or stops being) gets its buttons, or loses them.
    let pattern = json!({ "pattern": ["@agent", "@agent_session", "pi_session.focused_only"], "desc": "pi panes get their buttons" });
    if let Err(err) = api::autocmd("OptionSet", pattern, |_, _| sync()) {
        eprintln!("pi-session: {err}");
    }
    if let Err(err) = api::autocmd(
        "PaneEnter",
        json!({ "desc": "the buttons follow the focus" }),
        |_, _| {
            if focused_only() {
                sync();
            }
        },
    ) {
        eprintln!("pi-session: {err}");
    }
    plugin.view("strip", |open, _window, cx| {
        let pane = open.args["pane"].as_u64().unwrap_or(open.pane);
        cx.new(|_| Strip { pane }).into()
    });
    sync();
}

pumi_plugin::plugin!(init, api = 1);

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
