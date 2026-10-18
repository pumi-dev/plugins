//! `insert-path.picker`: Rex's Insert Path…, floating over the tab.
//!
//! `plugin/insert-path.lua` binds the trigger key in a terminal's key table and opens this pane
//! there with `open.args` = `{ pane, cwd, trigger, quote, cancel }`. The view walks the pane's
//! directory once, filters it as you type (a fuzzy subsequence over the file name, or over the
//! whole path once the query has a `/` in it), and on Enter types the path into the terminal's
//! program (`pumi_pane_call(pane, "input", {text}))` and closes.
//!
//! Escape, or Backspace on an empty query, closes without picking; when the opener was a bare
//! key, `cancel` says which one, and it is typed back so `/` stays usable in a shell.

use std::path::Path;

use pumi_plugin::gpui::{AnyElement, ClickEvent, FontWeight, KeyDownEvent, MouseDownEvent, ScrollHandle};
use pumi_plugin::gpui::{FocusHandle, Focusable, Subscription, relative};
use pumi_plugin::prelude::*;
use pumi_plugin::ui::{self, color};

/// Directories never walked into: version control, build output, and installed dependencies.
const SKIP: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    ".next",
    ".nuxt",
    ".output",
    ".venv",
    "venv",
    "__pycache__",
    "coverage",
    ".cache",
    "Pods",
];

/// How deep the walk goes, how many entries it keeps, and how many rows are shown at once.
const MAX_DEPTH: usize = 15;
const MAX_ENTRIES: usize = 60_000;
const MAX_HITS: usize = 200;

const PLACEHOLDER: &str = "Filter files…";
const ROW: f32 = 26.;

// ---------------------------------------------------------------- files

/// One path under the root: `rel` is `/`-separated and relative to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub rel: String,
    /// Where the file name starts in `rel`, in bytes.
    pub name_at: usize,
    pub dir: bool,
}

impl Entry {
    pub fn new(rel: String, dir: bool) -> Self {
        let name_at = rel.rfind('/').map_or(0, |at| at + 1);
        Self { rel, name_at, dir }
    }

    pub fn name(&self) -> &str {
        &self.rel[self.name_at..]
    }

    /// The directory above it, relative to the root; empty at the root.
    pub fn parent(&self) -> &str {
        &self.rel[..self.name_at.saturating_sub(1)]
    }

    /// The extension, lowercase, without the dot.
    pub fn extension(&self) -> Option<String> {
        if self.dir {
            return None;
        }
        let name = self.name();
        let (stem, ext) = name.rsplit_once('.')?;
        (!stem.is_empty() && !ext.is_empty()).then(|| ext.to_ascii_lowercase())
    }
}

