use bridge_core as bridge;
use compute_collab as sync;

use super::YrsComputeEngine;
use crate::snapshot::MutationResult;
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
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Capture pre-state from Yrs (still old) and in-memory indexes for
        // diffing after rebuild. This lets us detect deletions/removals.
        let pre_sheet_order: Vec<SheetId> = self.stores.storage.sheet_order();

        sync::apply_update(self.stores.storage.doc(), update).map_err(|e| ComputeError::Eval {
            message: format!("sync update failed: {}", e),
        })?;

        // Drain observer events so they don't leak into subsequent operations,
        // but don't rely on them — Yrs `observe_deep` is unreliable for
        // remote sync updates (it may silently merge CRDT state without
        // firing callbacks when both peers have the same root-level map keys).
        let _discarded = self.mutation.observer.drain_all_changes();

        // Always rebuild from Yrs after a sync update. This is the only
        // reliable way to ensure the in-memory cell index, grid indexes,
        // compute core, and mirror all reflect the converged CRDT state.
        self.rebuild_from_yrs_after_sync(pre_sheet_order)
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
