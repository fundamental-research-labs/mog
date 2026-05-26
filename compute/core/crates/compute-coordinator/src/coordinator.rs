use crate::awareness::{AwarenessError, AwarenessState};
use crate::lock_table::LockTable;
use crate::participant::ParticipantState;
use crate::types::*;
use cell_types::SheetId;
use std::collections::HashMap;
use std::time::Duration;
use yrs::Doc;

/// Coordinator for multi-participant collaborative document editing.
///
/// Owns the authoritative Yrs document, manages participant lifecycle,
/// and enforces sheet-level locks. Pure Rust — no async, no network.
/// Transports (HTTP, WebSocket, in-process) wrap this struct.
#[derive(Debug)]
pub struct SyncCoordinator {
    doc: Doc,
    lock_table: LockTable,
    participants: HashMap<ParticipantId, ParticipantState>,
    awareness: AwarenessState,
}

impl SyncCoordinator {
    /// Create a new coordinator for a blank collaborative workbook.
    ///
    /// The coordinator owns the canonical blank schema so every participant
    /// hydrates from the same Yrs child-map identities before concurrent writes
    /// begin. This avoids LWW races on lazily-created workbook/sheet sub-maps
    /// such as `namedRanges`, `tables`, and validation arrays.
    pub fn new() -> Self {
        let doc = Doc::new();
        compute_document::schema::init_canonical_schema(&doc);
        Self::from_doc(doc)
    }

    /// Create a coordinator with no workbook schema.
    ///
    /// Use this only when an existing/imported document will seed the room
    /// before other participants join. Blank collaborative rooms should use
    /// [`Self::new`] so all peers share canonical child-map identities.
    pub fn empty() -> Self {
        Self::from_doc(Doc::new())
    }

    fn from_doc(doc: Doc) -> Self {
        Self {
            doc,
            lock_table: LockTable::new(),
            participants: HashMap::new(),
            awareness: AwarenessState::new(),
        }
    }

    /// Create a coordinator from existing Yrs state (e.g., loaded from persistence).
    pub fn from_state(state: &[u8]) -> Result<Self, SyncError> {
        let doc = Doc::new();
        compute_collab::apply_update(&doc, state)?;
        Ok(Self::from_doc(doc))
    }

    // ----- Participant lifecycle -----

    /// Register a participant. Returns the full document state for hydration.
    ///
    /// If the participant was already joined, their existing locks are released
    /// and their state is reset (equivalent to leave + join).
    pub fn join(&mut self, id: ParticipantId) -> JoinResult {
        // Clean up any existing state from a prior session (e.g., stale reconnect)
        if self.participants.contains_key(&id) {
            self.lock_table.release_all(&id);
        }
        self.participants
            .insert(id.clone(), ParticipantState::new(id));
        JoinResult {
            full_state: compute_collab::encode_full_state(&self.doc),
            active_locks: self.lock_table.active_locks().to_vec(),
            participant_count: self.participants.len(),
        }
    }

    /// Remove a participant. Releases all their locks and awareness state.
    /// Returns the awareness update bytes to broadcast to remaining peers.
    pub fn leave(&mut self, id: &ParticipantId) -> Vec<u8> {
        self.lock_table.release_all(id);
        self.participants.remove(id);
        self.awareness.remove_state(id)
    }

    /// Number of currently connected participants.
    pub fn participant_count(&self) -> usize {
        self.participants.len()
    }

    // ----- Sync -----

    /// Push a participant's update to the authoritative doc.
    ///
    /// `touched_sheets` is declared by the caller (CollaborativeEngine tracks
    /// which sheets were modified via API calls). The coordinator validates
    /// these against the lock table — no Yrs binary inspection needed.
    ///
    /// `participant_sv` is the participant's state vector from *before* this
    /// update was generated. After applying the update, the coordinator uses
    /// it to compute the diff of changes from other participants that the
    /// pusher hasn't seen yet.
    ///
    /// Returns the server's diff (changes from others the pusher hasn't seen),
    /// or a `PushError` if the update violates locks or the participant is unknown.
    pub fn push(
        &mut self,
        participant: &ParticipantId,
        update: &[u8],
        touched_sheets: &[SheetId],
        participant_sv: &[u8],
    ) -> Result<PushResult, PushError> {
        // 1. Verify participant exists
        if !self.participants.contains_key(participant) {
            return Err(PushError::UnknownParticipant);
        }

        // 2. Check locks — reject if touching sheets locked by others
        if let Some(violation) = self.lock_table.check_push(participant, touched_sheets) {
            return Err(PushError::LockViolation(violation));
        }

        // 3. Apply the update to the authoritative doc
        compute_collab::apply_update(&self.doc, update)?;

        // 4. Compute diff: everything on the server that the pusher didn't
        //    have before this push. The participant_sv is from before the push,
        //    and the server doc now includes the pusher's update, so the diff
        //    contains exactly the changes from OTHER participants. (The pusher's
        //    own changes are already in participant_sv, so they won't appear.)
        let server_diff =
            compute_collab::encode_diff(&self.doc, participant_sv).map_err(PushError::SyncError)?;

        // 5. Update participant state
        if let Some(p) = self.participants.get_mut(participant) {
            p.touch();
        }

        Ok(PushResult { server_diff })
    }