/// Every file and directory under `root`, alphabetically, without `SKIP`ed directories and
/// without following symlinks.
pub fn walk(root: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if out.len() >= MAX_ENTRIES {
            break;
        }
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children = Vec::new();
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if SKIP.contains(&name.as_str()) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let rel = match dir.strip_prefix(root) {
                Ok(rest) if !rest.as_os_str().is_empty() => {
                    format!("{}/{}", rest.to_string_lossy(), name)
                }
                _ => name,
            };
            let is_dir = kind.is_dir();
            out.push(Entry::new(rel, is_dir));
            if is_dir && depth < MAX_DEPTH {
                children.push(entry.path());
            }
        }
        children.sort();
        for child in children.into_iter().rev() {
            stack.push((child, depth + 1));
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

/// How well `query` matches `haystack` as a case-insensitive subsequence: `None` when a character
/// is missing. Consecutive runs, word starts and exact case score higher, so `srcmain` finds
/// `src/main.rs` and `mm` prefers `mm.rs` to `src/module_math.rs`.
pub fn score(haystack: &str, query: &str) -> Option<i64> {
    if query.is_empty() {
        return Some(0);
    }
    let hay: Vec<char> = haystack.chars().collect();
    let mut at = 0usize;
    let mut total = 0i64;
    let mut last: Option<usize> = None;
    for want in query.chars() {
        let want = want.to_ascii_lowercase();
        let mut found = None;
        while at < hay.len() {
            if hay[at].to_ascii_lowercase() == want {
                found = Some(at);
                break;
            }
            at += 1;
        }
        let hit = found?;
        total += if hay[hit] == want { 3 } else { 2 };
        if hit > 0 && last == Some(hit - 1) {
            total += 6;
        }
        if hit == 0 || matches!(hay[hit - 1], '/' | '\\' | '_' | '-' | '.' | ' ') {
            total += 9;
        }
        if hit > 0 && hay[hit - 1].is_lowercase() && hay[hit].is_uppercase() {
            total += 5;
        }
        last = Some(hit);
        at = hit + 1;
    }
    Some(total)
}

/// The entries a query keeps, best first, at most [`MAX_HITS`]. A query with a `/` in it is
/// matched against the whole relative path, so `src/ma` narrows to one directory.
pub fn hits(entries: &[Entry], query: &str) -> Vec<(usize, i64)> {
    if query.is_empty() {
        return entries.iter().take(MAX_HITS).enumerate().map(|(i, _)| (i, 0)).collect();
    }
    let by_path = query.contains('/');
    let mut scored: Vec<(usize, i64)> = entries
        .iter()
        .enumerate()
        .filter_map(|(i, entry)| {
            let text = if by_path { entry.rel.as_str() } else { entry.name() };
            score(text, query).map(|score| (i, score))
        })
        .collect();
    scored.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| entries[a.0].rel.len().cmp(&entries[b.0].rel.len()))
            .then_with(|| entries[a.0].rel.cmp(&entries[b.0].rel))
    });
    scored.truncate(MAX_HITS);
    scored
}

/// A path as one shell argument: bare when nothing in it needs quoting, `'…'` otherwise, with
/// `'\''` for the quotes inside it.
pub fn quote(path: &str) -> String {
    let plain = !path.is_empty()
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./~+@%:=,".contains(c));
    if plain { path.to_string() } else { format!("'{}'", path.replace('\'', r"'\''")) }
}

/// `/Users/me/kit` as `~/kit`, for the header.
pub fn tilde(path: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    match path.strip_prefix(&home) {
        Some(rest) if !home.is_empty() => format!("~{rest}"),
        _ => path.to_string(),
    }
}

/// The icon a row draws: the app's own by kind, otherwise the package's document.
fn row_icon(entry: &Entry) -> AnyElement {
    let color = color::muted_foreground();
    if entry.dir {
        return ui::icon("folder", ui::ICON, color);
    }
    match entry.extension().as_deref() {
        Some("rs" | "py" | "js" | "jsx" | "ts" | "tsx" | "go" | "lua" | "c" | "h" | "cc" | "cpp" | "hpp" | "swift" | "kt"
        | "java" | "rb" | "php" | "sh" | "bash" | "zsh" | "fish" | "css" | "scss" | "html" | "json" | "toml" | "yaml"
        | "yml" | "sql") => ui::icon("code", ui::ICON, color),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "ico" | "bmp" | "tiff") => {
            ui::icon("image", ui::ICON, color)
        }
        Some("url" | "webloc") => ui::icon("globe", ui::ICON, color),
        _ => ui::icon_file("icons/file.svg", ui::ICON, color),
    }
}

// ---------------------------------------------------------------- the view

pub struct Picker {
    /// This pane (the float), closed when a path is picked or the picker is dismissed.
    own: u64,
    /// The terminal the path is typed into.
    term: u64,
    root_label: String,
    quote: bool,
    /// Typed back when the picker is dismissed: the bare key that opened it.
    cancel: Option<String>,
    entries: Vec<Entry>,
    hits: Vec<(usize, i64)>,
    at: usize,
    input: Entity<ui::TextInput>,
    focus: FocusHandle,
    scroll: ScrollHandle,
    _changed: Subscription,
}

