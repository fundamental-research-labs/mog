use crate::time_budget::CoordinatorInstant;
use cell_types::SheetId;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Participant & Lock identifiers
// ---------------------------------------------------------------------------

/// Unique identifier for a participant in a collaborative session.
pub type ParticipantId = String;

/// Unique identifier for a lock.
pub type LockId = Uuid;

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

/// Result of a participant joining the coordinator.
#[derive(Debug, Clone)]
pub struct JoinResult {
    /// Full Yrs v1-encoded document state for hydrating the participant's engine.
    pub full_state: Vec<u8>,
    /// Currently active locks (so participant knows what's locked).
    pub active_locks: Vec<Lock>,
    /// Number of participants currently connected.
    pub participant_count: usize,
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/// Result of a successful push operation.
#[derive(Debug, Clone)]
pub struct PushResult {
    /// Diff containing changes from other participants the pusher hasn't seen.
    pub server_diff: Vec<u8>,
}

/// Errors that can occur during a push operation.
#[derive(Debug, thiserror::Error)]
pub enum PushError {
    /// Update modifies sheets locked by another participant.
    #[error("lock violation: update touches sheets locked by another participant")]
    LockViolation(LockViolation),

    /// Wire protocol or sync error.
    #[error(transparent)]
    SyncError(#[from] compute_collab::SyncError),

    /// Participant hasn't joined.
    #[error("unknown participant")]
    UnknownParticipant,
}

/// Details about a lock violation during push.
#[derive(Debug, Clone)]
pub struct LockViolation {
    /// The locks that conflict with the attempted operation.
    pub conflicting_locks: Vec<Lock>,
    /// Which sheets the update tried to modify.
    pub attempted_sheets: Vec<SheetId>,
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

/// Errors that can occur during lock operations.
#[derive(Debug, thiserror::Error)]
pub enum LockError {
    /// Participant hasn't joined.
    #[error("unknown participant")]
    UnknownParticipant,

    /// Lock not found.
    #[error("lock not found")]
    LockNotFound,

    /// Only the lock owner can release it.
    #[error("not the lock owner")]
    NotOwner,

    /// A conflicting lock already exists.
    #[error("lock conflict: {0:?}")]
    LockConflict(LockConflict),
}

/// Conflict when trying to acquire a lock.
#[derive(Debug, Clone)]
pub struct LockConflict {
    /// The existing lock that blocks acquisition.
    pub existing_lock: Lock,
}

/// An active lock on a document resource.
#[derive(Debug, Clone)]
pub struct Lock {
    /// Unique lock identifier.
    pub id: LockId,
    /// Who owns this lock.
    pub owner: ParticipantId,
    /// What is locked.
    pub scope: LockScope,
    /// When the lock was acquired.
    pub acquired_at: CoordinatorInstant,
    /// When the lock expires.
    pub expires_at: CoordinatorInstant,
}

/// What resource a lock covers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockScope {
    /// Lock an entire sheet.
    Sheet { sheet_id: SheetId },
    /// Lock the entire workbook (for bulk operations like import).
    Workbook,
    /// Lock structural operations (insert/delete rows/cols) on a sheet.
    /// Only one participant can hold a structural lock per sheet at a time.
    /// Unlike Sheet locks, structural locks do NOT block normal cell edits —
    /// they only serialize structural operations against each other.
    Structural { sheet_id: SheetId },
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/// General sync errors.
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// Participant hasn't joined.
    #[error("unknown participant")]
    UnknownParticipant,

    /// Underlying sync protocol error.
    #[error(transparent)]
    Protocol(#[from] compute_collab::SyncError),
}
