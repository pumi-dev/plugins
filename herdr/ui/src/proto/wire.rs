//! herdr's client socket (`herdr-client.sock`), as far as a direct terminal attach uses it:
//! `herdr agent attach` and `herdr terminal attach`, which is how herdr's mobile apps show a
//! pane live (they run that command in a PTY over SSH and display what it prints).
//!
//! Frames are a `u32` little-endian length and a bincode 2 payload (`config::standard()`,
//! serde). An enum is its variant's index (a varint) and then its fields, so the enums below
//! keep herdr's variant order exactly; variants a direct attach never sends are placeholders,
//! and a frame whose tag is one of them is skipped whole (its length says where it ends).
//!
//! PROVENANCE: herdr `src/protocol/wire.rs` (`ClientMessage`, `ServerMessage`,
//! `TerminalFrame`, `write_message`, `read_message`) and `src/client/attach.rs` @ v0.9.4
//! (Apache-2.0). herdr freezes `ClientMessage`'s variant order ("endpoint generation 1").

use serde::{Deserialize, Serialize};

/// The private protocol a direct attach checks (`PROTOCOL_VERSION`).
pub const PROTOCOL_VERSION: u32 = 22;

/// The largest frame either side sends (herdr's `MAX_FRAME_SIZE`); a terminal frame is split
/// below it.
pub const MAX_FRAME: usize = 2 * 1024 * 1024;