impl Picker {
    fn new(open: &Open, input: Entity<ui::TextInput>, cx: &mut Context<Self>) -> Self {
        let term = open.args["pane"]
            .as_u64()
            .or_else(|| api::pumi_get_current_pane().ok())
            .unwrap_or(open.pane);
        let cwd = open.args["cwd"]
            .as_str()
            .map(str::to_string)
            .or_else(|| {
                api::option("pane_current_path", json!({ "pane": term }))
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
            })
            .filter(|cwd| !cwd.is_empty())
            .unwrap_or_else(|| std::env::current_dir().map(|d| d.display().to_string()).unwrap_or_default());
        let entries = walk(Path::new(&cwd));
        let hits = hits(&entries, "");
        let cancel = open.args["cancel"].as_str().map(str::to_string);
        let quote = open.args["quote"].as_bool().unwrap_or(true);
        let focus = input.focus_handle(cx);
        let changed = cx.subscribe(&input, |this, _, event: &ui::InputEvent, cx| {
            if let ui::InputEvent::Changed(_) = event {
                this.refilter(cx);
            }
        });
        Self {
            own: open.pane,
            term,
            root_label: tilde(&cwd),
            quote,
            cancel,
            entries,
            hits,
            at: 0,
            input,
            focus,
            scroll: ScrollHandle::new(),
            _changed: changed,
        }
    }

    fn query(&self, cx: &App) -> String {
        self.input.read(cx).text().to_string()
    }

    fn refilter(&mut self, cx: &mut Context<Self>) {
        let query = self.query(cx);
        self.hits = hits(&self.entries, &query);
        self.at = 0;
        self.scroll.scroll_to_item(0);
        cx.notify();
    }

    fn selected(&self) -> Option<Entry> {
        self.hits.get(self.at).map(|(index, _)| self.entries[*index].clone())
    }

    fn step(&mut self, by: i64, cx: &mut Context<Self>) {
        if self.hits.is_empty() {
            return;
        }
        let len = self.hits.len() as i64;
        self.at = (self.at as i64 + by).rem_euclid(len) as usize;
        self.scroll.scroll_to_item(self.at);
        cx.notify();
    }

    /// Type `text` into the terminal and close.
    fn insert(&mut self, text: String, _cx: &mut Context<Self>) {
        let text = if self.quote { quote(&text) } else { text };
        if let Err(err) = api::pumi_pane_call(self.term, "input", json!({ "text": text })) {
            let _ = api::pumi_notify(&format!("insert-path: {}", err.message), Some("error"), json!({}));
        }
        self.close();
    }

    /// Close without picking; a bare trigger key is typed back so what was typed still lands.
    fn dismiss(&mut self, cx: &mut Context<Self>) {
        // Only a picker that was dismissed before anything was typed types its trigger back: a
        // query that was typed and abandoned is a real cancel, not a slash.
        if self.query(cx).is_empty()
            && let Some(text) = self.cancel.clone()
        {
            let _ = api::pumi_pane_call(self.term, "input", json!({ "text": text }));
        }
        self.close();
    }

    fn close(&self) {
        let _ = api::pumi_pane_close(self.own, None);
    }

    fn descend(&mut self, entry: &Entry, cx: &mut Context<Self>) {
        let text = format!("{}/", entry.rel);
        self.input.update(cx, |input, cx| input.set_text(&text, cx));
        self.refilter(cx);
    }

    fn key(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let chord = ui::keys::chord(&event.keystroke);
        let empty = self.query(cx).is_empty();
        match chord.as_str() {
            "escape" => self.dismiss(cx),
            "enter" => {
                if let Some(entry) = self.selected() {
                    let text = if entry.dir { format!("{}/", entry.rel) } else { entry.rel };
                    self.insert(text, cx);
                }
            }
            "tab" => {
                if let Some(entry) = self.selected().filter(|entry| entry.dir) {
                    self.descend(&entry, cx);
                }
            }
            "backspace" if empty => self.dismiss(cx),
            "up" | "ctrl+p" | "ctrl+k" => self.step(-1, cx),
            "down" | "ctrl+n" | "ctrl+j" => self.step(1, cx),
            "pageup" => self.step(-8, cx),
            "pagedown" => self.step(8, cx),
            _ => return,
        }
        cx.stop_propagation();
    }
}

