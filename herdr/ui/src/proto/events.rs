//! herdr's events, as a table: the dotted name a subscription asks for, the snake name an
//! envelope carries (`{"event": "pane_created", "data": {"type": "pane_created", …}}`), and
//! how a subscription to it behaves.
//!
//! PROVENANCE: herdr `src/api/schema/events.rs` (`EventKind`, `Subscription`,
//! `SubscriptionEventKind`) @ v0.9.3 (Apache-2.0).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    /// Every occurrence goes to every subscriber of the name.
    Lifecycle,
    /// A per-pane subscription with its own parameters (`pane_id`, …) and its own envelope
    /// (`{"event": "pane.agent_status_changed", "data": …}`, dotted, untagged data).
    PerPane,
    /// Only `events.wait` matches it; no subscription names it.
    WaitOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Event {
    pub dotted: &'static str,
    pub snake: &'static str,
    pub delivery: Delivery,
}

const fn lifecycle(dotted: &'static str, snake: &'static str) -> Event {
    Event {
        dotted,
        snake,
        delivery: Delivery::Lifecycle,
    }
}

pub const EVENTS: &[Event] = &[
    lifecycle("workspace.created", "workspace_created"),
    lifecycle("workspace.updated", "workspace_updated"),
    lifecycle("workspace.metadata_updated", "workspace_metadata_updated"),
    lifecycle("workspace.renamed", "workspace_renamed"),
    lifecycle("workspace.moved", "workspace_moved"),
    lifecycle("workspace.reordered", "workspace_reordered"),
    lifecycle("workspace.closed", "workspace_closed"),
    lifecycle("workspace.focused", "workspace_focused"),
    lifecycle("worktree.created", "worktree_created"),
    lifecycle("worktree.opened", "worktree_opened"),
    lifecycle("worktree.removed", "worktree_removed"),
    lifecycle("tab.created", "tab_created"),
    lifecycle("tab.closed", "tab_closed"),
    lifecycle("tab.focused", "tab_focused"),
    lifecycle("tab.renamed", "tab_renamed"),
    lifecycle("tab.moved", "tab_moved"),
    lifecycle("pane.created", "pane_created"),
    lifecycle("pane.closed", "pane_closed"),
    lifecycle("pane.updated", "pane_updated"),
    lifecycle("pane.focused", "pane_focused"),
    lifecycle("pane.moved", "pane_moved"),
    lifecycle("pane.exited", "pane_exited"),
    lifecycle("pane.agent_detected", "pane_agent_detected"),
    lifecycle("layout.updated", "layout_updated"),
    Event {
        dotted: "pane.output_changed",
        snake: "pane_output_changed",
        delivery: Delivery::WaitOnly,
    },
    Event {
        dotted: "pane.agent_status_changed",
        snake: "pane_agent_status_changed",
        delivery: Delivery::PerPane,
    },
    Event {
        dotted: "pane.output_matched",
        snake: "pane_output_matched",
        delivery: Delivery::PerPane,
    },
    Event {
        dotted: "pane.scroll_changed",
        snake: "pane_scroll_changed",
        delivery: Delivery::PerPane,
    },
];

pub fn by_dotted(name: &str) -> Option<&'static Event> {
    EVENTS.iter().find(|event| event.dotted == name)
}

pub fn by_snake(name: &str) -> Option<&'static Event> {
    EVENTS.iter().find(|event| event.snake == name)
}

/// The dotted or snake name, either way round.
pub fn find(name: &str) -> Option<&'static Event> {
    by_dotted(name).or_else(|| by_snake(name))
}
