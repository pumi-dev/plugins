//! herdr's public ids: `w<N>` workspaces, `<ws>:t<N>` tabs, `<ws>:p<N>` panes, with `N`
//! in herdr's 32-symbol alphabet (bijective base 32, no `I`, `L`, `O`, `U`).
//!
//! PROVENANCE: herdr `src/workspace.rs` (`encode_public_number`, `decode_public_number`,
//! `public_*_id_for_number`) @ v0.9.3 (Apache-2.0).

const ALPHABET: &[u8; 32] = b"123456789ABCDEFGHJKMNPQRSTVWXYZ0";

pub fn encode(mut value: usize) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut encoded = Vec::new();
    while value > 0 {
        let digit = (value - 1) % ALPHABET.len();
        encoded.push(ALPHABET[digit] as char);
        value = (value - 1) / ALPHABET.len();
    }
    encoded.iter().rev().collect()
}

pub fn decode(value: &str) -> Option<usize> {
    if value.is_empty() {
        return None;
    }
    let mut decoded = 0usize;
    for ch in value.chars() {
        let digit = ALPHABET
            .iter()
            .position(|candidate| *candidate as char == ch)?;
        decoded = decoded
            .checked_mul(ALPHABET.len())?
            .checked_add(digit + 1)?;
    }
    Some(decoded)
}

pub fn workspace(number: usize) -> String {
    format!("w{}", encode(number))
}

pub fn tab(workspace_id: &str, number: usize) -> String {
    format!("{workspace_id}:t{}", encode(number))
}

pub fn pane(workspace_id: &str, number: usize) -> String {
    format!("{workspace_id}:p{}", encode(number))
}

pub fn terminal(number: u64) -> String {
    format!("term_{number}")
}

pub fn workspace_number(id: &str) -> Option<usize> {
    id.strip_prefix('w').and_then(decode)
}

/// `(workspace_id, number)` of a tab id.
pub fn split_tab(id: &str) -> Option<(&str, usize)> {
    let (ws, rest) = id.rsplit_once(":t")?;
    Some((ws, decode(rest)?))
}

/// `(workspace_id, number)` of a pane id.
pub fn split_pane(id: &str) -> Option<(&str, usize)> {
    let (ws, rest) = id.rsplit_once(":p")?;
    Some((ws, decode(rest)?))
}