impl Render for Picker {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let at = self.at.min(self.hits.len().saturating_sub(1));
        let rows: Vec<AnyElement> = self
            .hits
            .iter()
            .enumerate()
            .map(|(i, (index, _))| {
                let entry = self.entries[*index].clone();
                let dir = entry.parent().to_string();
                let clicked = entry.clone();
                let selected = i == at;
                div()
                    .id(SharedString::from(format!("insert-path-row-{i}")))
                    .hrow()
                    .flex_none()
                    .h(px(ROW))
                    .px(px(8.))
                    .gap(px(8.))
                    .rounded(px(ui::color::RADIUS_SM))
                    .cursor_pointer()
                    .when(selected, |row| {
                        row.bg(color::primary()).text_color(color::primary_foreground())
                    })
                    .when(!selected, |row| row.hover(|row| row.bg(color::list_hover())))
                    .on_hover(cx.listener(move |this, hovered_here: &bool, _, cx| {
                        if *hovered_here && this.at != i {
                            this.at = i;
                            this.scroll.scroll_to_item(i);
                            cx.notify();
                        }
                    }))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        let text = if clicked.dir { format!("{}/", clicked.rel) } else { clicked.rel.clone() };
                        this.insert(text, cx);
                    }))
                    .child(row_icon(&entry))
                    .child(
                        div()
                            .fill()
                            .font_weight(FontWeight::MEDIUM)
                            .child(entry.name().to_string()),
                    )
                    .when(!dir.is_empty(), |row| {
                        row.child(
                            div()
                                .flex_none()
                                .max_w(relative(0.45))
                                .truncate()
                                .text_color(if selected {
                                    color::primary_foreground()
                                } else {
                                    color::muted_foreground()
                                })
                                .child(dir),
                        )
                    })
                    .into_any_element()
            })
            .collect();

        let count = self.hits.len();
        let nothing = rows.is_empty().then(|| {
            div()
                .flex_none()
                .h(px(ROW))
                .px(px(8.))
                .hrow()
                .text_color(color::placeholder())
                .child("No files match")
                .into_any_element()
        });

        div()
            .id("insert-path")
            .vcol()
            .size_full()
            .bg(color::popover())
            .text(13., color::foreground())
            .capture_key_down(cx.listener(Self::key))
            .on_mouse_down_out(cx.listener(|this, _: &MouseDownEvent, _, cx| this.dismiss(cx)))
            .child(
                div()
                    .hrow()
                    .flex_none()
                    .gap(px(6.))
                    .px(px(12.))
                    .pt(px(10.))
                    .pb(px(4.))
                    .text(12., color::muted_foreground())
                    .child(ui::icon("search", ui::ICON_SMALL, color::placeholder()))
                    .child(div().fill().child(self.root_label.clone()))
                    .child(
                        div()
                            .flex_none()
                            .text_color(color::placeholder())
                            .child(format!("{count}")),
                    ),
            )
            .child(
                div()
                    .id("insert-path-list")
                    .vcol()
                    .flex_1()
                    .min_h(px(0.))
                    .px(px(6.))
                    .py(px(2.))
                    .gap(px(1.))
                    .track_scroll(&self.scroll)
                    .overflow_y_scroll()
                    .children(nothing)
                    .children(rows),
            )
            .child(ui::Divider::horizontal())
            .child(div().flex_none().p(px(8.)).child(self.input.clone()))
    }
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    plugin.view("picker", |open, window, cx| {
        let input = cx.new(|cx| ui::TextInput::new("", PLACEHOLDER, window, cx).search());
        let picker = cx.new(|cx| Picker::new(open, input, cx));
        let focus = picker.read(cx).focus.clone();
        window.focus(&focus, cx);
        picker.into()
    });
}

