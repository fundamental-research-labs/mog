use bridge_core as bridge;
use compute_collab as sync;

use super::YrsComputeEngine;
use super::sync_authored_cells;
use crate::snapshot::MutationResult;
use crate::snapshot::{ObjectDigest, SyncApplyMutationMetadataWire, SyncApplyOperationContextWire};
use cell_types::SheetId;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "core_sync",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Sync protocol
    // -------------------------------------------------------------------

    #[bridge::write(scope = "workbook")]
    pub fn apply_sync_update(
        &mut self,
        update: &[u8],
        sync_context: SyncApplyOperationContextWire,
    ) -> Result<(Vec<u8>, SyncApplyMutationMetadataWire), ComputeError> {
        // Capture pre-state from Yrs (still old) and in-memory indexes for
        // diffing after rebuild. This lets us detect deletions/removals.
        let pre_sheet_order: Vec<SheetId> = self.stores.storage.sheet_order();
        let pre_authored_cells =
            sync_authored_cells::snapshot_authored_cells(&self.mirror, &self.stores.compute);

        self.active_sync_context = Some(sync_context);

        let result = (|| -> Result<(Vec<u8>, MutationResult), ComputeError> {
            sync::apply_update(self.stores.storage.doc(), update).map_err(|e| {
                ComputeError::Eval {
                    message: format!("sync update failed: {}", e),
                }
            })?;

            // Drain observer events so they don't leak into subsequent operations,
            // but don't rely on them — Yrs `observe_deep` is unreliable for
            // remote sync updates (it may silently merge CRDT state without
            // firing callbacks when both peers have the same root-level map keys).
            let _discarded = self.mutation.observer.drain_all_changes();

            // Always rebuild from Yrs after a sync update. This is the only
            // reliable way to ensure the in-memory cell index, grid indexes,
            // compute core, and mirror all reflect the converged CRDT state.
            self.rebuild_from_yrs_after_sync(pre_sheet_order, pre_authored_cells)
        })();

        let applied_context = self.active_sync_context.clone();
        self.active_sync_context = None;

        let (patches, mutation_result) = result?;
        let applied_context = applied_context.ok_or_else(|| ComputeError::Eval {
            message: "sync update context was cleared before reporting".to_string(),
        })?;
        Ok((
            patches,
            SyncApplyMutationMetadataWire::not_evaluated(mutation_result, applied_context),
        ))
    }

    pub fn apply_sync_update_legacy(
        &mut self,
        update: &[u8],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let payload_hash = ObjectDigest::sha256(update).value;
        let sync_context = SyncApplyOperationContextWire::legacy_raw(payload_hash);
        self.apply_sync_update(update, sync_context)
            .map(|(patches, metadata)| (patches, metadata.mutation_result))
    }

    /// Rebuild all in-memory state from Yrs after a sync update.
    ///
    /// Remote sync updates may silently merge CRDT state without triggering
    /// Yrs `observe_deep` callbacks (e.g. when both peers created the same
    /// root-level map key independently). The observer-based pipeline
    /// (`apply_all_observer_changes`) is designed for local mutations where
    /// callbacks always fire. For sync, we bypass the observer entirely and
    /// rebuild from the Yrs document — the single source of truth.
    ///
    /// `pre_sheet_order` is the sheet order captured *before* the Yrs update
    /// was applied, used to detect sheet deletions.
    #[bridge::read(scope = "workbook")]
    pub fn encode_state_vector(&self) -> Vec<u8> {
        sync::encode_state_vector(self.stores.storage.doc())
    }

    /// TS-side alias for `encode_state_vector`.
    ///
    /// ComputeBridge surfaces it as `currentStateVector` for symmetry with
    /// `Provider.stateVector()`. The Rust implementation reuses the existing `encode_state_vector`; the
    /// alias exists at the bridge boundary so the TS Provider interface
    /// (`ProviderDoc.currentStateVector()`) doesn't have to import a
    /// historical `encode_state_vector` name from the wire layer.
    #[bridge::read(scope = "workbook")]
    pub fn current_state_vector(&self) -> Vec<u8> {
        sync::encode_state_vector(self.stores.storage.doc())
    }

    #[bridge::read(scope = "workbook")]
    pub fn encode_diff(&self, remote_sv: &[u8]) -> Result<Vec<u8>, ComputeError> {
        sync::encode_diff(self.stores.storage.doc(), remote_sv).map_err(|e| ComputeError::Eval {
            message: format!("sync encode_diff failed: {}", e),
        })
    }

    /// Drain pending v1-encoded yrs updates accumulated by the
    /// engine-side `subscribe_update_v1` observer.
    ///
    /// One callback is installed at engine construction; every
    /// committed write transaction enqueues its update bytes. The
    /// kernel-side orchestrator (`RustDocument`) polls this method on a
    /// microtask tick and fans out to attached Providers.
    ///
    /// Returns `Vec<Vec<u8>>` — a top-level homogeneous collection of
    /// bytes, intentionally *not* a struct with nested fields. The NAPI
    /// transport runs `deepSnakeToCamel` on every result and the WASM
    /// transport does not (see `feedback_wasm_napi_case_conversion`); a
    /// flat Vec is identical across transports.
    ///
    /// Order is FIFO commit order. Returned slice is empty when there
    /// are no pending updates (orchestrator can use this as a no-op
    /// poll signal).
    #[bridge::read(scope = "workbook")]
    pub fn drain_pending_updates(&self) -> Result<Vec<Vec<u8>>, ComputeError> {
        self.update_buffer.drain_checked()
    }

    /// Close the active UndoManager capture window so the next mutation
    /// starts a fresh stack item.
    ///
    /// The orchestrator calls this from `RustDocument
    /// .checkpoint()` before encoding the persistence snapshot, so the
    /// in-flight journal entry is sealed and a subsequent edit doesn't
    /// silently merge with it across the persist boundary.
    ///
    /// Audit finding: yrs 0.21 calls this primitive
    /// `UndoManager::reset()`, not `stop_capturing` — the JS-side
    /// `stopCapturing` name is the historical analog. The wrapper in
    /// `compute_collab` documents the audit; see that module's docs for
    /// the full rationale.
    #[bridge::write(scope = "workbook")]
    pub fn flush_undo_capture(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sync::flush_undo_capture(self.mutation.undo_manager.inner_mut());
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapshot_types::WorkbookSnapshot;

    fn empty_engine() -> YrsComputeEngine {
        YrsComputeEngine::from_snapshot(WorkbookSnapshot::default())
            .expect("from_snapshot")
            .0
    }

    #[test]
    fn apply_sync_update_clears_active_context_on_success() {
        let source = empty_engine();
        let full_state = compute_collab::encode_full_state(source.storage().doc());
        let mut target = empty_engine();
        let context = SyncApplyOperationContextWire::legacy_raw("1".repeat(64));

        let (_patches, metadata) = target
            .apply_sync_update(&full_state, context)
            .expect("apply sync update");

        assert!(target.active_sync_context.is_none());
        assert!(metadata.provenance_report.pending_segment_ids.is_empty());
    }

    #[test]
    fn apply_sync_update_clears_active_context_on_error() {
        let mut engine = empty_engine();
        let context = SyncApplyOperationContextWire::legacy_raw("2".repeat(64));

        let result = engine.apply_sync_update(&[0xff], context);

        assert!(result.is_err());
        assert!(engine.active_sync_context.is_none());
    }

    #[test]
    fn apply_sync_update_legacy_adapter_accepts_duplicate_raw_update() {
        let source = empty_engine();
        let full_state = compute_collab::encode_full_state(source.storage().doc());
        let mut target = empty_engine();

        target
            .apply_sync_update_legacy(&full_state)
            .expect("first legacy sync update");
        target
            .apply_sync_update_legacy(&full_state)
            .expect("duplicate legacy sync update");

        assert!(target.active_sync_context.is_none());
    }
}