/// The most terminal bytes put in one frame.
pub const CHUNK: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenderEncoding {
    SemanticFrame,
    TerminalAnsi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MouseKind {
    Down(MouseButton),
    Up(MouseButton),
    Drag(MouseButton),
    Moved,
    ScrollUp,
    ScrollDown,
    ScrollLeft,
    ScrollRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MousePosition {
    Cell { column: u16, row: u16 },
    Pixels { x: u32, y: u32, column: u16, row: u16 },
}

impl MousePosition {
    /// The cell, from 0.
    pub fn cell(self) -> (u16, u16) {
        match self {
            MousePosition::Cell { column, row } | MousePosition::Pixels { column, row, .. } => (column, row),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouseGeometry {
    pub cols: u16,
    pub rows: u16,
    pub width_px: u32,
    pub height_px: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClipboardImageTarget {
    DirectTerminal,
    Pane(String),
    Popup(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScrollDirection {
    Up,
    Down,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScrollSource {
    Wheel,
    /// A page key, with the bytes it was: the program gets them when it owns paging.
    PageKey { input: Vec<u8> },
}

/// What a client sends. Indices 9–15 and 17–20 belong to herdr's own shell and graphics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientMessage {
    TerminalHello { version: u32, cols: u16, rows: u16, cell_width_px: u32, cell_height_px: u32, pixel_mouse: bool },
    Input { data: Vec<u8> },
    ClipboardImage { target: ClipboardImageTarget, extension: String, data: Vec<u8> },
    Resize { cols: u16, rows: u16, cell_width_px: u32, cell_height_px: u32, pixel_mouse: bool },
    Detach,
    AttachTerminal { terminal_id: String, takeover: bool },
    AttachScroll {
        source: ScrollSource,
        direction: ScrollDirection,
        lines: u16,
        column: Option<u16>,
        row: Option<u16>,
        modifiers: u8,
    },
    ObserveTerminal { target: String },
    ControlTerminal { target: String, takeover: bool },
    GraphicsTransmissionResult,
    GraphicsTransmissionStarted,
    ClientShellHello,
    ClientShellResize,
    ClientShellPaneInput,
    ClientShellPopupInput,
    ClientShellEndpointRequest,
    AttachMouse { kind: MouseKind, position: MousePosition, geometry: Option<MouseGeometry>, modifiers: u8, lines: u16 },
    ClientShellHostTheme,
    ClientShellFocus,
    ClientShellMouseCapture,
    EndpointControl { kind: String, data: String },
}

/// The variants of [`ClientMessage`] that carry what they say (the rest are skipped).
const DECODED: &[u32] = &[0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 20];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalFrame {
    pub seq: u64,
    pub width: u16,
    pub height: u16,
    /// A full redraw rather than a diff.
    pub full: bool,
    /// Bytes the client writes to its terminal as they are.
    pub bytes: Vec<u8>,
}

/// What the server sends; only the first four are sent here (the order is herdr's).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServerMessage {
    Welcome { version: u32, encoding: RenderEncoding, error: Option<String> },
    Terminal(TerminalFrame),
    Graphics { bytes: Vec<u8> },
    /// The attach is over; the client exits, quietly when the reason is `detached`.
    ServerShutdown { reason: Option<String> },
}

fn config() -> bincode::config::Configuration {
    bincode::config::standard()
}

/// One message as a frame: the length, then the payload.
pub fn encode(msg: &ServerMessage) -> Vec<u8> {
    let payload = bincode::serde::encode_to_vec(msg, config()).expect("plain data encodes");
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(&payload);
    frame
}

/// What one frame held.
#[derive(Debug, PartialEq, Eq)]
pub enum Decoded {
    Message(ClientMessage),
    /// A variant a direct attach does not use.
    Skipped(u32),
}

/// The complete frames at the front of `buf`, which loses them; a partial frame stays.
/// An oversized or undecodable frame is an error: the connection is not herdr's.
pub fn drain(buf: &mut Vec<u8>) -> Result<Vec<Decoded>, String> {
    let mut out = Vec::new();
    let mut at = 0;
    while buf.len() - at >= 4 {
        let len = u32::from_le_bytes(buf[at..at + 4].try_into().expect("four bytes")) as usize;
        if len > MAX_FRAME {
            return Err(format!("a frame of {len} bytes"));
        }
        if buf.len() - at - 4 < len {
            break;
        }
        let payload = &buf[at + 4..at + 4 + len];
        at += 4 + len;
        out.push(decode(payload)?);
    }
    buf.drain(..at);
    Ok(out)
}

fn decode(payload: &[u8]) -> Result<Decoded, String> {
    let (tag, _): (u32, usize) = bincode::decode_from_slice(payload, config()).map_err(|e| e.to_string())?;
    if !DECODED.contains(&tag) {
        return Ok(Decoded::Skipped(tag));
    }
    let (msg, used): (ClientMessage, usize) =
        bincode::serde::decode_from_slice(payload, config()).map_err(|e| e.to_string())?;
    if used != payload.len() {
        return Err(format!("{} bytes after a message", payload.len() - used));
    }
    Ok(Decoded::Message(msg))
}

/// Terminal bytes as frames, each under [`MAX_FRAME`]. `seq` counts frames.
pub fn terminal(seq: &mut u64, cols: u16, rows: u16, full: bool, bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + 32);
    for (i, chunk) in bytes.chunks(CHUNK).enumerate() {
        *seq += 1;
        let frame = TerminalFrame { seq: *seq, width: cols, height: rows, full: full && i == 0, bytes: chunk.to_vec() };
        out.extend(encode(&ServerMessage::Terminal(frame)));
    }
    out
}

/// A mouse event as the program asked to hear it: SGR (1006) when it set that, else the
/// legacy encoding (which cannot say a cell past 222). `modifiers` are crossterm's bits
/// (shift 1, control 2, alt 4), as herdr's client sends them.
pub fn mouse_report(kind: MouseKind, column: u16, row: u16, modifiers: u8, sgr: bool) -> Option<Vec<u8>> {
    let button = |b: MouseButton| match b {
        MouseButton::Left => 0u16,
        MouseButton::Middle => 1,
        MouseButton::Right => 2,
    };
    let (code, release) = match kind {
        MouseKind::Down(b) => (button(b), false),
        MouseKind::Up(b) => (if sgr { button(b) } else { 3 }, true),
        MouseKind::Drag(b) => (button(b) + 32, false),
        MouseKind::Moved => (35, false),
        MouseKind::ScrollUp => (64, false),
        MouseKind::ScrollDown => (65, false),
        MouseKind::ScrollLeft => (66, false),
        MouseKind::ScrollRight => (67, false),
    };
    let mut code = code;
    if modifiers & 0b001 != 0 {
        code += 4;
    }
    if modifiers & 0b100 != 0 {
        code += 8;
    }
    if modifiers & 0b010 != 0 {
        code += 16;
    }
    let (x, y) = (column + 1, row + 1);
    if sgr {
        return Some(format!("\x1b[<{code};{x};{y}{}", if release { 'm' } else { 'M' }).into_bytes());
    }
    let byte = |v: u16| u8::try_from(v + 32).ok();
    Some(vec![0x1b, b'[', b'M', byte(code)?, byte(x)?, byte(y)?])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(msg: &ClientMessage) -> Vec<u8> {
        let payload = bincode::serde::encode_to_vec(msg, config()).unwrap();
        let mut out = (payload.len() as u32).to_le_bytes().to_vec();
        out.extend(payload);
        out
    }

    #[test]
    fn variant_indices_are_herdrs() {
        // The first byte of a payload is the variant's index (a varint under 251).
        let tag = |msg: &ClientMessage| frame(msg)[4];
        assert_eq!(tag(&ClientMessage::Detach), 4);
        assert_eq!(tag(&ClientMessage::AttachTerminal { terminal_id: "term_1".into(), takeover: false }), 5);
        assert_eq!(tag(&ClientMessage::ControlTerminal { target: "x".into(), takeover: true }), 8);
        let mouse = ClientMessage::AttachMouse {
            kind: MouseKind::ScrollUp,
            position: MousePosition::Cell { column: 0, row: 0 },
            geometry: None,
            modifiers: 0,
            lines: 1,
        };
        assert_eq!(tag(&mouse), 16);
        assert_eq!(tag(&ClientMessage::EndpointControl { kind: "k".into(), data: "d".into() }), 20);
        let server = |msg: &ServerMessage| encode(msg)[4];
        assert_eq!(server(&ServerMessage::Welcome { version: 22, encoding: RenderEncoding::TerminalAnsi, error: None }), 0);
        assert_eq!(server(&ServerMessage::ServerShutdown { reason: None }), 3);
    }

    #[test]
    fn welcome_is_the_bytes_herdr_reads() {
        // Welcome { version: 22, encoding: TerminalAnsi, error: None }: tag 0, varint 22,
        // tag 1, None.
        assert_eq!(
            encode(&ServerMessage::Welcome { version: 22, encoding: RenderEncoding::TerminalAnsi, error: None }),
            vec![4, 0, 0, 0, 0, 22, 1, 0]
        );
        // Terminal { seq: 1, width: 80, height: 24, full: true, bytes: "hi" }.
        let mut seq = 0;
        assert_eq!(terminal(&mut seq, 80, 24, true, b"hi"), vec![8, 0, 0, 0, 1, 1, 80, 24, 1, 2, b'h', b'i']);
    }

    #[test]
    fn frames_split_across_reads_and_skip_what_is_not_attach() {
        let hello = ClientMessage::TerminalHello {
            version: 22,
            cols: 300,
            rows: 50,
            cell_width_px: 0,
            cell_height_px: 0,
            pixel_mouse: false,
        };
        let mut wire = frame(&hello);
        wire.extend(frame(&ClientMessage::GraphicsTransmissionStarted));
        wire.extend(frame(&ClientMessage::Input { data: b"ls\r".to_vec() }));
        let mut buf = wire[..7].to_vec();
        assert_eq!(drain(&mut buf).unwrap(), vec![]);
        buf.extend_from_slice(&wire[7..]);
        let got = drain(&mut buf).unwrap();
        assert_eq!(
            got,
            vec![
                Decoded::Message(hello),
                Decoded::Skipped(10),
                Decoded::Message(ClientMessage::Input { data: b"ls\r".to_vec() })
            ]
        );
        assert!(buf.is_empty());
    }

    #[test]
    fn page_keys_and_wheels_decode() {
        let page = ClientMessage::AttachScroll {
            source: ScrollSource::PageKey { input: b"\x1b[5~".to_vec() },
            direction: ScrollDirection::Up,
            lines: 23,
            column: None,
            row: None,
            modifiers: 0,
        };
        let mut buf = frame(&page);
        assert_eq!(drain(&mut buf).unwrap(), vec![Decoded::Message(page)]);
    }

    #[test]
    fn oversized_frames_are_refused() {
        let mut buf = ((MAX_FRAME + 1) as u32).to_le_bytes().to_vec();
        assert!(drain(&mut buf).is_err());
    }

    #[test]
    fn mouse_reports() {
        assert_eq!(mouse_report(MouseKind::ScrollUp, 4, 2, 0, true).unwrap(), b"\x1b[<64;5;3M");
        assert_eq!(mouse_report(MouseKind::Up(MouseButton::Left), 0, 0, 0, true).unwrap(), b"\x1b[<0;1;1m");
        assert_eq!(mouse_report(MouseKind::Down(MouseButton::Right), 0, 0, 0b010, true).unwrap(), b"\x1b[<18;1;1M");
        assert_eq!(mouse_report(MouseKind::Down(MouseButton::Left), 0, 0, 0, false).unwrap(), b"\x1b[M !!");
        assert_eq!(mouse_report(MouseKind::Moved, 300, 0, 0, false), None);
    }
}
