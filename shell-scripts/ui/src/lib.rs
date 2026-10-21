//! `shell-scripts.scripts`: every shell script in the current pane's repository, grouped by
//! directory. A script is a file with one of the extensions the options name, or (with
//! `shell_scripts.shebang`) a file with no extension whose `#!` names a shell. It runs with
//! the shell its `#!` names (through `env` and its switches), else its extension's, else `sh`,
//! named to the shell rather than run as `./x`, so a script without its executable bit runs.
//!
//! `init` is the package's own half, with no Lua left in it: the options it declares and its
//! page in the left sidebar.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::Path;

use pumi_plugin::prelude::*;
use script_panel::{Finder, Group, Item, Panel, label, option, quote};

const SHELLS: &[&str] = &["sh", "bash", "zsh", "ksh", "dash", "ash", "fish"];
const DEFAULT_EXTENSIONS: &str = "sh, bash, zsh, ksh, fish";
/// How much of a file is read for its `#!` line.
const HEAD: usize = 160;

struct Scripts {
    depth: usize,
    extensions: BTreeSet<String>,
    shebang: bool,
    show_command: bool,
}

impl Scripts {
    fn read() -> Self {
        let text = option("shell_scripts.extensions").and_then(|v| v.as_str().map(str::to_string));
        Scripts {
            depth: option("shell_scripts.max_depth")
                .and_then(|v| v.as_u64())
                .unwrap_or(4)
                .clamp(1, 10) as usize,
            extensions: parse_extensions(text.as_deref().unwrap_or(DEFAULT_EXTENSIONS)),
            shebang: option("shell_scripts.shebang")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            show_command: option("shell_scripts.show_command")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
        }
    }

    /// The shell `path` (named `name`) runs with, if it is a script.
    fn interpreter(&self, name: &str, path: &Path) -> Option<String> {
        let extension = Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        let named = extension
            .as_deref()
            .is_some_and(|e| self.extensions.contains(e));
        if !named && (!self.shebang || extension.is_some()) {
            return None;
        }
        let shebang = first_line(path).and_then(|line| shell_of(&line));
        match (shebang, named) {
            (Some(shell), _) => Some(shell),
            (None, true) => Some(
                extension
                    .filter(|e| SHELLS.contains(&e.as_str()))
                    .unwrap_or_else(|| "sh".into()),
            ),
            (None, false) => None,
        }
    }
}

/// `sh, .bash ,ZSH` as `{bash, sh, zsh}`.
pub fn parse_extensions(text: &str) -> BTreeSet<String> {
    text.split(',')
        .map(|name| name.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|name| {
            !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-')
        })
        .collect()
}

/// The shell a `#!` line names, seen through `env` and its switches.
pub fn shell_of(line: &str) -> Option<String> {
    let mut words = line.trim().strip_prefix("#!")?.split_whitespace();
    let base = |word: &str| {
        Path::new(word)
            .file_name()
            .map(|n| n.to_string_lossy().to_ascii_lowercase())
    };
    let first = base(words.next()?)?;
    let shell = if first == "env" {
        base(words.find(|w| !w.starts_with('-'))?)?
    } else {
        first
    };
    SHELLS.contains(&shell.as_str()).then_some(shell)
}

fn first_line(path: &Path) -> Option<String> {
    let mut buffer = [0u8; HEAD];
    let read = std::fs::File::open(path).ok()?.read(&mut buffer).ok()?;
    let text = String::from_utf8_lossy(&buffer[..read]);
    text.lines()
        .next()
        .filter(|line| line.starts_with("#!"))
        .map(str::to_string)
}

