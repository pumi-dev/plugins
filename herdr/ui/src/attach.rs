//! `herdr-client.sock`: herdr's direct terminal attach, on pumi's terminals.
//!
//! herdr's mobile apps show a pane live by running `herdr agent attach <pane>` (or `herdr
//! terminal attach <terminal>`) in a PTY over SSH. That command is herdr's own client: it asks
//! `herdr.sock` which terminal the agent is in (`agent.get`, answered by [`crate::api`]), opens
//! `herdr-client.sock` beside it, says hello with its size, and writes whatever terminal bytes
//! it is sent to its terminal, sending back what is typed.
//!
//! herdr's server draws those bytes from a screen it keeps. pumi keeps none (the core relays a
//! program's output, and each client runs its own terminal), and a terminal at the far end of
//! herdr's client is exactly such a client: so each attach here is a client of pumi's grid
//! socket for that pane, its snapshot and output passed through as herdr's terminal frames,
//! and the input, resizes, pastes and mouse herdr's client sends turned into the grid's own.
//!
//! An attach controls the pane, as herdr's does: its size is the pane's while it lasts, and
//! the app's view gets control back when someone types there.

use std::cell::RefCell;
use std::collections::BTreeMap;

use pumi_plugin::system::{self, SocketEvent};
use serde_json::{Value, json};

use crate::grid::{self, AttachClient, AttachServer, Mode, Size};
use crate::proto::wire::{
    self, ClientMessage, Decoded, MouseKind, RenderEncoding, ScrollDirection, ScrollSource, ServerMessage,
};

/// A screen to draw a snapshot on: home, and erase.
const CLEAR: &[u8] = b"\x1b[H\x1b[2J";

/// One of herdr's clients.
struct Client {
    buf: Vec<u8>,
    /// Its size, from its hello and resizes.
    size: Size,
    /// It said hello and was welcomed.
    welcomed: bool,
    /// The pane it is attached to, and its terminal id as herdr names it.
    pane: Option<(u64, String)>,
    /// Its connection to the grid socket.
    grid: Option<u64>,
    grid_buf: Vec<u8>,
    /// The grid's welcome came.
    grid_welcomed: bool,
    seq: u64,
}

#[derive(Default)]
struct State {
    clients: BTreeMap<u64, Client>,
    /// A grid connection's client.
    grids: BTreeMap<u64, u64>,
    /// Where the grid socket is.
    grid_path: String,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|state| f(&mut state.borrow_mut()))
}

/// Serve herdr's client socket at `path`, attaching to the terminals of the grid socket at
/// `grid_path`. The listener goes when the plugin stops.
pub fn serve(path: &str, grid_path: &str) -> Result<u64, String> {
    with(|state| state.grid_path = grid_path.to_string());
    system::listen(path, |conn, event, _cx| match event {
        SocketEvent::Accepted => accepted(conn),
        SocketEvent::Closed => end(conn, None),
        SocketEvent::Data(bytes) => data(conn, &bytes),
    })
}

fn accepted(conn: u64) {
    let client = Client {
        buf: Vec::new(),
        size: Size::default(),
        welcomed: false,
        pane: None,
        grid: None,
        grid_buf: Vec::new(),
        grid_welcomed: false,
        seq: 0,
    };
    with(|state| state.clients.insert(conn, client));
}

/// The client's attach is over: it is told why (when it is still there), and both
/// connections close.
fn end(conn: u64, reason: Option<String>) {
    let Some(client) = with(|state| {
        let client = state.clients.remove(&conn)?;
        if let Some(grid) = client.grid {
            state.grids.remove(&grid);
        }
        Some(client)
    }) else {
        return;
    };
    if let Some(reason) = reason {
        crate::log(&match &client.pane {
            Some((pane, terminal)) => format!("attach {terminal} (%{pane}) ended: {reason}"),
            None => format!("herdr's client ended: {reason}"),
        });
        let _ = system::send(conn, &wire::encode(&ServerMessage::ServerShutdown { reason: Some(reason) }));
    }
    if let Some(grid) = client.grid {
        system::close(grid);
    }
    system::close(conn);
}

fn send(conn: u64, bytes: &[u8]) {
    if system::send(conn, bytes).is_err() {
        end(conn, None);
    }
}

