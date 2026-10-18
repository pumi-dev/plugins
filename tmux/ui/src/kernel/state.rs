//! Time, as pumi-mirror's `state` says it (the rest of that module, a pane's saved state, is
//! not tmux's).

/// Seconds since the epoch.
pub fn epoch() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
