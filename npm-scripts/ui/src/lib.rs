//! `npm-scripts.scripts`: every `package.json` with scripts in the current pane's repository,
//! each script run with the package's own manager: its `packageManager` field (corepack's
//! `"pnpm@9.1.0"`), else the first lockfile from its directory up to the root, else npm.
//!
//! `init` is the package's own half, with no Lua left in it: the options it declares and its
//! page in the left sidebar.

use std::path::Path;

use pumi_plugin::prelude::*;
use script_panel::{Finder, Group, Item, Panel, label, option, quote};

const LOCKFILES: &[(&str, &str)] = &[
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("bun.lockb", "bun"),
    ("bun.lock", "bun"),
    ("package-lock.json", "npm"),
];

struct Packages {
    depth: usize,
    by_count: bool,
    show_command: bool,
}

impl Packages {
    fn read() -> Self {
        Packages {
            depth: option("npm_scripts.max_depth")
                .and_then(|v| v.as_u64())
                .unwrap_or(4)
                .clamp(1, 10) as usize,
            by_count: option("npm_scripts.sort").is_some_and(|v| v == "scripts"),
            show_command: option("npm_scripts.show_command")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
        }
    }
}

/// The package's manager, by name.
pub fn manager(manifest: &Value, dir: &Path, root: &Path) -> String {
    if let Some(name) = manifest["packageManager"]
        .as_str()
        .and_then(|n| n.split('@').next())
        .filter(|n| !n.is_empty())
    {
        return name.to_string();
    }
    for dir in dir.ancestors() {
        if let Some((_, manager)) = LOCKFILES.iter().find(|(file, _)| dir.join(file).is_file()) {
            return manager.to_string();
        }
        if dir == root {
            break;
        }
    }
    "npm".to_string()
}

impl Finder for Packages {
    fn group(&self, dir: &Path, root: &Path) -> Option<Group> {
        let manifest: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("package.json")).ok()?).ok()?;
        let manager = manager(&manifest, dir, root);
        let items: Vec<Item> = manifest["scripts"]
            .as_object()?
            .iter()
            .filter_map(|(name, command)| {
                let run = format!("{manager} run {}", quote(name));
                Some(Item {
                    name: name.clone(),
                    detail: command.as_str()?.to_string(),
                    command: run,
                })
            })
            .collect();
        let label = label(&dir.join("package.json"), root);
        (!items.is_empty()).then(|| Group {
            label,
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
        "No package.json with scripts found"
    }

    fn options(&self) -> &'static str {
        "npm_scripts"
    }

    fn sort(&self, groups: &mut [Group]) {
        groups.sort_by(|a, b| a.label.cmp(&b.label));
        if self.by_count {
            groups.sort_by(|a, b| b.items.len().cmp(&a.items.len()));
        }
    }
}

/// Declare one of its options, in its heading in Settings.
fn declare_option(name: &str, mut spec: Value) {
    spec["group"] = json!("NPM Scripts");
    if let Err(err) = api::pumi_create_option(&format!("npm_scripts.{name}"), spec) {
        eprintln!("npm-scripts: {err}");
    }
}

fn init(plugin: &mut Plugin, _cx: &mut App) {
    declare_option(
        "show_command",
        json!({ "type": "boolean", "default": true, "label": "Commands", "desc": "Show what each script runs, beside its name." }),
    );
    declare_option(
        "sort",
        json!({ "type": "string", "default": "path", "choices": ["path", "scripts"], "labels": ["Path", "Most scripts first"], "label": "Order packages by", "desc": "How the package.json files are listed." }),
    );
    declare_option(
        "max_depth",
        json!({ "type": "number", "default": 4, "min": 1, "max": 10, "step": 1, "label": "Depth", "desc": "How many directories below the repository root to look in." }),
    );
    // Its page in the left sidebar, unless a reload already left one there.
    let missing = api::pumi_list_panes(json!({ "type": "npm-scripts.scripts" }))
        .map(|panes| panes.as_array().is_none_or(|list| list.is_empty()))
        .unwrap_or(false);
    if missing {
        let place = json!({ "kind": "slot", "slot": "sidebar.left", "order": 30, "focus": false });
        match api::pumi_open_pane("npm-scripts.scripts", json!({}), place) {
            Ok(pane) => {
                let _ = api::set_option("title", json!("NPM Scripts"), json!({ "pane": pane }));
                let _ = api::set_option("@icon", json!("package"), json!({ "pane": pane }));
            }
            Err(err) => eprintln!("npm-scripts: {err}"),
        }
    }
    plugin.view("scripts", |_open, _window, cx| {
        Panel::open(Packages::read(), "script", cx).into()
    });
}

pumi_plugin::plugin!(init);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packages_are_found_with_their_manager_and_node_modules_is_skipped() {
        let root = std::env::temp_dir().join(format!("npm-scripts-{}", std::process::id()));
        let write = |path: &str, text: &str| {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        };
        std::fs::create_dir_all(root.join(".git")).unwrap();
        write(
            "package.json",
            r#"{ "packageManager": "pnpm@9.1.0", "scripts": { "build": "tsc -p ." } }"#,
        );
        write(
            "tools/a/package.json",
            r#"{ "scripts": { "test:unit": "vitest" } }"#,
        );
        write("tools/a/yarn.lock", "");
        write(
            "tools/a/node_modules/x/package.json",
            r#"{ "scripts": { "x": "x" } }"#,
        );
        write("empty/package.json", r#"{ "name": "no scripts" }"#);
        let finder = Packages {
            depth: 4,
            by_count: false,
            show_command: true,
        };
        let groups = script_panel::discover(&finder, &root);
        let found: Vec<(&str, &str)> = groups
            .iter()
            .map(|g| (g.label.as_str(), g.items[0].command.as_str()))
            .collect();
        assert_eq!(
            found,
            [
                ("package.json", "pnpm run build"),
                ("tools/a/package.json", "yarn run test:unit")
            ]
        );
        std::fs::remove_dir_all(&root).unwrap();
    }
}
