//! Pele, run by whichever JavaScript runtime the machine has.
//!
//! One process per rendering: a request on stdin, an answer on stdout, both one JSON line. The
//! plugin caches what came back, so a diagram is priced once and redrawn from memory; a new
//! diagram costs a runtime's start (~40 ms for node, ~150 ms for bun).
//!
//! Neither the runtime nor the script is looked for from inside the sandbox: a linked package's
//! directory is a symlink, and WASI will not follow one (which is why a package's own assets are
//! asked of the app instead). The program runs natively, so the plugin hands it the path and
//! believes it when it answers.

use pumi_plugin::{api, system, Value};
use serde_json::json;
use std::cell::RefCell;
use std::path::{Path, PathBuf};

/// What Pele answered: the SVG in two shapes, and what it drew.
#[derive(Debug, Clone)]
pub struct Rendered {
    /// The theme's colours resolved into it: what the rasteriser paints.
    pub svg: String,
    /// Pele's own: `var(--pele-*, …)` with its defaults, themeable wherever it is put.
    pub raw: String,
    /// Where the faces it is set in are, readable by the plugin (`…/fonts/…ttf`).
    pub fonts: Vec<String>,
    /// Mermaid's own name for the kind of diagram (`flowchart`, `sequenceDiagram`, …).
    pub kind: String,
    pub width: f32,
    pub height: f32,
}

