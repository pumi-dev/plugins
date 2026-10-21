//! A snapshot is a pane's output replayed for a fresh terminal, so the queries in it (device
//! attributes, cursor reports, mode and colour queries) were asked long ago. The app's own
//! terminal drops what it would answer while it reads a snapshot; a terminal at the far end of
//! herdr's client cannot tell, and its answers would reach the program as typed input. So
//! they leave the snapshot here. Live output is passed on as it is: its queries are live.

/// `bytes` without the queries in it. A sequence cut off at the end is kept as it is.
pub fn strip(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != 0x1b || i + 1 >= bytes.len() {
            out.push(bytes[i]);
            i += 1;
            continue;
        }
        let (end, query) = match bytes[i + 1] {
            b'[' => csi(bytes, i + 2),
            b']' => string(bytes, i + 2, true),
            b'P' => string(bytes, i + 2, false),
            _ => (i + 1, false),
        };
        if !query {
            out.extend_from_slice(&bytes[i..end.max(i + 1)]);
        }
        i = end.max(i + 1);
    }
    out
}

/// A CSI from its first parameter byte at `at`: where it ends, and whether it asks something.
fn csi(bytes: &[u8], at: usize) -> (usize, bool) {
    let mut i = at;
    while i < bytes.len() && (0x30..=0x3f).contains(&bytes[i]) {
        i += 1;
    }
    let params = &bytes[at..i];
    let inter_at = i;
    while i < bytes.len() && (0x20..=0x2f).contains(&bytes[i]) {
        i += 1;
    }
    let inter = &bytes[inter_at..i];
    let Some(&fin) = bytes.get(i) else { return (bytes.len(), false) };
    if !(0x40..=0x7e).contains(&fin) {
        // Not a CSI after all; the bytes are passed on.
        return (i, false);
    }
    let query = match (fin, inter) {
        // Device attributes, primary, secondary and tertiary.
        (b'c', b"") => params.iter().all(|b| matches!(b, b'0' | b'>' | b'=')),
        // Status and cursor reports, and the colour scheme's (`?996n`).
        (b'n', b"") => matches!(params, b"5" | b"6" | b"?6" | b"?15" | b"?25" | b"?26" | b"?996"),
        // A mode's state (DECRQM).
        (b'p', b"$") => true,
        // The kitty keyboard flags.
        (b'u', b"") => params == b"?",
        // The terminal's name and version (XTVERSION).
        (b'q', b"") => params.first() == Some(&b'>'),
        // Window and cell sizes, and the title (reports only).
        (b't', b"") => matches!(params, b"11" | b"13" | b"14" | b"15" | b"16" | b"18" | b"19" | b"20" | b"21"),
        _ => false,
    };
    (i + 1, query)
}

/// An OSC (`osc`) or DCS from its first byte at `at`, up to BEL (OSC only) or ST.
fn string(bytes: &[u8], at: usize, osc: bool) -> (usize, bool) {
    let mut i = at;
    let body_end;
    loop {
        match bytes.get(i) {
            None => return (bytes.len(), false),
            Some(0x07) if osc => {
                body_end = i;
                i += 1;
                break;
            }
            Some(0x1b) if bytes.get(i + 1) == Some(&b'\\') => {
                body_end = i;
                i += 2;
                break;
            }
            Some(_) => i += 1,
        }
    }
    let body = &bytes[at..body_end];
    let query = if osc {
        // A colour asked for: `4;N;?`, `10;?` … `19;?`, a clipboard read (`52;c;?`).
        body.ends_with(b";?")
    } else {
        // Termcap (XTGETTCAP) and settings (DECRQSS).
        body.starts_with(b"+q") || body.starts_with(b"$q")
    };
    (i, query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_go_and_the_rest_stays() {
        let snapshot = b"\x1b[?1049h\x1b[c\x1b[>0c\x1b[6nhi\x1b[?2004$p\x1b[?u\x1b[>q\x1b[14t\x1b]11;?\x07\x1b]4;1;?\x1b\\\x1bP+q544e\x1b\\\x1b[31mred\x1b[0m\x1b]2;title\x07\x1b[8;24;80t";
        assert_eq!(strip(snapshot), b"\x1b[?1049hhi\x1b[31mred\x1b[0m\x1b]2;title\x07\x1b[8;24;80t".to_vec());
    }

    #[test]
    fn what_is_cut_off_is_kept() {
        assert_eq!(strip(b"ok\x1b[3"), b"ok\x1b[3".to_vec());
        assert_eq!(strip(b"ok\x1b]11;?"), b"ok\x1b]11;?".to_vec());
        assert_eq!(strip(b"ok\x1b"), b"ok\x1b".to_vec());
    }

    #[test]
    fn utf8_and_plain_escapes_pass() {
        let text = "π — ok\x1b7\x1b8\x1b=".as_bytes();
        assert_eq!(strip(text), text.to_vec());
    }
}