fn data(conn: u64, bytes: &[u8]) {
    let frames = with(|state| {
        let client = state.clients.get_mut(&conn)?;
        client.buf.extend_from_slice(bytes);
        Some(wire::drain(&mut client.buf))
    });
    match frames {
        None => {}
        Some(Err(err)) => {
            crate::log(&format!("herdr client: {err}"));
            end(conn, None);
        }
        Some(Ok(frames)) => {
            for frame in frames {
                if let Decoded::Message(msg) = frame {
                    message(conn, msg);
                }
            }
        }
    }
}

fn message(conn: u64, msg: ClientMessage) {
    let Some((welcomed, attached)) = with(|state| state.clients.get(&conn).map(|c| (c.welcomed, c.pane.is_some())))
    else {
        return;
    };
    match msg {
        ClientMessage::TerminalHello { version, cols, rows, cell_width_px, cell_height_px, .. } if !welcomed => {
            let error = (version != wire::PROTOCOL_VERSION).then(|| {
                format!(
                    "pumi's herdr package speaks herdr's protocol {}, this client {version}: use herdr {}",
                    wire::PROTOCOL_VERSION,
                    crate::proto::HERDR_VERSION
                )
            });
            let refused = error.is_some();
            let welcome = ServerMessage::Welcome { version: wire::PROTOCOL_VERSION, encoding: RenderEncoding::TerminalAnsi, error };
            with(|state| {
                if let Some(client) = state.clients.get_mut(&conn) {
                    client.welcomed = !refused;
                    client.size = Size { cols, rows, cell_width: cell_width_px, cell_height: cell_height_px };
                }
            });
            send(conn, &wire::encode(&welcome));
            if refused {
                end(conn, None);
            }
        }
        ClientMessage::EndpointControl { .. } if !welcomed => {
            // herdr's own TUI (a client-owned shell): it needs herdr's server.
            end(conn, Some("pumi serves herdr's terminal attach, not herdr's TUI".into()));
        }
        _ if !welcomed => end(conn, Some("expected TerminalHello".into())),
        ClientMessage::AttachTerminal { terminal_id: target, .. } | ClientMessage::ControlTerminal { target, .. }
            if !attached =>
        {
            attach(conn, &target, Mode::Control)
        }
        ClientMessage::ObserveTerminal { target } if !attached => attach(conn, &target, Mode::Observe),
        ClientMessage::Detach => end(conn, Some("detached".into())),
        _ if !attached => {}
        ClientMessage::Input { data } => to_grid(conn, &input(data)),
        ClientMessage::Resize { cols, rows, cell_width_px, cell_height_px, .. } => {
            let size = Size { cols, rows, cell_width: cell_width_px, cell_height: cell_height_px };
            with(|state| state.clients.get_mut(&conn).map(|c| c.size = size));
            to_grid(conn, &AttachClient::Resize(size));
        }
        ClientMessage::AttachScroll { source: ScrollSource::PageKey { input }, .. } => {
            to_grid(conn, &AttachClient::Input(input));
        }
        ClientMessage::AttachScroll { source: ScrollSource::Wheel, direction, lines, column, row, modifiers } => {
            let kind = match direction {
                ScrollDirection::Up => MouseKind::ScrollUp,
                ScrollDirection::Down => MouseKind::ScrollDown,
            };
            mouse(conn, kind, column.unwrap_or(0), row.unwrap_or(0), modifiers, lines);
        }
        ClientMessage::AttachMouse { kind, position, modifiers, lines, .. } => {
            let (column, row) = position.cell();
            mouse(conn, kind, column, row, modifiers, lines);
        }
        // Clipboard images, herdr's graphics and its shell's messages have no pumi side.
        _ => {}
    }
}

/// Typed bytes; a whole bracketed paste is a paste, which pumi brackets only when the
/// program asked for it (herdr's client turns bracketed paste on for its own terminal).
fn input(data: Vec<u8>) -> AttachClient {
    const START: &[u8] = b"\x1b[200~";
    const END: &[u8] = b"\x1b[201~";
    if data.len() >= START.len() + END.len() && data.starts_with(START) && data.ends_with(END) {
        let text = &data[START.len()..data.len() - END.len()];
        return AttachClient::Paste(String::from_utf8_lossy(text).into_owned());
    }
    AttachClient::Input(data)
}

