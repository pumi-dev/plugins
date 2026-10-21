//! pumi's grid socket (`grid.sock` in the server's data directory), where a client attaches to
//! one terminal pane: a snapshot (the output tail and the modes), then every byte the program
//! writes, with the client's input sent back in-band. It is what the app's own panes draw from.
//!
//! Frames are a `u32` little-endian length and a postcard payload. A component cannot link
//! `pumi-proto` (its pins are the server's), so the shapes are copied here; postcard encodes
//! an enum as its variant's index, so the order is pumi's.
//!
//! PROVENANCE: pumi `crates/pumi-proto/src/native.rs` and `frame.rs`, protocol 2.

use serde::{Deserialize, Serialize};

/// The native protocol's major version.
pub const PROTOCOL: u32 = 2;

/// The largest frame pumi sends (a snapshot of a long scrollback is a few MiB).
const MAX_FRAME: usize = 64 << 20;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hello {
    pub protocol: u32,
    pub client: String,
    pub client_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Welcome {
    Ok { protocol: u32, server_version: String, boot_id: String, pid: u32 },
    Refused { protocol: u32, server_version: String, reason: String },
}

/// The control messages; only [`ClientMsg::Attach`] is sent here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientMsg {
    Request { id: u64, method: String, params: String },
    Subscribe { id: u64, subscriptions: String },
    Attach(Attach),
    Ping { id: u64 },
    Watch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    /// Input, resize and query replies come from this client; its size wins.
    Control,
    /// Output only, at the controller's size.
    Observe,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
    pub cell_width: u32,
    pub cell_height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attach {
    /// `%N`.
    pub pane: String,
    pub mode: Mode,
    pub size: Size,
    pub budget: Option<u64>,
    pub resume: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttachClient {
    Input(Vec<u8>),
    Paste(String),
    Resize(Size),
    Claim,
    Release,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttachServer {
    /// The tail and the modes, for a fresh terminal; `seq` is the output it is current to.
    Snapshot { cols: u16, rows: u16, bytes: Vec<u8>, seq: u64, mode: Mode },
    /// Raw output, in order.
    Output { seq: u64, bytes: Vec<u8> },
    Resized { cols: u16, rows: u16 },
    ControlLost,
    ControlGained,
    Exited { status: Option<i32> },
    Error(String),
}

/// A message as a frame.
pub fn encode<T: Serialize>(msg: &T) -> Vec<u8> {
    let payload = postcard::to_stdvec(msg).expect("plain data encodes");
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(&payload);
    frame
}

/// The complete frames at the front of `buf`, as payloads; a partial frame stays.
pub fn frames(buf: &mut Vec<u8>) -> Result<Vec<Vec<u8>>, String> {
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
        out.push(buf[at + 4..at + 4 + len].to_vec());
        at += 4 + len;
    }
    buf.drain(..at);
    Ok(out)
}

pub fn decode<T: for<'de> Deserialize<'de>>(payload: &[u8]) -> Result<T, String> {
    postcard::from_bytes(payload).map_err(|e| e.to_string())
}

#[cfg(test)]
fn drain<T: for<'de> Deserialize<'de>>(buf: &mut Vec<u8>) -> Result<Vec<T>, String> {
    frames(buf)?.iter().map(|p| decode(p)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attach_is_variant_two_and_round_trips() {
        let attach = ClientMsg::Attach(Attach {
            pane: "%7".into(),
            mode: Mode::Control,
            size: Size { cols: 80, rows: 24, cell_width: 0, cell_height: 0 },
            budget: None,
            resume: None,
        });
        let frame = encode(&attach);
        assert_eq!(frame[4], 2);
        let mut buf = frame.clone();
        assert_eq!(drain::<ClientMsg>(&mut buf).unwrap(), vec![attach]);
    }

    #[test]
    fn server_messages_split_across_reads() {
        let msgs = vec![
            AttachServer::Snapshot { cols: 80, rows: 24, bytes: b"\x1b[?1h".to_vec(), seq: 9, mode: Mode::Control },
            AttachServer::Output { seq: 10, bytes: b"x".to_vec() },
            AttachServer::Exited { status: Some(1) },
        ];
        let wire: Vec<u8> = msgs.iter().flat_map(encode).collect();
        let mut buf = wire[..5].to_vec();
        assert!(drain::<AttachServer>(&mut buf).unwrap().is_empty());
        buf.extend_from_slice(&wire[5..]);
        assert_eq!(drain::<AttachServer>(&mut buf).unwrap(), msgs);
    }
}
