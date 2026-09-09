//! Native spreadsheet engine coordinating sparse cells, UUID identities,
//! metadata, and incremental formula evaluation.
//!
//! Mutations update the native stores and schedule dependent formulas directly.
//! Root ownership and module wiring live here; domain APIs and shared behavior
//! live in the sibling modules.

pub mod construction;
mod mutation_coordinator;
mod mutation_dispatch;
mod pivot_materialization;
mod recalc;
mod runtime_settings;
mod settings;
mod stores;
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
pub(crate) mod cell_metadata;
mod cell_semantics;
mod chart_invalidation;
mod table_result_merge;
#[doc(hidden)]
pub mod versioning;
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
pub(crate) mod history;
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
pub(crate) mod services;
mod structural;
mod styles;
mod tables;
mod validation;

#[cfg(test)]
mod integration_tests_direct_edit_results;
#[cfg(test)]
mod integration_tests_find_in_range;
#[cfg(test)]
mod integration_tests_old_value;
#[cfg(test)]
mod integration_tests_replace_all;
#[cfg(test)]
mod tests;
#[cfg(test)]
use crate::{CellId, SheetId, WorkbookSnapshot};
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

pub(in crate::storage::engine) use grid_indexing::build_grid_from_native_sheet;
use mutation_coordinator::MutationCoordinator;
use settings::EngineSettings;
pub(crate) use stores::CFCacheEntry;
use stores::EngineStores;
use viewport::service::ViewportService;

/// Native spreadsheet state, identity tracking, and the formula scheduler.
pub struct ComputeEngine {
    mirror: CellMirror,
    pub(crate) stores: EngineStores,
    pub(crate) mutation: MutationCoordinator,
    history: history::HistoryStack,
    pub(crate) viewport: ViewportService,
    pub(crate) settings: EngineSettings,
    /// Last canonical import report for this engine instance.
    ///
    /// This is runtime-only diagnostic state: it is replaced on workbook import,
    /// and excluded from XLSX export.
    pub(crate) import_report: domain_types::ImportReport,

    /// Runtime operation diagnostics emitted by user/session commands.
    ///
    /// These diagnostics are retained only in memory.
    pub(crate) runtime_diagnostics: runtime_diagnostics::RuntimeDiagnosticsStore,

    /// Document-local version operation admission state.
    ///
    /// This is runtime-only state. Future bridge plumbing can attach a one-shot
    /// [`crate::snapshot::VersionOperationContextWire`] before a mutation
    /// crosses into Rust; guarded mutation boundaries consume it.
    version_runtime_operation_context: versioning::VersionRuntimeOperationContext,

    /// Session-scoped Scenario Manager apply/restore state.
    ///
    /// Apply captures a local
    /// baseline, writes scenario values through `apply_mutation`, and restore
    /// consumes that baseline through `apply_mutation`.
    pub(crate) scenario_session: crate::what_if::scenarios::ScenarioSessionState,

    /// Remaining import state when only the critical sheet has been hydrated.
    /// `complete_deferred_hydration` installs the remaining metadata and indexes.
    deferred_hydration: Option<construction::DeferredHydrationData>,
}

impl ComputeEngine {
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

impl std::fmt::Debug for ComputeEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ComputeEngine")
            .field("storage", &self.stores.storage)
            .field("grid_indexes", &self.stores.grid_indexes.len())
            .finish()
    }
}