/// The pane `target` names, and herdr's id of its terminal.
fn resolve(target: &str) -> Option<(u64, String)> {
    let view = crate::api::Herdr.view().ok()?;
    let pane = view.pane(target)?;
    Some((pane, crate::proto::ids::terminal(pane)))
}

fn attach(conn: u64, target: &str, mode: Mode) {
    let Some((pane, terminal)) = resolve(target) else {
        return end(conn, Some(format!("terminal attach failed: terminal {target} not found")));
    };
    let path = with(|state| state.grid_path.clone());
    let grid = system::connect(&path, move |grid, event, _cx| match event {
        SocketEvent::Data(bytes) => from_grid(grid, &bytes),
        SocketEvent::Closed => {
            if let Some(conn) = with(|state| state.grids.remove(&grid)) {
                end(conn, Some("terminal attach ended: pumi closed the terminal".into()));
            }
        }
        SocketEvent::Accepted => {}
    });
    let grid = match grid {
        Ok(grid) => grid,
        Err(err) => return end(conn, Some(format!("terminal attach failed: pumi's grid socket: {err}"))),
    };
    let Some(size) = with(|state| {
        let client = state.clients.get_mut(&conn)?;
        client.pane = Some((pane, terminal.clone()));
        client.grid = Some(grid);
        state.grids.insert(grid, conn);
        Some(client.size)
    }) else {
        return system::close(grid);
    };
    crate::log(&format!("attach {terminal} (%{pane}) from herdr's client, {}x{}", size.cols, size.rows));
    // The server reads the hello, answers, then reads the attach: both go now.
    let hello = grid::Hello {
        protocol: grid::PROTOCOL,
        client: "herdr".into(),
        client_version: crate::proto::HERDR_VERSION.into(),
    };
    let attach = grid::ClientMsg::Attach(grid::Attach { pane: format!("%{pane}"), mode, size, budget: None, resume: None });
    let mut bytes = grid::encode(&hello);
    bytes.extend(grid::encode(&attach));
    if system::send(grid, &bytes).is_err() {
        end(conn, Some("terminal attach failed: pumi's grid socket closed".into()));
    }
}

fn to_grid(conn: u64, msg: &AttachClient) {
    let Some(grid) = with(|state| state.clients.get(&conn).and_then(|c| c.grid)) else { return };
    if system::send(grid, &grid::encode(msg)).is_err() {
        end(conn, Some("terminal attach ended: pumi's grid socket closed".into()));
    }
}

/// What the grid sent, as herdr's frames for the client.
fn from_grid(grid: u64, bytes: &[u8]) {
    let Some((conn, frames, welcomed)) = with(|state| {
        let conn = *state.grids.get(&grid)?;
        let client = state.clients.get_mut(&conn)?;
        client.grid_buf.extend_from_slice(bytes);
        Some((conn, grid::frames(&mut client.grid_buf), client.grid_welcomed))
    }) else {
        return;
    };
    let frames = match frames {
        Ok(frames) => frames,
        Err(err) => return end(conn, Some(format!("terminal attach ended: pumi's grid socket: {err}"))),
    };
    let mut welcomed = welcomed;
    for payload in frames {
        if !welcomed {
            match grid::decode::<grid::Welcome>(&payload) {
                Ok(grid::Welcome::Ok { .. }) => {
                    welcomed = true;
                    with(|state| state.clients.get_mut(&conn).map(|c| c.grid_welcomed = true));
                    continue;
                }
                Ok(grid::Welcome::Refused { reason, .. }) => {
                    return end(conn, Some(format!("terminal attach failed: pumi refused: {reason}")));
                }
                Err(err) => return end(conn, Some(format!("terminal attach failed: pumi's grid socket: {err}"))),
            }
        }
        match grid::decode::<AttachServer>(&payload) {
            Ok(msg) => {
                if !server(conn, msg) {
                    return;
                }
            }
            Err(err) => return end(conn, Some(format!("terminal attach ended: pumi's grid socket: {err}"))),
        }
    }
}

