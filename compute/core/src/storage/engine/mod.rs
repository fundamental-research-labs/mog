//! # Yrs-backed Compute Engine
//!
//! `YrsComputeEngine` is the orchestrator that wires CRDT storage, identity
//! tracking, undo/redo, and the `ComputeCore` recalculation scheduler.
//! All user edits flow through the yrs Doc, are detected by the
//! `StorageObserver`, and delegated to `ComputeCore` for recalculation.
//!
//! Root module policy: keep type ownership and module wiring here. Put bridge
//! domain APIs in sibling modules and shared behavior in services or focused
//! private modules.

pub mod construction;
mod mutation_coordinator;
mod mutation_dispatch;
mod pivot_materialization;
mod recalc;
mod settings;
mod stores;
mod sync_pipeline;
mod viewport;
// Wire format types and serialization — now in compute-wire crate
pub use compute_wire::mutation as mutation_binary;
pub use compute_wire::palette as format_palette;
pub use compute_wire::types as viewport_render_types;
pub use compute_wire::viewport as viewport_binary;
pub use export::ExportParseResult;
mod accessors;
mod atomics;
mod bridge_imports;
mod cell_bridge;
mod cell_semantics;
mod sync_bridge;
mod table_result_merge;
mod undo_bridge;
mod workbook_theme;
pub use cell_semantics::CellInfo;
mod cf_cache;
mod data_table_formula;
mod delegations;
mod export;
mod features;
mod filter_import_diagnostics;
mod format_inference;
mod formatting;
mod formula_read;
mod grid_indexing;
mod layout;
mod merge_index;
pub(crate) mod mutation;
mod objects;
mod queries;
mod query_serialization;
mod recalc_postprocess;
mod runtime_diagnostics;
mod screenshot;
pub mod search;
mod security;
pub(crate) mod security_events;
mod security_ops;
pub(crate) mod services;
mod structural;
mod styles;
mod tables;
pub(crate) mod update_buffer;
mod validation;

#[cfg(test)]
mod integration_tests_old_value;
#[cfg(test)]
mod tests;
#[cfg(test)]
use crate::{CellId, RangePos, SheetId, WorkbookSnapshot};
#[cfg(test)]
use cell_types::SheetPos;
#[cfg(test)]
use compute_document::hex::id_to_hex;
#[cfg(test)]
use mutation::{EngineMutation, MutationOutput};
#[cfg(test)]
use snapshot_types::MutationResult;

// Re-export `CsvImportOptions` so the bridge type generator (which reads
// `compute/core/src/storage/engine/mod.rs` as a source file) sees the
// type and emits its TS interface alongside the engine bridge methods.
// The source file `file-io/csv-parser/src/types.rs` is also added to the
// type generator's source list so the field-level definitions are
// captured.
pub use csv_parser::CsvImportOptions;

use crate::mirror::CellMirror;

pub(in crate::storage::engine) use grid_indexing::build_grid_from_yrs_for_sheet;
use mutation_coordinator::MutationCoordinator;
use settings::EngineSettings;
pub(crate) use stores::CFCacheEntry;
use stores::EngineStores;
use viewport::service::ViewportService;

/// Yrs-backed compute engine: CRDT storage + identity tracking + compute scheduler.
pub struct YrsComputeEngine {
    mirror: CellMirror,
    pub(crate) stores: EngineStores,
    pub(crate) mutation: MutationCoordinator,
    pub(crate) viewport: ViewportService,
    pub(crate) settings: EngineSettings,
    /// Security state — R2.3. Owns the live `PolicyEngine`, the version
    /// counters, the matrix cache, and the shared `active` flag that
    /// `ComputeService` reads for its gated-delegate fast path.
    pub(crate) security: crate::storage::security_state::SecurityState,
    /// Pending security events buffer — R5.4. Drained by
    /// `wb_security_drain_events`; SDK event relays poll this on each
    /// engine round-trip and re-fan-out into the per-SDK subscriber
    /// infrastructure.
    ///
    /// Held in an `Arc` because `SecurityState` keeps a second handle
    /// so the Yrs observer callback (fires on remote CRDT syncs) can
    /// push `SecurityEvent::PoliciesReloaded` — otherwise CRDT-initiated
    /// policy changes would never surface to SDK consumers that only
    /// poll this buffer.
    pub(crate) security_events: std::sync::Arc<security_events::SecurityEventBuffer>,