pumi_plugin::plugin!(init);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_knows_its_name_and_its_directory() {
        let nested = Entry::new("crates/a/src/lib.rs".into(), false);
        assert_eq!(nested.name(), "lib.rs");
        assert_eq!(nested.parent(), "crates/a/src");
        assert_eq!(nested.extension().as_deref(), Some("rs"));
        let top = Entry::new("Cargo.toml".into(), false);
        assert_eq!(top.name(), "Cargo.toml");
        assert_eq!(top.parent(), "");
        assert!(!top.dir);
        assert_eq!(Entry::new(".env".into(), false).extension(), None);
    }

    #[test]
    fn the_walk_skips_what_is_built_and_installed() {
        let dir = std::env::temp_dir().join(format!("insert-path-walk-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(dir.join(".git/objects")).unwrap();
        std::fs::write(dir.join("src/main.rs"), "").unwrap();
        std::fs::write(dir.join("Cargo.toml"), "").unwrap();
        std::fs::write(dir.join("node_modules/pkg/index.js"), "").unwrap();
        std::fs::write(dir.join(".git/HEAD"), "").unwrap();
        let found: Vec<String> = walk(&dir).into_iter().map(|e| e.rel).collect();
        assert_eq!(found, vec!["Cargo.toml", "src", "src/main.rs"]);
        assert!(walk(&dir).iter().find(|e| e.rel == "src").is_some_and(|e| e.dir));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_query_is_a_fuzzy_subsequence_with_word_starts() {
        assert_eq!(score("main.rs", ""), Some(0));
        assert!(score("main.rs", "mr").is_some(), "`m` then `r`, not adjacent");
        assert_eq!(score("main.rs", "xyz"), None);
        assert!(score("src/main.rs", "sm").is_some(), "`sm` spans a word start");
        assert_eq!(hits(&[], "x"), vec![]);
        let entries = vec![Entry::new("src/module_maths.rs".into(), false), Entry::new("src/main.rs".into(), false)];
        let found: Vec<&str> = hits(&entries, "src/m").into_iter().map(|(i, _)| entries[i].rel.as_str()).collect();
        assert_eq!(found, vec!["src/main.rs", "src/module_maths.rs"], "equal scores fall back to the shorter path");
    }

    #[test]
    fn a_query_with_a_slash_matches_the_path() {
        let entries = vec![
            Entry::new("Cargo.toml".into(), false),
            Entry::new("src/main.rs".into(), false),
            Entry::new("src/list.rs".into(), false),
        ];
        let found: Vec<&str> = hits(&entries, "src/ma")
            .into_iter()
            .map(|(i, _)| entries[i].rel.as_str())
            .collect();
        assert_eq!(found, vec!["src/main.rs"]);
        let names: Vec<&str> = hits(&entries, "li")
            .into_iter()
            .map(|(i, _)| entries[i].rel.as_str())
            .collect();
        assert_eq!(names, vec!["src/list.rs"]);
    }

    #[test]
    fn paths_are_quoted_only_when_a_shell_would_split_them() {
        assert_eq!(quote("src/main.rs"), "src/main.rs");
        assert_eq!(quote("src/my file.rs"), "'src/my file.rs'");
        assert_eq!(quote("it's.rs"), r"'it'\''s.rs'");
        assert_eq!(quote("a$b"), "'a$b'");
    }

    #[test]
    fn a_home_path_is_shown_with_a_tilde() {
        // SAFETY: the only test that reads HOME, and the only one that writes it.
        unsafe { std::env::set_var("HOME", "/Users/me") };
        assert_eq!(tilde("/Users/me/src"), "~/src");
        assert_eq!(tilde("/tmp/x"), "/tmp/x");
    }
}