/// One message of the grid's, passed on; false when the attach is over.
fn server(conn: u64, msg: AttachServer) -> bool {
    let frame = |full: bool, bytes: &[u8]| {
        with(|state| {
            let client = state.clients.get_mut(&conn)?;
            Some(wire::terminal(&mut client.seq, client.size.cols, client.size.rows, full, bytes))
        })
    };
    match msg {
        AttachServer::Snapshot { bytes, .. } => {
            let mut screen = CLEAR.to_vec();
            screen.extend_from_slice(&crate::queries::strip(&bytes));
            if let Some(out) = frame(true, &screen) {
                send(conn, &out);
            }
        }
        AttachServer::Output { bytes, .. } => {
            if let Some(out) = frame(false, &bytes) {
                send(conn, &out);
            }
        }
        AttachServer::Exited { .. } => {
            let terminal = with(|state| state.clients.get(&conn).and_then(|c| c.pane.clone())).map(|p| p.1);
            end(conn, Some(format!("terminal {} exited", terminal.unwrap_or_default())));
            return false;
        }
        AttachServer::Error(err) => {
            end(conn, Some(format!("terminal attach failed: {err}")));
            return false;
        }
        // The size follows whoever controls the pane; the program redraws for it.
        AttachServer::Resized { .. } | AttachServer::ControlLost | AttachServer::ControlGained => {}
    }
    true
}

/// The DEC private modes of a pane that say how it wants the mouse.
struct MouseModes {
    /// It asked for presses (1000), drags (1002) or all motion (1003).
    buttons: bool,
    drag: bool,
    motion: bool,
    sgr: bool,
    alt_screen: bool,
    cursor_keys: bool,
}

fn modes(pane: u64) -> Option<MouseModes> {
    let value = pumi_plugin::api::call("pumi_pane_call", json!([pane, "modes"])).ok()?;
    let modes = if value.get("dec").is_some() { &value } else { value.get("result")? };
    let on = |mode: u64| {
        modes["dec"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|pair| pair[0].as_u64() == Some(mode) && pair[1] == Value::Bool(true))
    };
    Some(MouseModes {
        buttons: on(1000) || on(1002) || on(1003),
        drag: on(1002) || on(1003),
        motion: on(1003),
        sgr: on(1006),
        alt_screen: modes["alt"].as_bool().unwrap_or(false),
        cursor_keys: on(1),
    })
}

/// A mouse event of herdr's client, as the program asked to hear it: a report when it
/// reports the mouse, a wheel as arrow keys on the alternate screen (as terminals do), and
/// nothing otherwise.
fn mouse(conn: u64, kind: MouseKind, column: u16, row: u16, modifiers: u8, lines: u16) {
    let Some(pane) = with(|state| state.clients.get(&conn).and_then(|c| c.pane.as_ref().map(|p| p.0))) else {
        return;
    };
    let Some(m) = modes(pane) else { return };
    let wheel = matches!(kind, MouseKind::ScrollUp | MouseKind::ScrollDown);
    let wanted = match kind {
        MouseKind::Moved => m.motion,
        MouseKind::Drag(_) => m.drag,
        _ => m.buttons,
    };
    let bytes = if wanted {
        wire::mouse_report(kind, column, row, modifiers, m.sgr)
    } else if wheel && m.alt_screen {
        let key: &[u8] = match (kind, m.cursor_keys) {
            (MouseKind::ScrollUp, true) => b"\x1bOA",
            (MouseKind::ScrollUp, false) => b"\x1b[A",
            (_, true) => b"\x1bOB",
            (_, false) => b"\x1b[B",
        };
        Some(key.repeat(lines.clamp(1, 10) as usize))
    } else {
        None
    };
    if let Some(bytes) = bytes {
        to_grid(conn, &AttachClient::Input(bytes));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_whole_bracketed_paste_is_a_paste() {
        assert_eq!(input(b"\x1b[200~hi\nthere\x1b[201~".to_vec()), AttachClient::Paste("hi\nthere".into()));
        assert_eq!(input(b"\x1b[200~".to_vec()), AttachClient::Input(b"\x1b[200~".to_vec()));
        assert_eq!(input(b"q".to_vec()), AttachClient::Input(b"q".to_vec()));
    }
}