impl Finder for Scripts {
    fn group(&self, dir: &Path, root: &Path) -> Option<Group> {
        let mut files: Vec<(String, std::path::PathBuf)> = std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|kind| kind.is_file()))
            .filter_map(|e| Some((e.file_name().to_str()?.to_string(), e.path())))
            .filter(|(name, _)| !name.starts_with('.'))
            .collect();
        files.sort();
        let items: Vec<Item> = files
            .into_iter()
            .filter_map(|(name, path)| {
                let shell = self.interpreter(&name, &path)?;
                let command = format!("{shell} {}", quote(&name));
                Some(Item {
                    detail: command.clone(),
                    name,
                    command,
                })
            })
            .collect();
        (!items.is_empty()).then(|| Group {
            label: label(dir, root),
            dir: dir.to_path_buf(),
            items,
        })
    }

    fn depth(&self) -> usize {
        self.depth
    }

    fn configure(&mut self) {
        *self = Self::read();
    }

    fn show_detail(&self) -> bool {
        self.show_command
    }

    fn empty(&self) -> &'static str {
        "No shell scripts found"
    }

    fn options(&self) -> &'static str {
        "shell_scripts"
    }
}

/// Declare one of its options, in its heading in Settings.
fn declare_option(name: &str, mut spec: Value) {
    spec["group"] = json!("Shell Scripts");
    if let Err(err) = api::pumi_create_option(&format!("shell_scripts.{name}"), spec) {
        eprintln!("shell-scripts: {err}");
    }
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    declare_option(
        "show_command",
        json!({ "type": "boolean", "default": true, "label": "Commands", "desc": "Show how each script runs, beside its name." }),
    );
    declare_option(
        "max_depth",
        json!({ "type": "number", "default": 4, "min": 1, "max": 10, "step": 1, "label": "Depth", "desc": "How many directories below the repository root to look in." }),
    );
    declare_option(
        "extensions",
        json!({ "type": "string", "default": DEFAULT_EXTENSIONS, "label": "Extensions", "desc": "Which file extensions are scripts, separated by commas." }),
    );
    declare_option(
        "shebang",
        json!({ "type": "boolean", "default": true, "label": "#! files", "desc": "Also list files with no extension whose first line names a shell." }),
    );
    // Its page in the left sidebar, unless a reload already left one there.
    let missing = api::pumi_list_panes(json!({ "type": "shell-scripts.scripts" }))
        .map(|panes| panes.as_array().is_none_or(|list| list.is_empty()))
        .unwrap_or(false);
    if missing {
        let place = json!({ "kind": "slot", "slot": "sidebar.left", "order": 31, "focus": false });
        match api::pumi_open_pane("shell-scripts.scripts", json!({}), place) {
            Ok(pane) => {
                let _ = api::set_option("title", json!("Shell Scripts"), json!({ "pane": pane }));
                let _ = api::set_option("@icon", json!("terminal"), json!({ "pane": pane }));
            }
            Err(err) => eprintln!("shell-scripts: {err}"),
        }
    }
    plugin.view("scripts", |_open, _window, cx| {
        Panel::open(Scripts::read(), "script", cx).into()
    });
}

pumi_plugin::plugin!(init, api = 1);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shebangs_name_their_shell() {
        assert_eq!(shell_of("#!/bin/bash").as_deref(), Some("bash"));
        assert_eq!(shell_of("#!/usr/bin/env -S zsh -e").as_deref(), Some("zsh"));
        assert_eq!(shell_of("#!/usr/bin/env python3"), None);
        assert_eq!(
            parse_extensions("sh, .Bash ,, bad ext"),
            BTreeSet::from(["bash".into(), "sh".into()])
        );
    }

    #[test]
    fn scripts_are_found_and_run_with_their_shell() {
        let root = std::env::temp_dir().join(format!("shell-scripts-{}", std::process::id()));
        let write = |path: &str, text: &str| {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        };
        std::fs::create_dir_all(root.join(".git")).unwrap();
        write("scripts/build.sh", "#!/usr/bin/env bash\necho hi\n");
        write("scripts/deploy", "#!/bin/zsh\n");
        write("scripts/tool.py", "#!/usr/bin/env python3\n");
        write("scripts/notes", "just text\n");
        let finder = Scripts {
            depth: 4,
            extensions: parse_extensions(DEFAULT_EXTENSIONS),
            shebang: true,
            show_command: true,
        };
        let groups = script_panel::discover(&finder, &root);
        let found: Vec<&str> = groups
            .iter()
            .flat_map(|g| g.items.iter().map(|i| i.command.as_str()))
            .collect();
        assert_eq!(found, ["bash build.sh", "zsh deploy"]);
        assert_eq!(groups[0].label, "scripts");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