    /// Last canonical import report for this engine instance.
    ///
    /// This is runtime-only diagnostic state: it is replaced on workbook import,
    /// not persisted in Yrs, and not exported back to XLSX.
    pub(crate) import_report: domain_types::ImportReport,

    /// Runtime operation diagnostics emitted by user/session commands.
    ///
    /// This is engine-local state: it is retained only in memory, not persisted
    /// in Yrs, and not exported back to XLSX.
    pub(crate) runtime_diagnostics: runtime_diagnostics::RuntimeDiagnosticsStore,

    /// Yrs `update_v1` buffer.
    ///
    /// One observer is installed at engine construction; every committed
    /// write transaction pushes its v1-encoded update bytes onto this
    /// buffer. The bridge method `drain_pending_updates` pops the
    /// pending list for the kernel-side orchestrator (`RustDocument`) to
    /// fan out to attached Providers (IndexedDB / Tauri-file / etc.).
    ///
    /// Held in an `Arc` because the yrs observer callback runs on the
    /// commit path (Send + Sync) while the bridge drain runs on the
    /// dispatch actor thread. The subscription handle is held in
    /// `_update_subscription` to keep the observer alive for the engine's
    /// lifetime — dropping it would silently detach the observer.
    pub(crate) update_buffer: std::sync::Arc<update_buffer::UpdateBuffer>,

    /// Lifetime anchor for the `update_v1` subscription. Dropping this
    /// removes the observer from the yrs Doc; we keep it alive for the
    /// engine's lifetime so every transaction commit feeds
    /// `update_buffer`. Read only via `Drop`.
    _update_subscription: compute_collab::UpdateSubscriptionHandle,

    /// Session-scoped Scenario Manager apply/restore state.
    ///
    /// This is intentionally not persisted in Yrs. Apply captures a local
    /// baseline, writes scenario values through `apply_mutation`, and restore
    /// consumes that baseline through `apply_mutation`.
    pub(crate) scenario_session: crate::what_if::scenarios::ScenarioSessionState,

    /// Stored data for deferred Yrs CRDT hydration.
    /// When set, the engine was initialized in "fast" mode: CellMirror and
    /// indexes are populated from the snapshot/parse_output, but Yrs is empty.
    /// Call `complete_deferred_hydration()` to perform the slow Yrs write and
    /// rebuild indexes with full fidelity.
    deferred_hydration: Option<construction::DeferredHydrationData>,
}

impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // CF cache initialization
    // -------------------------------------------------------------------

    /// Pre-populate the CF cache for every sheet that has conditional
    /// formatting rules.  Called once at the end of `from_snapshot` and
    /// `import_from_xlsx_bytes` so the first viewport render doesn't
    /// need to trigger a lazy refresh.
    fn init_cf_caches(&mut self) {
        let sheet_ids = self.stores.storage.sheet_order();
        for sheet_id in &sheet_ids {
            self.refresh_cf_cache(sheet_id);
        }
    }

    pub(crate) fn assign_and_record_runtime_diagnostics(
        &mut self,
        diagnostics: &mut [crate::snapshot::RuntimeOperationDiagnostic],
    ) {
        self.runtime_diagnostics.assign_and_record(diagnostics);
    }

    pub(crate) fn clear_runtime_diagnostics(&mut self) {
        self.runtime_diagnostics.clear();
    }
}

impl std::fmt::Debug for YrsComputeEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("YrsComputeEngine")
            .field("storage", &self.stores.storage)
            .field("grid_indexes", &self.stores.grid_indexes.len())
            .field("observer", &self.mutation.observer)
            .finish()
    }
}