    /// Pull changes the participant hasn't seen yet.
    ///
    /// `participant_sv` is the participant's current state vector (encoded).
    /// Returns the diff: all changes on the server that the participant is missing.
    pub fn pull(
        &self,
        participant: &ParticipantId,
        participant_sv: &[u8],
    ) -> Result<Vec<u8>, SyncError> {
        if !self.participants.contains_key(participant) {
            return Err(SyncError::UnknownParticipant);
        }

        let diff = compute_collab::encode_diff(&self.doc, participant_sv)?;

        Ok(diff)
    }

    /// Encode the coordinator's current state vector.
    pub fn state_vector(&self) -> Vec<u8> {
        compute_collab::encode_state_vector(&self.doc)
    }

    /// Encode the full document state (for persistence or late joiners).
    pub fn full_state(&self) -> Vec<u8> {
        compute_collab::encode_full_state(&self.doc)
    }

    // ----- Locks -----

    /// Acquire a lock. Fails if a conflicting lock exists.
    pub fn acquire_lock(
        &mut self,
        owner: &ParticipantId,
        scope: LockScope,
        ttl: Duration,
    ) -> Result<LockId, LockError> {
        if !self.participants.contains_key(owner) {
            return Err(LockError::UnknownParticipant);
        }

        let id = self
            .lock_table
            .acquire(owner, scope, ttl)
            .map_err(LockError::LockConflict)?;

        if let Some(p) = self.participants.get_mut(owner) {
            p.lock_count = self.lock_table.count_for(owner);
        }

        Ok(id)
    }

    /// Release a specific lock. Only the owner can release.
    pub fn release_lock(
        &mut self,
        owner: &ParticipantId,
        lock_id: &LockId,
    ) -> Result<(), LockError> {
        if !self.participants.contains_key(owner) {
            return Err(LockError::UnknownParticipant);
        }

        self.lock_table
            .release(owner, lock_id)
            .map_err(|e| match e {
                crate::lock_table::LockReleaseError::NotFound => LockError::LockNotFound,
                crate::lock_table::LockReleaseError::NotOwner => LockError::NotOwner,
            })?;

        if let Some(p) = self.participants.get_mut(owner) {
            p.lock_count = self.lock_table.count_for(owner);
        }

        Ok(())
    }

    /// Release all locks held by a participant.
    pub fn release_all_locks(&mut self, owner: &ParticipantId) {
        self.lock_table.release_all(owner);
        if let Some(p) = self.participants.get_mut(owner) {
            p.lock_count = 0;
        }
    }

    /// Expire locks past their TTL. Call periodically.
    pub fn expire_locks(&mut self) -> Vec<LockId> {
        let expired = self.lock_table.expire();
        // Update lock counts for affected participants
        for (id, p) in &mut self.participants {
            p.lock_count = self.lock_table.count_for(id);
        }
        expired
    }

    /// List active locks.
    pub fn active_locks(&self) -> &[Lock] {
        self.lock_table.active_locks()
    }

    // ----- Structural locks (convenience) -----

    /// Acquire a structural lock on a sheet. Only one participant can hold a
    /// structural lock per sheet at a time. Structural locks serialize insert/
    /// delete row/col operations to prevent divergent posToId/idToPos maps.
    /// They do NOT block normal cell edits on the same sheet.
    pub fn acquire_structural_lock(
        &mut self,
        owner: &ParticipantId,
        sheet_id: SheetId,
        ttl: Duration,
    ) -> Result<LockId, LockError> {
        self.acquire_lock(owner, LockScope::Structural { sheet_id }, ttl)
    }

    /// Release a structural lock. Convenience wrapper around release_lock.
    pub fn release_structural_lock(
        &mut self,
        owner: &ParticipantId,
        lock_id: &LockId,
    ) -> Result<(), LockError> {
        self.release_lock(owner, lock_id)
    }

    // ----- Awareness -----

    /// Set awareness state for a participant. Returns encoded update to broadcast.
    pub fn awareness_set_state(&mut self, participant_id: &str, state_json: &str) -> Vec<u8> {
        self.awareness.set_state(participant_id, state_json)
    }

    /// Remove awareness state for a participant. Returns encoded update to broadcast.
    pub fn awareness_remove_state(&mut self, participant_id: &str) -> Vec<u8> {
        self.awareness.remove_state(participant_id)
    }

    /// Get all awareness states as JSON string.
    pub fn awareness_get_states(&self) -> String {
        self.awareness.get_states_json()
    }

    /// Apply an encoded awareness update. Returns bytes to broadcast.
    pub fn awareness_apply_update(&mut self, update: &[u8]) -> Result<Vec<u8>, AwarenessError> {
        self.awareness.apply_update(update)
    }

    /// Encode full awareness state for a joining peer.
    pub fn awareness_full_state(&self) -> Vec<u8> {
        self.awareness.encode_full_state()
    }
}

impl Default for SyncCoordinator {
    fn default() -> Self {
        Self::new()
    }
}
