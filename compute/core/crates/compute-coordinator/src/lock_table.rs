use crate::time_budget::CoordinatorInstant;
use crate::types::{Lock, LockConflict, LockId, LockScope, LockViolation, ParticipantId};
use cell_types::SheetId;
use std::time::Duration;
use uuid::Uuid;

/// Manages sheet-level and workbook-level locks for collaborative editing.
#[derive(Debug)]
pub(crate) struct LockTable {
    locks: Vec<Lock>,
}

impl LockTable {
    pub(crate) fn new() -> Self {
        Self { locks: Vec::new() }
    }

    /// Acquire a lock. Fails if a conflicting lock exists.
    ///
    /// Idempotent: if the owner already holds an identical lock (same scope),
    /// the TTL is refreshed and the existing lock ID is returned. This makes
    /// the operation safe to retry and doubles as lock renewal.
    ///
    /// Conflict rules:
    /// - Workbook lock conflicts with ALL other locks (any owner)
    /// - Sheet lock conflicts with workbook locks or same-sheet locks from other owners
    /// - Same owner CAN hold multiple non-workbook locks on different sheets
    pub(crate) fn acquire(
        &mut self,
        owner: &ParticipantId,
        scope: LockScope,
        ttl: Duration,
    ) -> Result<LockId, LockConflict> {
        // Idempotent: if owner already holds this exact scope, refresh TTL
        if let Some(existing) = self
            .locks
            .iter_mut()
            .find(|l| l.owner == *owner && l.scope == scope)
        {
            let now = CoordinatorInstant::now();
            existing.expires_at = now + ttl;
            return Ok(existing.id);
        }

        // Check for conflicts with other owners
        if let Some(conflict) = self.find_conflict(owner, &scope) {
            return Err(LockConflict {
                existing_lock: conflict.clone(),
            });
        }

        let now = CoordinatorInstant::now();
        let lock = Lock {
            id: Uuid::new_v4(),
            owner: owner.clone(),
            scope,
            acquired_at: now,
            expires_at: now + ttl,
        };
        let id = lock.id;
        self.locks.push(lock);
        Ok(id)
    }

    /// Release a specific lock. Only the owner can release.
    pub(crate) fn release(
        &mut self,
        owner: &ParticipantId,
        lock_id: &LockId,
    ) -> Result<(), LockReleaseError> {
        let pos = self.locks.iter().position(|l| &l.id == lock_id);
        match pos {
            None => Err(LockReleaseError::NotFound),
            Some(i) => {
                if &self.locks[i].owner != owner {
                    Err(LockReleaseError::NotOwner)
                } else {
                    self.locks.swap_remove(i);
                    Ok(())
                }
            }
        }
    }

    /// Release all locks held by a participant.
    /// Returns the number of locks released.
    pub(crate) fn release_all(&mut self, owner: &ParticipantId) -> usize {
        let before = self.locks.len();
        self.locks.retain(|l| l.owner != *owner);
        before - self.locks.len()
    }

    /// Expire locks past their TTL. Returns the IDs of expired locks.
    pub(crate) fn expire(&mut self) -> Vec<LockId> {
        let now = CoordinatorInstant::now();
        let mut expired = Vec::new();
        self.locks.retain(|l| {
            if now >= l.expires_at {
                expired.push(l.id);
                false
            } else {
                true
            }
        });
        expired
    }

    /// Check if a push touching the given sheets violates any locks.
    /// Returns None if no violation, or Some(LockViolation) with details.
    pub(crate) fn check_push(
        &self,
        participant: &ParticipantId,
        touched_sheets: &[SheetId],
    ) -> Option<LockViolation> {
        let mut conflicting = Vec::new();

        for lock in &self.locks {
            // Owner's own locks don't block them
            if lock.owner == *participant {
                continue;
            }

            let conflicts = match &lock.scope {
                // Workbook lock blocks everything from non-owners
                LockScope::Workbook => !touched_sheets.is_empty(),
                // Sheet lock blocks if the pushed sheets include the locked sheet
                LockScope::Sheet { sheet_id } => touched_sheets.contains(sheet_id),
                // Structural locks do NOT block pushes — they only serialize
                // structural operation acquisition, not normal cell writes
                LockScope::Structural { .. } => false,
            };

            if conflicts {
                conflicting.push(lock.clone());
            }
        }

        if conflicting.is_empty() {
            None
        } else {
            Some(LockViolation {
                conflicting_locks: conflicting,
                attempted_sheets: touched_sheets.to_vec(),
            })
        }
    }

    /// Get all active (non-expired) locks.
    pub(crate) fn active_locks(&self) -> &[Lock] {
        &self.locks
    }

    /// Count locks held by a specific participant.
    pub(crate) fn count_for(&self, owner: &ParticipantId) -> usize {
        self.locks.iter().filter(|l| l.owner == *owner).count()
    }

    /// Find a conflicting lock for acquisition.
    fn find_conflict(&self, requester: &ParticipantId, scope: &LockScope) -> Option<&Lock> {
        for lock in &self.locks {
            let conflicts = match (&lock.scope, scope) {
                // Any existing lock conflicts with a workbook lock request
                (_, LockScope::Workbook) => true,
                // An existing workbook lock conflicts with everything
                (LockScope::Workbook, _) => true,
                // Two sheet locks conflict if same sheet and different owner
                (
                    LockScope::Sheet { sheet_id: existing },
                    LockScope::Sheet {
                        sheet_id: requested,
                    },
                ) => existing == requested && lock.owner != *requester,
                // Two structural locks conflict if same sheet and different owner
                (
                    LockScope::Structural { sheet_id: existing },
                    LockScope::Structural {
                        sheet_id: requested,
                    },
                ) => existing == requested && lock.owner != *requester,
                // Structural locks don't conflict with sheet locks or vice versa
                // (structural locks only serialize structural ops, not normal edits)
                _ => false,
            };

            if conflicts {
                return Some(lock);
            }
        }
        None
    }
}

/// Errors from lock release operations.
#[derive(Debug, thiserror::Error)]
pub(crate) enum LockReleaseError {
    #[error("lock not found")]
    NotFound,
    #[error("only the lock owner can release it")]
    NotOwner,
}
