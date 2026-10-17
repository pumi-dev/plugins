//! A dock page of runnable scripts, for `npm-scripts` and `shell-scripts`: the repository
//! around the current pane is walked by a [`Finder`], what it finds is listed in [`Group`]s
//! that fold, and clicking an [`Item`] opens a terminal in its directory and types its
//! command there. It looks again when the current pane or its directory changes, when the
//! finder's options change, and on Rescan.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use pumi_plugin::gpui::{ClickEvent, FontWeight, WeakEntity};
use pumi_plugin::prelude::*;

/// Directories never walked into.
pub const SKIP: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    ".next",
    ".nuxt",
    ".output",
    ".venv",
    "coverage",
];

/// Enough directories for any repository a person keeps scripts in.
const MAX_DIRS: usize = 20_000;

/// One runnable thing: its name, what to show beside it, and the line typed to run it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub name: String,
    pub detail: String,
    pub command: String,
}

/// A directory's (or a package's) items, under a header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    pub label: String,
    /// Where its items run.
    pub dir: PathBuf,
    pub items: Vec<Item>,
}

/// What a package finds in a directory, and how it describes it.
pub trait Finder: 'static {
    /// The items `dir` holds, if any; `root` is the repository's top.
    fn group(&self, dir: &Path, root: &Path) -> Option<Group>;
    /// How deep below the root to look (its option).
    fn depth(&self) -> usize;
    /// Re-read its options.
    fn configure(&mut self);
    /// Whether an item's command shows beside its name.
    fn show_detail(&self) -> bool;
    /// What an empty page says.
    fn empty(&self) -> &'static str;
    /// Its options' prefix (`npm_scripts`), which re-reads them when one changes.
    fn options(&self) -> &'static str;
    /// The groups in the order shown.
    fn sort(&self, groups: &mut [Group]) {
        groups.sort_by(|a, b| a.label.cmp(&b.label));
    }
}

/// The repository around `cwd`: the nearest directory with a `.git`, else `cwd` itself.
pub fn repo_root(cwd: &Path) -> PathBuf {
    cwd.ancestors()
        .find(|dir| dir.join(".git").exists())
        .unwrap_or(cwd)
        .to_path_buf()
}

/// Every group below `root`, `depth` directories down at most, skipping hidden, symlinked
/// and [`SKIP`]ped directories.
pub fn discover(finder: &dyn Finder, root: &Path) -> Vec<Group> {
    let mut found = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let mut visited = 0;
    while let Some((dir, level)) = pending.pop() {
        visited += 1;
        if visited > MAX_DIRS {
            break;
        }
        found.extend(finder.group(&dir, root));
        if level >= finder.depth() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<PathBuf> = entries
            .flatten()
            .filter(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                let dir = entry
                    .file_type()
                    .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink());
                dir && !name.starts_with('.') && !SKIP.contains(&name.as_str())
            })
            .map(|entry| entry.path())
            .collect();
        children.sort();
        pending.extend(children.into_iter().map(|child| (child, level + 1)));
    }
    finder.sort(&mut found);
    found
}

/// `dir` relative to `root`, `.` for the root itself.
pub fn label(dir: &Path, root: &Path) -> String {
    let label = dir.strip_prefix(root).unwrap_or(dir).display().to_string();
    if label.is_empty() { ".".into() } else { label }
}

/// A word as the shell reads it: as it is when it is plain, else single-quoted.
pub fn quote(word: &str) -> String {
    let plain = !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "@._:/-".contains(c));
    if plain {
        word.to_string()
    } else {
        format!("'{}'", word.replace('\'', "'\\''"))
    }
}

/// An option's value, or `None` when it is not set.
pub fn option(name: &str) -> Option<Value> {
    api::option(name, json!({})).ok().filter(|v| !v.is_null())
}

fn plural(n: usize, noun: &str) -> String {
    format!("{n} {noun}{}", if n == 1 { "" } else { "s" })
}

/// Opens a terminal beside the current pane in `dir` and types `command` into it.
fn run(dir: &Path, command: &str) -> Result<(), api::Error> {
    let pane = api::pumi_open_pane(
        "terminal",
        json!({ "cwd": dir.display().to_string() }),
        json!({}),
    )?;
    api::call(
        "pumi_pane_call",
        json!([pane, "input", { "text": format!("{command}\r") }]),
    )
    .map(|_| ())
}

pub struct Panel<F: Finder> {
    finder: F,
    root: PathBuf,
    groups: Vec<Group>,
    folded: BTreeSet<String>,
    noun: &'static str,
}

impl<F: Finder> Panel<F> {
    /// The page, with its rescans hooked up.
    pub fn open(finder: F, noun: &'static str, cx: &mut App) -> Entity<Self> {
        let prefix = finder.options();
        let panel = cx.new(|_| {
            let mut panel = Panel {
                finder,
                root: PathBuf::new(),
                groups: Vec::new(),
                folded: BTreeSet::new(),
                noun,
            };
            panel.rescan(true);
            panel
        });
        let watch = |event: Value, opts: Value, panel: WeakEntity<Self>, configure: bool| {
            let made = api::autocmd(event, opts, move |_, cx| {
                let _ = panel.update(cx, |panel, cx| {
                    if configure {
                        panel.finder.configure();
                    }
                    if panel.rescan(configure) {
                        cx.notify();
                    }
                });
            });
            if let Err(err) = made {
                eprintln!("script-panel: {err}");
            }
        };
        let desc = json!({ "desc": "the scripts page follows the current pane" });
        watch(
            json!(["PaneEnter", "DirChanged", "SessionEnter", "TabEnter"]),
            desc,
            panel.downgrade(),
            false,
        );
        let opts =
            json!({ "pattern": format!("{prefix}.*"), "desc": "the scripts page's options" });
        watch(json!("OptionSet"), opts, panel.downgrade(), true);
        panel
    }