thread_local! {
    /// Which program runs Pele, once one has answered. Finding it is a matter of trying, so
    /// the answer is kept.
    static RUNTIME: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Renders `source`, asking Pele through a runtime `bun` or `node`.
pub fn run(source: &str, themed: bool) -> Result<Rendered, api::Error> {
    let request = json!({
        "source": source,
        "fontFamily": crate::theme::font(),
        "fontFamilyMono": crate::theme::mono(),
        "fontSize": crate::theme::font_size(),
        // Where the runtime may put the fonts the plugin rasterises with: it reads the package
        // (a symlink WASI will not follow), and writes them where the plugin can read them.
        "dataDir": api::plugin()["data"],
        "vars": if themed { crate::theme::vars() } else { json!({}) },
    })
    .to_string();
    let script = script();
    let mut why = Vec::new();
    for program in programs() {
        let output = system::Command::new(&program).arg(&script).stdin(request.clone()).run();
        match output {
            // The program is there and said something: whether it drew the diagram is its
            // answer's to say, so nothing else is tried.
            Ok(output) => {
                RUNTIME.with(|runtime| *runtime.borrow_mut() = Some(program.clone()));
                return answer(&program, output);
            }
            Err(err) => why.push(format!("{program}: {err}")),
        }
    }
    RUNTIME.with(|runtime| *runtime.borrow_mut() = None);
    if why.is_empty() {
        return Err(no_runtime());
    }
    Err(api::Error::new(
        "not_found",
        format!("marmaide draws with Pele, which is JavaScript, and no runtime answered ({}). Install bun or node, or say where one is in the option `marmaide.runtime`.", why.join("; ")),
    ))
}

fn answer(program: &str, output: system::Output) -> Result<Rendered, api::Error> {
    let stdout = output.stdout_text();
    // Pele's answer is the last line: a runtime may say things of its own before it.
    let line = stdout.lines().rfind(|line| !line.trim().is_empty()).unwrap_or("").trim();
    if line.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(api::Error::new(
            "render",
            format!("{program} drew nothing (status {}): {}", output.status, stderr.trim()),
        ));
    }
    let answer: Value = serde_json::from_str(line)
        .map_err(|err| api::Error::new("render", format!("{program} answered something else: {err}: {line}")))?;
    if let Some(error) = answer.get("error").filter(|error| !error.is_null()) {
        let kind = error["kind"].as_str().unwrap_or("render").to_string();
        let message = error["message"].as_str().unwrap_or("Pele could not draw that").to_string();
        return Err(api::Error::new(&kind, message));
    }
    let text = |key: &str| answer[key].as_str().unwrap_or_default().to_string();
    Ok(Rendered {
        svg: text("svg"),
        raw: text("raw"),
        fonts: answer["fonts"].as_array().map(|fonts| fonts.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default(),
        kind: text("type"),
        width: answer["width"].as_f64().unwrap_or(0.) as f32,
        height: answer["height"].as_f64().unwrap_or(0.) as f32,
    })
}

/// The programs to try, in order: the `runtime` option when it names one — alone, because a
/// name asked for is a name to believe — else what the runtimes are usually called, where they
/// usually are. The app is often started from a menu, with a `PATH` that knows neither.
fn programs() -> Vec<String> {
    if let Some(configured) =
        api::option("marmaide.runtime", json!({})).ok().and_then(|value| value.as_str().map(str::trim).filter(|p| !p.is_empty()).map(str::to_string))
    {
        return vec![configured];
    }
    if let Some(found) = RUNTIME.with(|runtime| runtime.borrow().clone()) {
        return vec![found];
    }
    candidates().into_iter().map(|path| path.to_string_lossy().into_owned()).collect()
}

/// `render.mjs`, beside this package's files.
fn script() -> String {
    let dir = api::plugin()["dir"].as_str().unwrap_or_default().to_string();
    // A linked package's directory is a symlink, which WASI will not stat for us: the path is
    // the program's to follow, so it is handed over as it is.
    if dir.is_empty() { "render.mjs".to_string() } else { Path::new(&dir).join("render.mjs").to_string_lossy().into_owned() }
}

fn no_runtime() -> api::Error {
    api::Error::new(
        "not_found",
        "marmaide draws with Pele, which is JavaScript: install bun or node, or say where one is in the option `marmaide.runtime`",
    )
}

/// The places a JavaScript runtime is, in the order it is preferred.
fn candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();
    let path = std::env::var("PATH").unwrap_or_default();
    let add = |out: &mut Vec<PathBuf>, dir: &Path| {
        for name in ["bun", "node"] {
            out.push(dir.join(name));
        }
    };
    for dir in path.split(':').filter(|dir| !dir.is_empty()) {
        add(&mut out, Path::new(dir));
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        add(&mut out, Path::new(dir));
    }
    if !home.is_empty() {
        for dir in [".bun/bin", ".local/bin", ".volta/bin", ".local/share/fnm/aliases/default/bin"] {
            add(&mut out, Path::new(&format!("{home}/{dir}")));
        }
        // nvm keeps one directory per version; the newest one is the likeliest to be there.
        if let Ok(versions) = std::fs::read_dir(format!("{home}/.nvm/versions/node")) {
            let mut dirs: Vec<PathBuf> = versions.flatten().map(|entry| entry.path().join("bin")).collect();
            dirs.sort();
            dirs.reverse();
            for dir in dirs {
                out.push(dir.join("node"));
            }
        }
    }
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// The package's own renderer, run the way the plugin runs it: through a real runtime.
    fn render(source: &str) -> Value {
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../render.mjs");
        let program = candidates()
            .into_iter()
            .find(|path| path.is_file())
            .expect("a JavaScript runtime (bun or node) on this machine");
        let mut child = std::process::Command::new(program)
            .arg(script)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("the runtime starts");
        let request = json!({
            "source": source,
            "fontFamily": "IBM Plex Sans",
            "fontFamilyMono": "Lilex",
            "vars": {
                "--pele-fg": "#c8c8c8",
                "--pele-bg": "#1e1e1e",
                "--pele-line": "#8a8a8a",
                "--pele-surface": "#2a2a2a",
                "--pele-border": "#555555",
                "--pele-accent": "#7aa2f7",
                "--pele-radius": "6px",
            },
        });
        writeln!(child.stdin.take().unwrap(), "{request}").unwrap();
        let out = child.wait_with_output().unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        serde_json::from_str(stdout.lines().next().expect("an answer")).expect("JSON")
    }

    #[test]
    fn pele_draws_a_flowchart() {
        let answer = render("flowchart LR\n  ask[an agent] --> draw{marmaide}\n  draw --> look");
        assert_eq!(answer["type"], "flowchart");
        assert!(answer["width"].as_f64().unwrap() > 100.);
        assert!(answer["svg"].as_str().unwrap().contains("<text"));
        // The theme's colours are resolved into what a rasteriser can read…
        assert!(!answer["svg"].as_str().unwrap().contains("var("), "{}", answer["svg"]);
        assert!(answer["svg"].as_str().unwrap().contains("#c8c8c8"));
        // …and Pele's own SVG keeps the variables, so a file themes wherever it lands.
        assert!(answer["raw"].as_str().unwrap().contains("var(--pele-fg"));
    }

    #[test]
    fn a_bad_diagram_says_why() {
        let answer = render("notadiagram\n  ???");
        assert!(answer["error"]["message"].as_str().is_some_and(|why| !why.is_empty()));
    }
}
