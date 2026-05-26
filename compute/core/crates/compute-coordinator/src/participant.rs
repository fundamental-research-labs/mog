use crate::time_budget::CoordinatorInstant;
use crate::types::ParticipantId;

/// Tracks the state of a connected participant.
#[derive(Debug, Clone)]
pub(crate) struct ParticipantState {
    /// The participant's unique identifier.
    pub(crate) id: ParticipantId,
    /// When this participant joined.
    pub(crate) joined_at: CoordinatorInstant,
    /// When this participant last synced (push or pull).
    pub(crate) last_sync_at: CoordinatorInstant,
    /// Number of locks currently held by this participant.
    pub(crate) lock_count: usize,
}

impl ParticipantState {
    pub(crate) fn new(id: ParticipantId) -> Self {
        let now = CoordinatorInstant::now();
        Self {
            id,
            joined_at: now,
            last_sync_at: now,
            lock_count: 0,
        }
    }

    /// Update the last sync timestamp to now.
    pub(crate) fn touch(&mut self) {
        self.last_sync_at = CoordinatorInstant::now();
    }
}