    /// Looks again when the repository changed (or always, with `force`); says whether
    /// anything differs.
    fn rescan(&mut self, force: bool) -> bool {
        let cwd = api::pumi_eval_format("#{pane_current_path}", json!({})).unwrap_or_default();
        let root = repo_root(Path::new(if cwd.is_empty() { "/" } else { &cwd }));
        if !force && root == self.root {
            return false;
        }
        self.root = root;
        let groups = discover(&self.finder, &self.root);
        let changed = groups != self.groups;
        self.groups = groups;
        changed || force
    }
}

impl<F: Finder> Render for Panel<F> {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let items: usize = self.groups.iter().map(|g| g.items.len()).sum();
        let toolbar = div()
            .flex()
            .flex_none()
            .items_center()
            .gap_2()
            .px_2()
            .py_1()
            .text_xs()
            .text_color(rgb(0x9399b2))
            .child(div().flex_1().child(format!(
                "{} · {}",
                plural(items, self.noun),
                plural(self.groups.len(), "place")
            )))
            .child(
                div()
                    .id("rescan")
                    .px_1()
                    .rounded_sm()
                    .cursor_pointer()
                    .hover(|s| s.bg(rgb(0x313244)).text_color(rgb(0xcdd6f4)))
                    .child("Rescan")
                    .on_click(cx.listener(|panel: &mut Self, _: &ClickEvent, _, cx| {
                        panel.finder.configure();
                        panel.rescan(true);
                        cx.notify();
                    })),
            );
        let detail = self.finder.show_detail();
        let mut list = div()
            .id("scripts")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll();
        if self.groups.is_empty() {
            list = list.child(
                div()
                    .px_3()
                    .py_2()
                    .text_xs()
                    .text_color(rgb(0x7f849c))
                    .child(self.finder.empty()),
            );
        }
        for (g, group) in self.groups.iter().enumerate() {
            let open = !self.folded.contains(&group.label);
            let label = group.label.clone();
            list = list.child(
                div()
                    .id(("group", g))
                    .flex()
                    .items_center()
                    .gap_1()
                    .px_2()
                    .h(px(22.))
                    .text_xs()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(rgb(0xbac2de))
                    .cursor_pointer()
                    .hover(|s| s.bg(rgb(0x313244)))
                    .child(if open { "▾" } else { "▸" })
                    .child(div().flex_1().truncate().child(group.label.clone()))
                    .child(
                        div()
                            .text_color(rgb(0x7f849c))
                            .child(group.items.len().to_string()),
                    )
                    .on_click(cx.listener(move |panel: &mut Self, _: &ClickEvent, _, cx| {
                        if !panel.folded.remove(&label) {
                            panel.folded.insert(label.clone());
                        }
                        cx.notify();
                    })),
            );
            if !open {
                continue;
            }
            for (i, item) in group.items.iter().enumerate() {
                let (dir, command) = (group.dir.clone(), item.command.clone());
                list = list.child(
                    div()
                        .id(("item", g * 10_000 + i))
                        .flex()
                        .items_center()
                        .gap_2()
                        .pl(px(22.))
                        .pr_2()
                        .h(px(22.))
                        .text_xs()
                        .text_color(rgb(0xcdd6f4))
                        .cursor_pointer()
                        .hover(|s| s.bg(rgb(0x313244)))
                        .child(div().flex_none().child(item.name.clone()))
                        .when(detail, |row| {
                            row.child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(rgb(0x7f849c))
                                    .child(item.detail.clone()),
                            )
                        })
                        .on_click(cx.listener(move |_, _: &ClickEvent, _, _| {
                            if let Err(err) = run(&dir, &command) {
                                let _ = api::pumi_notify(
                                    &format!("{command}: {err}"),
                                    Some("error"),
                                    json!({}),
                                );
                            }
                        })),
                );
            }
        }
        div()
            .class("script-panel")
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(0x1e1e2e))
            .child(toolbar)
            .child(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_are_quoted_only_when_they_must_be() {
        assert_eq!(quote("build"), "build");
        assert_eq!(quote("test:unit"), "test:unit");
        assert_eq!(quote("it's"), "'it'\\''s'");
        assert_eq!(quote("a b"), "'a b'");
    }

    #[test]
    fn the_root_is_the_repository_and_labels_are_inside_it() {
        let root = std::env::temp_dir().join(format!("script-panel-{}", std::process::id()));
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("tools/a")).unwrap();
        assert_eq!(repo_root(&root.join("tools/a")), root);
        assert_eq!(label(&root.join("tools/a"), &root), "tools/a");
        assert_eq!(label(&root, &root), ".");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
