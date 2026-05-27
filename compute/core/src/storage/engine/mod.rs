//! # Yrs-backed Compute Engine
//!
//! `YrsComputeEngine` is the orchestrator that wires CRDT storage, identity
//! tracking, undo/redo, and the `ComputeCore` recalculation scheduler.
//! All user edits flow through the yrs Doc, are detected by the
//! `StorageObserver`, and delegated to `ComputeCore` for recalculation.

pub mod construction;
mod mutation_coordinator;
mod settings;
mod stores;
mod viewport;
// Wire format types and serialization — now in compute-wire crate
pub use compute_wire::mutation as mutation_binary;
pub use compute_wire::palette as format_palette;
pub use compute_wire::types as viewport_render_types;
pub use compute_wire::viewport as viewport_binary;
pub use export::ExportParseResult;
mod atomics;
mod cell_semantics;
pub use cell_semantics::CellInfo;
mod cf_cache;
mod data_table_formula;
mod delegations;
mod export;
mod features;
mod formatting;
mod layout;
mod merge_index;
pub(crate) mod mutation;
mod objects;
mod queries;
mod query_serialization;
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

use bridge_core as bridge;

// Re-export `CsvImportOptions` so the bridge type generator (which reads
// `compute/core/src/storage/engine/mod.rs` as a source file) sees the
// type and emits its TS interface alongside the engine bridge methods.
// The source file `file-io/csv-parser/src/types.rs` is also added to the
// type generator's source list so the field-level definitions are
// captured.
pub use csv_parser::CsvImportOptions;

use std::collections::{HashMap, HashSet};

use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::scheduler::ComputeCore;
use crate::snapshot::{
    CalculationSettings, MutationResult, RecalcResult, SheetLifecycleRuntimeHint, UndoState,
    WorkbookSnapshot,
};
use cell_types::{CellId, SheetId, SheetPos};
use compute_layout_index::LayoutIndex;
use domain_types::CellFormat;
use formula_types::IdentityFormulaRef;
use value_types::{CellValue, ComputeError};

use super::YrsStorage;
use compute_collab as sync;
use compute_document::hex::id_to_hex;
use compute_document::observe::{DocumentChanges, DocumentObserver};
use compute_document::undo::UndoRedoManager;
use mutation::{EngineMutation, MutationOutput};

use crate::snapshot::{ChangeKind, SortingChange};

use mutation_coordinator::{MutationCoordinator, SheetLifecycleHistoryHint};
use settings::EngineSettings;
pub(crate) use stores::CFCacheEntry;
use stores::EngineStores;
use viewport::service::ViewportService;

/// Apply observed `gridIndex/posToId` entry changes to the in-memory
/// `GridIndex` for each affected sheet.
///
/// Each entry carries a `CellId` and the `rowHex`/`colHex` identity pair;
/// resolve those to the current `(row, col)` by consulting the sheet's
/// `rowOrder`/`colOrder` YArrays (the same source-of-truth hydration uses).
/// Entries whose row/col hex no longer resolves — e.g. a row was deleted
/// between the write and the observation — are silently skipped.
///
/// Runs on both the writer (idempotent: register_cell is a no-op) and on
/// every peer that applies a remote update containing a `posToId` insert,
/// so a metadata-only write (comment, hyperlink, format on a previously
/// empty cell) propagates the cell's position into the peer's in-memory
/// `GridIndex` without waiting for a sheet-lifecycle rebuild.
fn apply_grid_index_changes(
    stores: &mut EngineStores,
    changes: &[compute_document::observe::GridIndexCellChange],
) {
    use crate::storage::infra::grid_helpers;
    use compute_document::observe::CellChangeKind;
    use yrs::{Array, Map, Out, Transact};

    if changes.is_empty() {
        return;
    }

    let txn = stores.storage.doc().transact();
    for change in changes {
        let sheet_hex = id_to_hex(change.sheet_id.as_u128());
        let Some(Out::YMap(sheet_map)) = stores.storage.sheets().get(&txn, &sheet_hex) else {
            continue;
        };
        let Some(row_arr) = grid_helpers::get_row_order_array(&sheet_map, &txn) else {
            continue;
        };
        let Some(col_arr) = grid_helpers::get_col_order_array(&sheet_map, &txn) else {
            continue;
        };
        let row = (0..row_arr.len(&txn)).find(|&i| {
            matches!(
                row_arr.get(&txn, i),
                Some(Out::Any(yrs::Any::String(s))) if s.as_ref() == change.row_hex
            )
        });
        let col = (0..col_arr.len(&txn)).find(|&i| {
            matches!(
                col_arr.get(&txn, i),
                Some(Out::Any(yrs::Any::String(s))) if s.as_ref() == change.col_hex
            )
        });
        let (Some(row), Some(col)) = (row, col) else {
            continue;
        };

        match change.kind {
            CellChangeKind::Modified => {
                if let Some(grid) = stores.grid_indexes.get_mut(&change.sheet_id) {
                    grid.register_cell(change.cell_id, row, col);
                }
            }
            CellChangeKind::Removed => {
                if let Some(grid) = stores.grid_indexes.get_mut(&change.sheet_id) {
                    // Guard: only remove if the cell is still at the vacated position.
                    // A preceding Modified event in the same observer batch may have
                    // already moved the cell to its new position — blindly removing
                    // would evict it from the new slot instead of the old one.
                    if grid.cell_position(&change.cell_id) == Some((row, col)) {
                        grid.remove_cell(&change.cell_id);
                    }
                }
            }
        }
    }
}

/// Build a GridIndex for a single sheet by reading rowOrder/colOrder from Yrs.
pub(super) fn build_grid_from_yrs_for_sheet(
    storage: &YrsStorage,
    sheet_id: SheetId,
    sheet_snap: &crate::snapshot::SheetSnapshot,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
) -> GridIndex {
    use crate::storage::infra::grid_helpers;
    use yrs::{Map, Out, Transact};

    let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
    let (row_hexes, col_hexes, pos_to_id_entries) = {
        let txn = storage.doc().transact();
        let sm = storage
            .sheets()
            .get(&txn, &sheet_hex)
            .and_then(|v| match v {
                Out::YMap(m) => Some(m),
                _ => None,
            });
        if let Some(sm) = sm {
            let rh = grid_helpers::get_row_order_array(&sm, &txn)
                .map(|a| grid_helpers::read_row_order(&a, &txn))
                .unwrap_or_default();
            let ch = grid_helpers::get_col_order_array(&sm, &txn)
                .map(|a| grid_helpers::read_col_order(&a, &txn))
                .unwrap_or_default();
            let pos_to_id_entries = sm
                .get(&txn, compute_document::schema::KEY_GRID_INDEX)
                .and_then(|out| match out {
                    Out::YMap(grid_index_map) => {
                        grid_index_map.get(&txn, compute_document::schema::KEY_GRID_POS_TO_ID)
                    }
                    _ => None,
                })
                .and_then(|out| match out {
                    Out::YMap(pos_to_id) => Some(
                        pos_to_id
                            .iter(&txn)
                            .filter_map(|(pos_key, value)| match value {
                                yrs::Out::Any(yrs::Any::String(cell_hex)) => {
                                    Some((pos_key.to_string(), cell_hex.to_string()))
                                }
                                _ => None,
                            })
                            .collect::<Vec<_>>(),
                    ),
                    _ => None,
                })
                .unwrap_or_default();
            (rh, ch, pos_to_id_entries)
        } else {
            (vec![], vec![], vec![])
        }
    };

    let mut grid = if !row_hexes.is_empty() || !col_hexes.is_empty() {
        GridIndex::from_yrs_arrays(sheet_id, &row_hexes, &col_hexes, id_alloc)
    } else {
        GridIndex::new(sheet_id, sheet_snap.rows, sheet_snap.cols, id_alloc)
    };

    for (pos_key, cell_hex) in pos_to_id_entries {
        let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
            continue;
        };
        let (Some(row), Some(col)) = (
            grid.row_index_from_hex(row_hex),
            grid.col_index_from_hex(col_hex),
        ) else {
            continue;
        };
        if let Some(cell_raw) = compute_document::hex::hex_to_id(&cell_hex) {
            grid.register_cell(CellId::from_raw(cell_raw), row, col);
        }
    }

    for cell_data in &sheet_snap.cells {
        if let Ok(cell_id) = CellId::from_uuid_str(&cell_data.cell_id) {
            grid.register_cell(cell_id, cell_data.row, cell_data.col);
        }
    }
    grid
}

/// Yrs-backed compute engine: CRDT storage + identity tracking + compute scheduler.
pub struct YrsComputeEngine {
    mirror: CellMirror,
    pub(crate) stores: EngineStores,
    pub(crate) mutation: MutationCoordinator,
    pub(crate) viewport: ViewportService,
    pub(crate) settings: EngineSettings,
    round_trip_context: Option<std::sync::Arc<domain_types::RoundTripContext>>,
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

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "core",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------

    /// Create a `YrsComputeEngine` from a workbook snapshot.
    #[tracing::instrument(name = "engine_from_snapshot", skip_all)]
    #[bridge::lifecycle(create)]
    #[bridge::skip(wasm, tauri, napi, pyo3)]
    pub fn from_snapshot(snapshot: WorkbookSnapshot) -> Result<(Self, RecalcResult), ComputeError> {
        construction::from_snapshot(snapshot)
    }

    // -------------------------------------------------------------------
    // Import (XLSX → Rust hydration, bypassing TypeScript pipeline)
    // -------------------------------------------------------------------

    /// Import directly from raw XLSX file bytes (with recalculation).
    ///
    /// Returns a [`MutationResult`] (with embedded [`RecalcResult`] in
    /// `result.recalc`) so hydration flows through the same TS-side
    /// `MutationResultHandler.applyAndNotify` pipeline as live mutations.
    /// This populates per-domain TS projections (drawings, tables,
    /// comments, filters, sparklines, named ranges, conditional formats,
    /// pivot tables, grouping) immediately on hydration — no per-domain
    /// follow-up event subscription / eager-fetch is required.
    ///
    /// The `Vec<u8>` slot in the tuple is the binary multi-viewport patches
    /// payload (always empty for hydration: viewport buffers are populated
    /// via the per-viewport prefetch path triggered by the renderer, not
    /// via patches threaded through this call).
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_import_from_xlsx_bytes", skip_all)]
    pub fn import_from_xlsx_bytes(
        &mut self,
        xlsx_data: &[u8],
        do_recalc: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let recalc = {
            let _span = tracing::info_span!("import_construction").entered();
            construction::import_from_xlsx_bytes(self, xlsx_data, do_recalc)?
        };
        let result = {
            let _span = tracing::info_span!("import_mutation_result").entered();
            services::mutation_handlers::build_mutation_result_for_hydration(
                &self.stores,
                &self.mirror,
                recalc,
            )
        };
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }

    /// Create a `YrsComputeEngine` from raw Yrs state bytes.
    ///
    /// Used for collaboration: creates an engine that shares the same CellIds
    /// and Yrs document history as the source engine. This is required for
    /// CRDT sync to work between engines.
    pub fn from_yrs_state(state: &[u8]) -> Result<(Self, RecalcResult), ComputeError> {
        construction::from_yrs_state(state)
    }

    /// Construct a `YrsComputeEngine` directly from raw XLSX bytes (no recalc).
    pub fn from_xlsx_bytes(xlsx_data: &[u8]) -> Result<(Self, RecalcResult), ComputeError> {
        construction::from_xlsx_bytes(xlsx_data)
    }

    /// Import from XLSX bytes without running formula recalculation.
    pub fn import_from_xlsx_bytes_no_recalc(
        &mut self,
        xlsx_data: &[u8],
    ) -> Result<RecalcResult, ComputeError> {
        construction::import_from_xlsx_bytes(self, xlsx_data, false)
    }

    /// Fast-path XLSX import: parses and builds indexes from snapshot (NO Yrs hydration).
    /// The viewport can display immediately. Call `complete_deferred_hydration()` after
    /// first paint to enable mutations and persistence.
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_import_from_xlsx_bytes_deferred", skip_all)]
    pub fn import_from_xlsx_bytes_deferred(
        &mut self,
        xlsx_data: &[u8],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        construction::import_from_xlsx_bytes_deferred(self, xlsx_data)?;
        // Build the mutation result using the existing hydration builder.
        // In deferred mode, Yrs is empty but the snapshot data is in
        // deferred_hydration. We temporarily build indexes + mutation result
        // from the deferred data, then call the standard builder which reads
        // domain data from the stores (grid indexes, merge indexes, layout indexes
        // are already populated from parse_output).
        let result = {
            let _span = tracing::info_span!("deferred_mutation_result").entered();
            services::mutation_handlers::build_mutation_result_for_deferred(
                &self.stores,
                &self.mirror,
                self.deferred_hydration.as_ref(),
            )
        };
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }

    /// Complete the deferred Yrs CRDT hydration started by `import_from_xlsx_bytes_deferred`.
    /// Call after first viewport paint. This performs the slow Yrs write and rebuilds
    /// indexes with full fidelity.
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_complete_deferred_hydration", skip_all)]
    pub fn complete_deferred_hydration(
        &mut self,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let Some(mut completion) = construction::stage_deferred_hydration(self)? else {
            let result = services::mutation_handlers::build_mutation_result_for_hydration(
                &self.stores,
                &self.mirror,
                RecalcResult::empty(),
            );
            return Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                result,
            ));
        };

        let mut recalc =
            if completion.calculation.full_calc_on_load || completion.calculation.force_full_calc {
                let calculation = completion.calculation.clone();
                let options = snapshot_types::RecalcOptions {
                    iterative: Some(calculation.iterate),
                    max_iterations: Some(calculation.iterate_count),
                    max_change: Some(
                        value_types::FiniteF64::new(calculation.iterate_delta)
                            .unwrap_or_else(|| value_types::FiniteF64::must(0.001)),
                    ),
                };
                Self::materialize_all_pivots_for_import_open(
                    &mut completion.stores,
                    &mut completion.mirror,
                );
                let result = completion
                    .stores
                    .compute
                    .full_recalc_with_options(&mut completion.mirror, &options)?;
                completion.stores.compute.clear_dirty();
                result
            } else {
                RecalcResult::empty()
            };

        construction::commit_deferred_hydration(self, completion);
        self.postprocess_import_open_recalc(&mut recalc);
        let result = services::mutation_handlers::build_mutation_result_for_hydration(
            &self.stores,
            &self.mirror,
            recalc,
        );
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }

    // -------------------------------------------------------------------
    // Import (CSV → Rust hydration, mirrors the XLSX path)
    // -------------------------------------------------------------------
    //
    // CSV produces a `domain_types::ParseOutput` from the bytes and then
    // reuses the same hydration pipeline as XLSX
    // (`hydrate_from_parse_output` → `parse_output_to_workbook_snapshot`
    // → `rebuild_engine_from_snapshot`). The plan diagram is:
    //
    //   csv bytes ─► csv_parser::parse_csv_to_parse_output ─► ParseOutput
    //                                                            │
    //                                                            ▼
    //                              [same path as XLSX from here on]

    /// Build a hydration-shape [`MutationResult`] over the current engine
    /// state without mutating Rust state.
    ///
    /// Called by the document lifecycle after a Provider replay completes
    /// (e.g. IndexedDB restore on browser refresh). Provider replay applies
    /// Yrs updates via `syncApply`, which populates the engine but never
    /// produces a `MutationResult` — so the kernel TS state mirror stays
    /// at its pre-attach defaults. This entry point lets the lifecycle
    /// emit a single hydration-shape `MutationResult` after replay so the
    /// mirror sees the post-replay snapshot for every sheet.
    ///
    /// Idempotent for snapshot-replace variants (sheet/workbook settings,
    /// frozen panes, scroll position, ...): calling on top of an
    /// already-settled mirror is safe and produces no observable change.
    /// Non-snapshot variants (charts, tables, comments, sparklines, CF
    /// rules, named ranges, pivots, grouping) are upserts on the TS side,
    /// so a redundant settle on a doc whose mirror was already populated
    /// (e.g. XLSX import + IndexedDB replay) is also safe — but the
    /// lifecycle only calls this on the *pure replay* path to avoid
    /// double work.
    ///
    /// Same shape as `import_from_xlsx_bytes`'s second return slot —
    /// returns `(empty_viewport_patches, mutation_result)` so the bridge
    /// transport's `BYTES_TUPLE_COMMANDS` plumbing matches the import path
    /// and the auto-generated TS shim wraps the call with `core.mutate(...)`,
    /// feeding the result through `MutationResultHandler.applyAndNotify`.
    /// Tagged `bridge::write` (rather than `bridge::read`) only because the
    /// TS code generator uses `MethodAccess::Write` + `(Uint8Array,
    /// MutationResult)` return shape as the trigger for the mutate-wrapping
    /// codegen path; this method does not actually mutate Rust state.
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_settle_for_mirror", skip_all)]
    pub fn settle_for_mirror(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::mutation_handlers::build_mutation_result_for_hydration(
            &self.stores,
            &self.mirror,
            RecalcResult::empty(),
        );
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }

    /// Import directly from raw CSV file bytes (with recalculation).
    ///
    /// Returns a [`MutationResult`] (with embedded [`RecalcResult`] in
    /// `result.recalc`) so hydration flows through the same TS-side
    /// `MutationResultHandler.applyAndNotify` pipeline as live mutations.
    /// See [`Self::import_from_xlsx_bytes`] for the architectural rationale —
    /// CSV is a sibling import boundary that benefits from the same fix.
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_import_from_csv_bytes", skip_all)]
    pub fn import_from_csv_bytes(
        &mut self,
        csv_data: &[u8],
        options: CsvImportOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let recalc = construction::import_from_csv_bytes(self, csv_data, &options, true)?;
        let result = services::mutation_handlers::build_mutation_result_for_hydration(
            &self.stores,
            &self.mirror,
            recalc,
        );
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }

    /// Construct a `YrsComputeEngine` directly from raw CSV bytes (no recalc).
    pub fn from_csv_bytes(
        csv_data: &[u8],
        options: CsvImportOptions,
    ) -> Result<(Self, RecalcResult), ComputeError> {
        construction::from_csv_bytes(csv_data, &options)
    }

    /// Import from CSV bytes without running formula recalculation.
    pub fn import_from_csv_bytes_no_recalc(
        &mut self,
        csv_data: &[u8],
        options: CsvImportOptions,
    ) -> Result<RecalcResult, ComputeError> {
        construction::import_from_csv_bytes(self, csv_data, &options, false)
    }

    /// Import specific sheets from an XLSX byte buffer into the existing document.
    ///
    /// Parses the XLSX, filters by `sheet_names` (case-insensitive), merges the
    /// style palette, hydrates each matched sheet into the Yrs document, syncs
    /// all stores, and inserts them at `insert_position` in the sheet order.
    /// Returns the names of inserted sheets (possibly deduped to avoid collisions).
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_import_sheets_from_xlsx", skip_all)]
    pub fn import_sheets_from_xlsx(
        &mut self,
        xlsx_data: &[u8],
        sheet_names: Vec<String>,
        insert_position: Option<u32>,
    ) -> Result<Vec<String>, ComputeError> {
        construction::import_sheets_from_xlsx(self, xlsx_data, &sheet_names, insert_position)
    }

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

    // -------------------------------------------------------------------
    // Locale
    // -------------------------------------------------------------------

    /// Get the cached locale for this workbook.
    pub fn locale(&self) -> &compute_formats::CultureInfo {
        &self.settings.locale
    }

    /// Update the cached locale when the workbook culture changes.
    #[bridge::write(scope = "workbook")]
    pub fn set_culture(
        &mut self,
        culture: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.settings.locale = compute_formats::get_culture(culture);
        // Locale affects date/number parsing — safest to require a fresh recalc.
        self.stores.compute.mark_dirty();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    // -------------------------------------------------------------------
    // Theme palette
    // -------------------------------------------------------------------

    /// Get the cached theme palette (slot name → hex color).
    pub fn theme_palette(&self) -> &HashMap<String, String> {
        &self.settings.theme_palette
    }

    /// Load the theme palette from the workbook map in Yrs storage.
    fn load_theme_palette(storage: &YrsStorage) -> HashMap<String, String> {
        construction::load_theme_palette(storage)
    }

    /// Set the workbook theme at runtime.
    ///
    /// Writes the theme data to the Yrs CRDT document, rebuilds the
    /// cached theme palette, and invalidates all viewport format palettes
    /// so that subsequent renders pick up the new theme colors.
    #[bridge::write(scope = "workbook")]
    pub fn set_workbook_theme(
        &mut self,
        theme: domain_types::domain::theme::ThemeData,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // 1. Write to Yrs
        {
            use yrs::Transact;
            let doc = self.stores.storage.doc();
            let mut txn = doc.transact_mut();
            let workbook = self.stores.storage.workbook_map();
            crate::storage::infra::hydration::write_theme_data_to_yrs(workbook, &theme, &mut txn);
            // txn commits on drop
        }

        // 2. Rebuild cached palette from Yrs
        self.settings.theme_palette = Self::load_theme_palette(&self.stores.storage);

        // 3. Invalidate viewport format palettes (stale theme-resolved colors)
        self.viewport.clear_all_palettes();

        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Read the current workbook theme from the Yrs document.
    #[bridge::read(scope = "workbook")]
    pub fn get_workbook_theme(
        &self,
    ) -> Result<domain_types::domain::theme::ThemeData, ComputeError> {
        use domain_types::domain::theme::ThemeData;
        use yrs::{Any, Map, Out, Transact};

        let doc = self.stores.storage.doc();
        let txn = doc.transact();
        let workbook = self.stores.storage.workbook_map();

        let theme_map = match workbook.get(&txn, "theme") {
            Some(Out::YMap(m)) => m,
            _ => return Ok(ThemeData::default()),
        };

        let json_str = match theme_map.get(&txn, "data") {
            Some(Out::Any(Any::String(s))) => s,
            _ => return Ok(ThemeData::default()),
        };

        serde_json::from_str::<ThemeData>(&json_str).map_err(|e| ComputeError::Eval {
            message: format!("failed to deserialize theme data: {}", e),
        })
    }

    // -------------------------------------------------------------------
    // Cell editing
    // -------------------------------------------------------------------

    /// User edits a cell. Writes to yrs Doc with ORIGIN_USER_EDIT,
    /// updates the mirror, and triggers recalculation.
    #[bridge::write(scope = "cell")]
    pub fn set_cell(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: mutation::CellInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut recalc = services::cell_editing::set_cell(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            sheet_id,
            cell_id,
            row,
            col,
            &input,
        )?;
        let format_result = if is_formula_parse_input(&input) {
            self.apply_formula_inherited_number_formats(&[(*sheet_id, row, col)])?
        } else {
            MutationResult::empty()
        };
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        let mut result = MutationResult::from_recalc(recalc);
        result
            .property_changes
            .extend(format_result.property_changes);
        Ok((patches, result))
    }

    /// Binary variant of [`set_cell`].
    #[bridge::write(scope = "cell")]
    #[bridge::skip(napi)]
    pub fn set_cell_binary(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: mutation::CellInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.set_cell(sheet_id, cell_id, row, col, input)
    }

    /// Enter a CSE (`Ctrl+Shift+Enter`) array formula on the given
    /// rectangular range. The formula is stored only on the top-left
    /// anchor; covered cells are projections of the array result and
    /// are read-only. Editing any covered cell via [`set_cell`]
    /// returns [`ComputeError::PartialArrayWrite`].
    ///
    /// Replaces the TS-side `arrayFormulaCells` registry — the CSE
    /// state is now authoritative in compute-core, surfaced via the
    /// `is_cse_anchor` / `is_array_formula` metadata fields on
    /// [`crate::snapshot::ActiveCellData`].
    #[bridge::write(scope = "sheet")]
    pub fn set_array_formula(
        &mut self,
        sheet_id: &SheetId,
        top_row: u32,
        left_col: u32,
        bottom_row: u32,
        right_col: u32,
        formula: String,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut recalc = services::cell_editing::set_array_formula(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            sheet_id,
            top_row,
            left_col,
            bottom_row,
            right_col,
            &formula,
        )?;
        let format_result =
            self.apply_formula_inherited_number_formats(&[(*sheet_id, top_row, left_col)])?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        let mut result = MutationResult::from_recalc(recalc);
        result
            .property_changes
            .extend(format_result.property_changes);
        Ok((patches, result))
    }

    // -------------------------------------------------------------------
    // Rich cell value operations (wired from cell_values module)
    // -------------------------------------------------------------------

    /// Set a single cell value using rich input parsing.
    #[bridge::write(scope = "cell")]
    pub fn set_cell_value_parsed(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        raw_input: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut recalc = services::cell_editing::set_cell_value_parsed(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            sheet_id,
            row,
            col,
            raw_input,
        )?;
        let format_result = if raw_input.trim().starts_with('=') {
            self.apply_formula_inherited_number_formats(&[(*sheet_id, row, col)])?
        } else {
            MutationResult::empty()
        };
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        let mut result = MutationResult::from_recalc(recalc);
        result
            .property_changes
            .extend(format_result.property_changes);
        Ok((patches, result))
    }

    /// Set a cell value as literal text, bypassing all type coercion.
    #[bridge::write(scope = "cell")]
    pub fn set_cell_value_as_text(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        value: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut recalc = services::cell_editing::set_cell_value_as_text(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            sheet_id,
            row,
            col,
            value,
        )?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        Ok((patches, MutationResult::from_recalc(recalc)))
    }

    /// Batch-set cell values using rich input parsing.
    #[bridge::write(scope = "sheet")]
    pub fn set_cell_values_parsed(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, String)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let group_undo = !updates.is_empty();
        let mut recalc = self.with_undo_group_if(group_undo, |engine| {
            services::cell_editing::set_cell_values_parsed(
                &mut engine.stores,
                &mut engine.mirror,
                &mut engine.mutation,
                sheet_id,
                &updates,
            )
        })?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        Ok((patches, MutationResult::from_recalc(recalc)))
    }

    /// Import pre-parsed cell values in bulk.
    #[bridge::write(scope = "sheet")]
    pub fn import_values(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, CellValue, Option<String>)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let group_undo = !updates.is_empty();
        let mut recalc = self.with_undo_group_if(group_undo, |engine| {
            services::cell_editing::import_values(
                &mut engine.stores,
                &mut engine.mirror,
                &mut engine.mutation,
                sheet_id,
                &updates,
            )
        })?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        Ok((patches, MutationResult::from_recalc(recalc)))
    }

    // -------------------------------------------------------------------
    // Undo / Redo
    // -------------------------------------------------------------------

    /// Undo the last user action. Returns viewport patches and mutation result
    /// from applying the undone changes.
    ///
    /// Uses the unified observer pipeline: drains ALL changes (not just cells),
    /// produces format viewport patches, and populates a complete MutationResult
    /// so the TS side sees dimension, merge, format, and other domain changes.
    #[bridge::write(scope = "workbook")]
    pub fn undo(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if !self.mutation.undo_manager.can_undo() {
            return Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ));
        }

        let undo_depth_before = self.mutation.undo_manager.undo_depth();
        let _did_undo =
            self.mutation
                .undo_manager
                .undo()
                .map_err(|e| ComputeError::InternalPanic {
                    message: e.to_string(),
                })?;

        // The undo operation modifies the yrs Doc. The observer detects ALL
        // changes across every domain. The unified pipeline handles:
        // - Cell changes → mirror sync + recalc + value viewport patches
        // - Property changes → format viewport patches + PropertyChange entries
        // - Dimension/merge/visibility/etc → MutationResult fields
        // - Table changes → sync_tables_from_yrs (inside apply_all_observer_changes)
        let (patches, mut result) = self.apply_observer_changes_with_patches()?;
        let redo_depth_after = self.mutation.undo_manager.redo_depth();
        if let Some(hint) = self
            .mutation
            .sheet_lifecycle_history
            .apply_undo(undo_depth_before, redo_depth_after)
        {
            Self::attach_sheet_lifecycle_runtime_hint(&mut result, hint);
        }
        Ok((patches, result))
    }

    /// Redo the last undone action. Returns viewport patches and mutation result
    /// from applying the redone changes.
    ///
    /// Same unified pipeline as `undo()`.
    #[bridge::write(scope = "workbook")]
    pub fn redo(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if !self.mutation.undo_manager.can_redo() {
            return Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ));
        }

        let redo_depth_before = self.mutation.undo_manager.redo_depth();
        let _did_redo =
            self.mutation
                .undo_manager
                .redo()
                .map_err(|e| ComputeError::InternalPanic {
                    message: e.to_string(),
                })?;

        // Same as undo: the redo modifies yrs Doc, observer detects ALL changes.
        let (patches, mut result) = self.apply_observer_changes_with_patches()?;
        if let Some(hint) = self
            .mutation
            .sheet_lifecycle_history
            .apply_redo(redo_depth_before)
        {
            Self::attach_sheet_lifecycle_runtime_hint(&mut result, hint);
        }
        Ok((patches, result))
    }

    #[bridge::read(scope = "workbook")]
    pub fn can_undo(&self) -> bool {
        services::undo::can_undo(&self.mutation)
    }
    #[bridge::read(scope = "workbook")]
    pub fn can_redo(&self) -> bool {
        services::undo::can_redo(&self.mutation)
    }
    #[bridge::read(scope = "workbook")]
    pub fn get_undo_state(&self) -> UndoState {
        services::undo::get_undo_state(&self.mutation)
    }

    #[bridge::write(scope = "workbook")]
    pub fn begin_undo_group(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.begin_undo_group();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }
    #[bridge::write(scope = "workbook")]
    pub fn end_undo_group(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.end_undo_group();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

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
    fn rebuild_from_yrs_after_sync(
        &mut self,
        pre_sheet_order: Vec<SheetId>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        use crate::snapshot::{
            Axis, DimensionChange, MergeChange, SheetChange, SheetChangeField,
            StructureChangeResult, StructureChangeType, VisibilityChange,
        };
        use crate::storage::sheet::dimensions;
        use value_types::FiniteF64;

        // ── Capture pre-state from in-memory indexes (not yet rebuilt) ──
        // Merges: snapshot current merge regions per sheet from the in-memory
        // spatial index (NOT from Yrs, which is already updated). This lets
        // us detect removals (unmerge) after rebuild.
        let pre_merges: HashMap<SheetId, HashSet<(u32, u32, u32, u32)>> = pre_sheet_order
            .iter()
            .map(|sid| {
                let regions: HashSet<_> = self
                    .stores
                    .merge_indexes
                    .get(sid)
                    .map(|idx| {
                        idx.items()
                            .iter()
                            .map(|m| (m.start_row, m.start_col, m.end_row, m.end_col))
                            .collect()
                    })
                    .unwrap_or_default();
                (*sid, regions)
            })
            .collect();

        // Grid row/col counts per sheet (for structure change detection).
        let pre_row_counts: HashMap<SheetId, usize> = pre_sheet_order
            .iter()
            .filter_map(|sid| {
                self.stores
                    .grid_indexes
                    .get(sid)
                    .map(|g| (*sid, g.row_ids_dense().len()))
            })
            .collect();
        let pre_col_counts: HashMap<SheetId, usize> = pre_sheet_order
            .iter()
            .filter_map(|sid| {
                self.stores
                    .grid_indexes
                    .get(sid)
                    .map(|g| (*sid, g.col_ids_dense().len()))
            })
            .collect();

        // ── Rebuild all in-memory state (existing logic) ──
        let workbook_snap = construction::build_workbook_snapshot_from_yrs(&self.stores.storage)?;

        for sheet_snap in &workbook_snap.sheets {
            if let Ok(sheet_id) = SheetId::from_uuid_str(&sheet_snap.id) {
                let grid = build_grid_from_yrs_for_sheet(
                    &self.stores.storage,
                    sheet_id,
                    sheet_snap,
                    self.stores.grid_id_alloc.clone(),
                );
                self.stores.grid_indexes.insert(sheet_id, grid);
            }
        }

        self.stores.compute = ComputeCore::new();
        let recalc = self
            .stores
            .compute
            .init_from_snapshot(&mut self.mirror, workbook_snap.clone())?;
        // `init_from_snapshot` seeds ComputeCore with a plain high-water-mark
        // allocator. In collaborative engines, CellIds must keep using the
        // participant-partitioned allocator stored on EngineStores; otherwise
        // post-sync formula/named-range identity allocation can collide across
        // offline peers.
        self.stores
            .compute
            .set_id_alloc(self.stores.grid_id_alloc.clone());

        self.stores.merge_indexes = construction::build_merge_indexes(
            &self.stores.storage,
            &workbook_snap,
            &self.stores.grid_indexes,
        )?;
        self.stores.layout_indexes = construction::build_layout_indexes(
            &self.stores.storage,
            &workbook_snap,
            &self.stores.grid_indexes,
        )?;

        self.mirror
            .install_row_col_indexes(self.stores.grid_indexes.iter().map(|(sid, grid)| {
                (
                    *sid,
                    grid.row_ids_dense().to_vec(),
                    grid.col_ids_dense().to_vec(),
                )
            }));
        construction::hydrate_mirror_format_ranges(&self.stores.storage, &mut self.mirror);
        self.mirror.finalize_range_hydration();

        self.settings = construction::derive_settings(&self.stores.storage);
        self.init_cf_caches();

        // ── Build MutationResult ──
        // Use the hydration helper for the ~19 fields it already covers
        // (sheets, comments, settings, workbook settings, floating objects,
        // tables, filters, CFs, sparklines, grouping, pivots, ranges,
        // named ranges). Then add the fields hydration intentionally skips.
        let mut result = services::mutation_handlers::build_mutation_result_for_hydration(
            &self.stores,
            &self.mirror,
            recalc,
        );

        let post_sheet_order: Vec<SheetId> = self.stores.storage.sheet_order();
        let doc = self.stores.storage.doc();
        let sheets_ref = self.stores.storage.sheets();

        // ── Sheet deletions (pre had it, post doesn't) ──
        for sid in &pre_sheet_order {
            if !post_sheet_order.contains(sid) {
                result.sheet_changes.push(SheetChange {
                    sheet_id: sid.to_uuid_string(),
                    kind: ChangeKind::Removed,
                    field: SheetChangeField::Sheet,
                    name: None,
                    old_name: None,
                    index: None,
                    old_index: None,
                    hidden: None,
                    source_sheet_id: None,
                    frozen_rows: None,
                    old_frozen_rows: None,
                    frozen_cols: None,
                    old_frozen_cols: None,
                    color: None,
                    old_color: None,
                });
            }
        }

        // ── Merge changes (current state as Set + removals) ──
        for sid in &post_sheet_order {
            let current_merges = services::queries::get_all_merges_in_sheet(&self.stores, sid);
            let sheet_id_str = sid.to_uuid_string();

            let current_set: HashSet<(u32, u32, u32, u32)> = current_merges
                .iter()
                .map(|m| (m.start_row, m.start_col, m.end_row, m.end_col))
                .collect();

            // Emit Set for each current merge
            for m in &current_merges {
                result.merge_changes.push(MergeChange {
                    sheet_id: sheet_id_str.clone(),
                    kind: ChangeKind::Set,
                    start_row: m.start_row,
                    start_col: m.start_col,
                    end_row: m.end_row,
                    end_col: m.end_col,
                });
            }

            // Emit Removed for merges that existed before but are gone
            if let Some(old_merges) = pre_merges.get(sid) {
                for &(sr, sc, er, ec) in old_merges {
                    if !current_set.contains(&(sr, sc, er, ec)) {
                        result.merge_changes.push(MergeChange {
                            sheet_id: sheet_id_str.clone(),
                            kind: ChangeKind::Removed,
                            start_row: sr,
                            start_col: sc,
                            end_row: er,
                            end_col: ec,
                        });
                    }
                }
            }
        }

        // ── Dimension changes (non-default row heights and col widths) ──
        for sid in &post_sheet_order {
            let sheet_id_str = sid.to_uuid_string();
            let grid = self.stores.grid_indexes.get(sid);

            for (row, height) in dimensions::get_all_custom_row_heights(doc, sheets_ref, sid, grid)
            {
                result.dimension_changes.push(DimensionChange {
                    sheet_id: sheet_id_str.clone(),
                    axis: Axis::Row,
                    index: row as u32,
                    kind: ChangeKind::Set,
                    size: FiniteF64::new(height.0),
                });
            }

            for (col, width) in dimensions::get_all_custom_col_widths(doc, sheets_ref, sid, grid) {
                result.dimension_changes.push(DimensionChange {
                    sheet_id: sheet_id_str.clone(),
                    axis: Axis::Col,
                    index: col as u32,
                    kind: ChangeKind::Set,
                    size: FiniteF64::new(width.0),
                });
            }
        }

        // ── Visibility changes (hidden rows and columns) ──
        for sid in &post_sheet_order {
            let sheet_id_str = sid.to_uuid_string();

            for row in dimensions::get_hidden_rows(doc, sheets_ref, sid) {
                result.visibility_changes.push(VisibilityChange {
                    sheet_id: sheet_id_str.clone(),
                    axis: Axis::Row,
                    index: row,
                    hidden: true,
                });
            }

            for col in dimensions::get_hidden_columns(doc, sheets_ref, sid) {
                result.visibility_changes.push(VisibilityChange {
                    sheet_id: sheet_id_str.clone(),
                    axis: Axis::Col,
                    index: col,
                    hidden: true,
                });
            }
        }

        // ── Structure changes (row/col count diffs) ──
        for sid in &post_sheet_order {
            let sheet_id_str = sid.to_uuid_string();
            if let Some(grid) = self.stores.grid_indexes.get(sid) {
                let post_rows = grid.row_ids_dense().len();
                let post_cols = grid.col_ids_dense().len();
                let pre_rows = pre_row_counts.get(sid).copied().unwrap_or(0);
                let pre_cols = pre_col_counts.get(sid).copied().unwrap_or(0);

                if post_rows > pre_rows {
                    result.structure_changes.push(StructureChangeResult {
                        sheet_id: sheet_id_str.clone(),
                        change_type: StructureChangeType::InsertRows,
                        at: pre_rows as u32,
                        count: (post_rows - pre_rows) as u32,
                    });
                } else if post_rows < pre_rows {
                    result.structure_changes.push(StructureChangeResult {
                        sheet_id: sheet_id_str.clone(),
                        change_type: StructureChangeType::DeleteRows,
                        at: post_rows as u32,
                        count: (pre_rows - post_rows) as u32,
                    });
                }

                if post_cols > pre_cols {
                    result.structure_changes.push(StructureChangeResult {
                        sheet_id: sheet_id_str.clone(),
                        change_type: StructureChangeType::InsertCols,
                        at: pre_cols as u32,
                        count: (post_cols - pre_cols) as u32,
                    });
                } else if post_cols < pre_cols {
                    result.structure_changes.push(StructureChangeResult {
                        sheet_id: sheet_id_str.clone(),
                        change_type: StructureChangeType::DeleteCols,
                        at: post_cols as u32,
                        count: (pre_cols - post_cols) as u32,
                    });
                }
            }
        }

        Ok((vec![], result))
    }

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

    // -------------------------------------------------------------------
    // Accessors
    // -------------------------------------------------------------------

    pub fn storage(&self) -> &YrsStorage {
        &self.stores.storage
    }
    /// Access the security state (R2.3). Not a `#[bridge::*]` method —
    /// consumed only by internal engine primitives (R3.1) and by
    /// `ComputeService::new` to grab the shared `active` handle.
    pub fn security(&self) -> &crate::storage::security_state::SecurityState {
        &self.security
    }
    pub fn mirror(&self) -> &CellMirror {
        &self.mirror
    }
    #[allow(dead_code)] // Bridge-ready: mutable engine access for bridge callers
    pub(crate) fn storage_mut(&mut self) -> &mut YrsStorage {
        &mut self.stores.storage
    }
    pub fn grid_index(&self, sheet_id: &SheetId) -> Option<&GridIndex> {
        self.stores.grid_indexes.get(sheet_id)
    }
    pub fn layout_index(&self, sheet_id: &SheetId) -> Option<&LayoutIndex> {
        self.stores.layout_indexes.get(sheet_id)
    }
    pub fn layout_index_mut(&mut self, sheet_id: &SheetId) -> Option<&mut LayoutIndex> {
        self.stores.layout_indexes.get_mut(sheet_id)
    }
    pub fn compute(&self) -> &ComputeCore {
        &self.stores.compute
    }
    #[allow(dead_code)] // Bridge-ready: mutable engine access for bridge callers
    pub(crate) fn compute_mut(&mut self) -> &mut ComputeCore {
        &mut self.stores.compute
    }
    pub fn undo_manager(&self) -> &UndoRedoManager {
        &self.mutation.undo_manager
    }
    pub fn observer(&self) -> &DocumentObserver {
        &self.mutation.observer
    }

    /// Run a closure with mutable access to the engine's internal stores,
    /// mirror, and mutation coordinator. Test-only — used by in-crate unit
    /// tests that need to call `pub(in crate::storage::engine)` helpers
    /// (e.g. `mutation_set_cells_raw`) directly without going through the
    /// `apply_mutation` dispatch.
    #[cfg(test)]
    pub(crate) fn with_internals_for_test<F, R>(&mut self, f: F) -> R
    where
        F: FnOnce(
            &mut crate::storage::engine::stores::EngineStores,
            &mut CellMirror,
            &mut crate::storage::engine::mutation_coordinator::MutationCoordinator,
        ) -> R,
    {
        f(&mut self.stores, &mut self.mirror, &mut self.mutation)
    }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------

    fn bootstrap_sheet_from_yrs(&mut self, sheet_id: SheetId) -> bool {
        if self.stores.grid_indexes.contains_key(&sheet_id) {
            return false;
        }

        let Some(sheet_snap) =
            construction::build_sheet_snapshot_from_yrs(&self.stores.storage, &sheet_id)
        else {
            return false;
        };

        let grid = build_grid_from_yrs_for_sheet(
            &self.stores.storage,
            sheet_id,
            &sheet_snap,
            self.stores.grid_id_alloc.clone(),
        );
        self.stores.grid_indexes.insert(sheet_id, grid);

        let _ = self.mirror.add_sheet(sheet_snap.clone());

        {
            use crate::storage::sheet::visibility;
            let enabled = visibility::is_sheet_calculation_enabled(
                self.stores.storage.doc(),
                self.stores.storage.sheets(),
                &sheet_id,
            );
            self.mirror.set_enable_calculation(&sheet_id, enabled);
        }

        let li = construction::build_layout_index_for_sheet(
            &self.stores.storage,
            &sheet_id,
            sheet_snap.rows,
            sheet_snap.cols,
            self.stores.grid_indexes.get(&sheet_id),
        );
        self.stores.layout_indexes.insert(sheet_id, li);

        true
    }

    fn collect_observer_touched_sheet_ids(
        &self,
        doc_changes: &DocumentChanges,
    ) -> HashSet<SheetId> {
        let mut sheet_ids = HashSet::new();

        sheet_ids.extend(doc_changes.sheet_additions.iter().copied());
        sheet_ids.extend(doc_changes.cells.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.properties.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.row_heights.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.col_widths.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.merges.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.hidden_rows.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.hidden_cols.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.comments.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.filters.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.grouping.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.sparklines.iter().map(|change| change.sheet_id));
        sheet_ids.extend(
            doc_changes
                .conditional_formats
                .iter()
                .map(|change| change.sheet_id),
        );
        sheet_ids.extend(
            doc_changes
                .floating_objects
                .iter()
                .map(|change| change.sheet_id),
        );
        sheet_ids.extend(
            doc_changes
                .pivot_tables
                .iter()
                .map(|change| change.sheet_id),
        );
        sheet_ids.extend(doc_changes.sheet_meta.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.row_formats.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.col_formats.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.sorting.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.structural_changes.iter().copied());
        sheet_ids.extend(doc_changes.grid_index.iter().map(|change| change.sheet_id));

        if doc_changes.sheet_order_changed {
            sheet_ids.extend(self.stores.storage.sheet_order());
        }

        sheet_ids
    }

    pub(crate) fn sync_runtime_calculation_settings(
        &mut self,
        pre: &CalculationSettings,
        post: &CalculationSettings,
    ) {
        self.apply_runtime_calculation_settings(post);

        if pre != post {
            self.stores.compute.mark_dirty();
        }
    }

    fn sync_runtime_calculation_settings_from_storage(&mut self) {
        let settings = crate::storage::workbook::settings::get_calculation_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let runtime_changed = self.runtime_calculation_settings_changed(&settings);
        self.apply_runtime_calculation_settings(&settings);

        if runtime_changed {
            self.stores.compute.mark_dirty();
        }
    }

    fn apply_runtime_calculation_settings(&mut self, settings: &CalculationSettings) {
        self.stores.compute.set_calc_mode(settings.calc_mode);
        self.stores
            .compute
            .set_iterative_calc(settings.enable_iterative_calculation);
        self.stores
            .compute
            .set_max_iterations(settings.max_iterations);
        self.stores
            .compute
            .set_max_change(settings.max_change.get());
    }

    fn runtime_calculation_settings_changed(&self, settings: &CalculationSettings) -> bool {
        self.stores.compute.calc_mode() != settings.calc_mode
            || self.stores.compute.iterative_calc() != settings.enable_iterative_calculation
            || self.stores.compute.max_iterations() != settings.max_iterations
            || self.stores.compute.max_change() != settings.max_change.get()
    }

    /// Drain observer changes, sync mirror + recalc, and return domain changes.
    fn apply_all_observer_changes(
        &mut self,
    ) -> Result<(RecalcResult, DocumentChanges), ComputeError> {
        let doc_changes = self.mutation.observer.drain_all_changes();

        if doc_changes.is_empty() {
            return Ok((RecalcResult::empty(), doc_changes));
        }

        if doc_changes.workbook_settings_changed {
            self.sync_runtime_calculation_settings_from_storage();
        }

        // --- Sheet lifecycle: additions and deletions ---
        // Process these BEFORE structural/cell changes so that new sheets
        // have in-memory indexes available for subsequent cell processing.
        let mut sheet_lifecycle_changed = false;

        // Handle additions: bootstrap in-memory state from yrs.
        //
        // When a sync update merges a remote peer's changes, Yrs may deliver
        // the sheet-level map entry as EntryChange::Updated (the local engine
        // already has the sheet, but the remote added cells inside it). The
        // observe_deep callback records this as a `sheet_additions` event, but
        // the cell-level changes within the sheet are NOT reported separately
        // in `doc_changes.cells` — they are bundled inside the sheet event.
        //
        // If bootstrap_sheet_from_yrs returns false (sheet already exists in
        // grid_indexes), we still need to rebuild from Yrs to pick up the new
        // cells. Mark sheet_lifecycle_changed unconditionally for any sheet
        // addition event — the rebuild path reads the full workbook from Yrs
        // and correctly materializes all cells.
        for &sheet_id in &doc_changes.sheet_additions {
            self.bootstrap_sheet_from_yrs(sheet_id);
            sheet_lifecycle_changed = true;
        }

        // Handle deletions: tear down in-memory state
        for &sheet_id in &doc_changes.sheet_deletions {
            if self.stores.grid_indexes.remove(&sheet_id).is_some() {
                sheet_lifecycle_changed = true;
            }
            self.mirror.remove_sheet(&sheet_id);
            self.stores.layout_indexes.remove(&sheet_id);
        }

        // A provider/full-state replay can deliver sheet-scoped cell/grid/meta
        // changes without a top-level `sheet_additions` event. Before the
        // incremental handlers run, ensure every touched sheet has its in-memory
        // grid/mirror/layout state bootstrapped from Yrs, then take the same
        // whole-workbook rebuild path used for explicit sheet lifecycle changes.
        let deleted_sheets: HashSet<SheetId> =
            doc_changes.sheet_deletions.iter().copied().collect();
        for sheet_id in self.collect_observer_touched_sheet_ids(&doc_changes) {
            if deleted_sheets.contains(&sheet_id) {
                continue;
            }
            if self.bootstrap_sheet_from_yrs(sheet_id) {
                sheet_lifecycle_changed = true;
            }
        }

        // If sheets were actually added or removed, rebuild ComputeCore
        // from the full workbook snapshot (necessary for cross-sheet formulas).
        // Read from Yrs (the CRDT source of truth) rather than in-memory state,
        // because the old ComputeCore doesn't have formulas for newly synced sheets.
        if sheet_lifecycle_changed {
            let workbook_snap =
                construction::build_workbook_snapshot_from_yrs(&self.stores.storage)?;

            // Rebuild `grid_indexes` for every sheet from Yrs, not just the
            // newly-added ones. Pre-existing sheets (e.g. the default Sheet1
            // that exists on every participant at fork time, before any cells
            // have been written) carry a stale in-memory index that misses
            // cells arriving in the same sync batch that introduced the new
            // sheet. Without this, a later local write on such a sheet cannot
            // resolve the coordinator-assigned CellId from (row, col) and
            // allocates a fresh one, orphaning any formula-graph edge that
            // pointed at the original CellId.
            for sheet_snap in &workbook_snap.sheets {
                if let Ok(sheet_id) = SheetId::from_uuid_str(&sheet_snap.id) {
                    let grid = build_grid_from_yrs_for_sheet(
                        &self.stores.storage,
                        sheet_id,
                        sheet_snap,
                        self.stores.grid_id_alloc.clone(),
                    );
                    self.stores.grid_indexes.insert(sheet_id, grid);
                }
            }

            self.stores.compute = ComputeCore::new();
            let recalc = self
                .stores
                .compute
                .init_from_snapshot(&mut self.mirror, workbook_snap.clone())?;
            self.stores
                .compute
                .set_id_alloc(self.stores.grid_id_alloc.clone());

            self.stores.merge_indexes = construction::build_merge_indexes(
                &self.stores.storage,
                &workbook_snap,
                &self.stores.grid_indexes,
            )?;
            self.stores.layout_indexes = construction::build_layout_indexes(
                &self.stores.storage,
                &workbook_snap,
                &self.stores.grid_indexes,
            )?;

            self.mirror.install_row_col_indexes(
                self.stores
                    .grid_indexes
                    .iter()
                    .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
            );
            construction::hydrate_mirror_format_ranges(&self.stores.storage, &mut self.mirror);
            self.mirror.finalize_range_hydration();

            self.settings = construction::derive_settings(&self.stores.storage);
            self.init_cf_caches();
            return Ok((recalc, doc_changes));
        }

        // --- Identity: mirror gridIndex/posToId entries into in-memory GridIndex ---
        // The yrs `gridIndex/posToId` sub-map is the CRDT-synchronised source of
        // truth for (row, col) ↔ CellId mappings (post-R51). When a peer
        // receives a metadata write on a previously-empty cell (comment,
        // format, hyperlink, …) the payload alone is not sufficient —
        // subsequent position-based lookups must resolve, so we hydrate the
        // in-memory GridIndex from every observed `posToId` entry change here,
        // BEFORE any cell/comment/etc. processing reads the index.
        // Vacated positions: (sheet_id, old_pos) pairs for cells that moved
        // due to a gridIndex change. We emit a synthetic Null viewport patch
        // for each one so the old screen position is visually cleared
        // (e.g. A1 during redo of a cut-paste that originally moved A1→C1).
        let mut vacated_positions: Vec<(SheetId, SheetPos)> = Vec::new();
        let mut occupied_positions: Vec<(SheetId, CellId, SheetPos)> = Vec::new();

        if !doc_changes.grid_index.is_empty() {
            apply_grid_index_changes(&mut self.stores, &doc_changes.grid_index);

            // For cells that changed position in the yrs gridIndex (undo/redo of
            // same-sheet relocate_cells writes updated posToId/idToPos entries),
            // update the mirror so apply_cell_changes can resolve the correct
            // position when the cell fires as Modified.
            //
            // Without this, the mirror retains the stale post-relocation
            // id_to_pos entry (e.g. X→C1) and apply_cell_changes would apply
            // the cell's value at the wrong position, leaving the source cells
            // empty after undo (half-undo bug).
            use compute_document::observe::CellChangeKind;
            for change in &doc_changes.grid_index {
                if matches!(change.kind, CellChangeKind::Modified) {
                    // Resolve the new position from the just-updated grid index.
                    let new_pos = self
                        .stores
                        .grid_indexes
                        .get(&change.sheet_id)
                        .and_then(|g| g.cell_position(&change.cell_id))
                        .map(|(r, c)| cell_types::SheetPos::new(r, c));
                    if let Some(new_pos) = new_pos {
                        // Vacate the stale old mirror position (clears pos_to_id
                        // and col_data at the former slot so apply_edit at the
                        // new position doesn't fight with the old mapping).
                        if let Some(old_pos) = self.mirror.resolve_position(&change.cell_id)
                            && old_pos != new_pos
                        {
                            self.mirror.vacate_position(&change.sheet_id, old_pos);
                            // Record the old position so we can emit a
                            // synthetic Null viewport patch for it (e.g.
                            // during redo, A1 must visually clear even though
                            // no yrs cell change targets A1 directly).
                            vacated_positions.push((change.sheet_id, old_pos));
                        }
                        // Update id_to_pos immediately so apply_cell_changes reads
                        // the correct position. Then, after all old positions have
                        // been vacated, repopulate pos_to_id/col_data for
                        // gridIndex-only moves that do not emit cell changes.
                        self.mirror
                            .update_id_to_pos(&change.sheet_id, change.cell_id, new_pos);
                        occupied_positions.push((change.sheet_id, change.cell_id, new_pos));
                    }
                }
            }

            for (sheet_id, cell_id, new_pos) in &occupied_positions {
                self.mirror
                    .sync_cell_position_mapping(sheet_id, *cell_id, *new_pos);
            }
        }

        // Detect structural meta changes (rows/cols modified by undo/redo/sync).
        // When structural changes are detected, the in-memory GridIndex and
        // CellMirror have stale positions — we must rebuild them from yrs
        // (the CRDT source of truth) rather than patching incrementally.
        let structural_sheets: Vec<SheetId> = {
            let mut seen = std::collections::HashSet::new();
            doc_changes
                .structural_changes
                .iter()
                .filter(|id| seen.insert(**id))
                .copied()
                .collect()
        };

        let mut recalc = if !structural_sheets.is_empty() {
            self.rebuild_after_structural_observer_change(&structural_sheets, &doc_changes)?
        } else {
            // Normal path: incremental cell changes only.
            if !doc_changes.cells.is_empty() {
                services::mutation::apply_cell_changes(
                    &mut self.stores,
                    &mut self.mirror,
                    &doc_changes.cells,
                )?
            } else {
                RecalcResult::empty()
            }
        };

        let occupied_position_set: std::collections::HashSet<(SheetId, u32, u32)> =
            occupied_positions
                .iter()
                .map(|(sheet_id, _, pos)| (*sheet_id, pos.row(), pos.col()))
                .collect();

        // Emit synthetic Null patches for positions vacated by gridIndex moves
        // (undo/redo of same-sheet relocate_cells). These clear old screen
        // positions unless the same observer batch reoccupied that position
        // (for example, sort undo permutes identities within the same range).
        if !vacated_positions.is_empty() {
            use snapshot_types::CellChange as SnapCellChange;
            use snapshot_types::CellPosition as SnapCellPosition;
            for (sheet_id, old_pos) in vacated_positions {
                if occupied_position_set.contains(&(sheet_id, old_pos.row(), old_pos.col())) {
                    continue;
                }
                recalc.changed_cells.push(SnapCellChange {
                    cell_id: String::new(),
                    sheet_id: sheet_id.to_uuid_string(),
                    position: Some(SnapCellPosition {
                        row: old_pos.row(),
                        col: old_pos.col(),
                    }),
                    value: value_types::CellValue::Null,
                    display_text: None,
                    format_idx: None,
                    extra_flags: 0,
                    old_value: None,
                });
            }
        }

        if !occupied_positions.is_empty() {
            use snapshot_types::CellChange as SnapCellChange;
            use snapshot_types::CellPosition as SnapCellPosition;

            let mut emitted_positions: std::collections::HashSet<(SheetId, u32, u32)> = recalc
                .changed_cells
                .iter()
                .filter_map(|change| {
                    let pos = change.position.as_ref()?;
                    let sheet_id = SheetId::from_uuid_str(&change.sheet_id).ok()?;
                    Some((sheet_id, pos.row, pos.col))
                })
                .collect();

            for (sheet_id, cell_id, new_pos) in occupied_positions {
                if !emitted_positions.insert((sheet_id, new_pos.row(), new_pos.col())) {
                    continue;
                }
                let value = self
                    .mirror
                    .get_cell_value_at(&sheet_id, new_pos)
                    .cloned()
                    .unwrap_or(value_types::CellValue::Null);
                recalc.changed_cells.push(SnapCellChange {
                    cell_id: cell_id.to_uuid_string(),
                    sheet_id: sheet_id.to_uuid_string(),
                    position: Some(SnapCellPosition {
                        row: new_pos.row(),
                        col: new_pos.col(),
                    }),
                    value,
                    display_text: None,
                    format_idx: None,
                    extra_flags: 0,
                    old_value: None,
                });
            }
        }

        // Update layout indexes for dimension changes.
        services::mutation::apply_dimension_changes_to_layout(
            &mut self.stores,
            &mut self.mirror,
            &doc_changes,
        );

        // Rebuild merge indexes for merge changes, and sync into CellMirror.
        services::mutation::apply_merge_changes_to_index(
            &mut self.stores,
            &mut self.mirror,
            &doc_changes,
        );

        // Sync tables from yrs if tables changed.
        if !doc_changes.tables.is_empty() {
            self.sync_tables_from_yrs();
        }

        // Sync named ranges from yrs if named ranges changed.
        if !doc_changes.named_ranges.is_empty() {
            self.sync_named_ranges_from_yrs();
        }

        Ok((recalc, doc_changes))
    }

    /// Rebuild in-memory indexes and ComputeCore after a structural change
    /// detected via the observer (undo/redo/sync of insert/delete rows/cols).
    ///
    /// The yrs CRDT is the source of truth. Structural operations only modify
    /// `meta.rows`/`meta.cols` in yrs — the yrs grid index (`idToPos`) is
    /// never touched by structural ops, so after undo it naturally contains
    /// the correct pre-structural positions.
    ///
    /// Rebuilds: GridIndex, CellMirror, LayoutIndex, merge indexes for
    /// affected sheets, then ComputeCore for the entire workbook (since
    /// formulas can cross-reference sheets).
    fn rebuild_after_structural_observer_change(
        &mut self,
        structural_sheets: &[SheetId],
        doc_changes: &DocumentChanges,
    ) -> Result<RecalcResult, ComputeError> {
        // 1. Rebuild GridIndex + CellMirror + LayoutIndex for affected sheets
        //    by reading directly from yrs.
        //
        //    Collect (sheet_id, formula_a1, cell_id) for cells that have a legacy
        //    formula (KEY_FORMULA in yrs) but no IdentityFormula (KEY_FORMULA_TEMPLATE).
        //    These arise when formulas are set via the API (set_cell_value), which
        //    only writes KEY_FORMULA. The IdentityFormula was built in-memory by
        //    parse_and_register_formula but never persisted to yrs, so rebuilding
        //    the mirror from yrs loses it. We re-parse these below so that
        //    regenerate_formula_strings (inside structure_change) can produce the
        //    correct A1 display strings.
        let mut formulas_needing_identity: Vec<(SheetId, CellId, String)> = Vec::new();

        for sheet_id in structural_sheets {
            if let Some(sheet_snap) =
                construction::build_sheet_snapshot_from_yrs(&self.stores.storage, sheet_id)
            {
                // Rebuild GridIndex for this sheet from Yrs rowOrder/colOrder
                let grid = build_grid_from_yrs_for_sheet(
                    &self.stores.storage,
                    *sheet_id,
                    &sheet_snap,
                    self.stores.grid_id_alloc.clone(),
                );
                self.stores.grid_indexes.insert(*sheet_id, grid);

                // Rebuild CellMirror for this sheet
                self.mirror.remove_sheet(sheet_id);
                let _ = self.mirror.add_sheet(sheet_snap.clone());

                // Sync enable_calculation flag from Yrs
                {
                    use crate::storage::sheet::visibility;
                    let enabled = visibility::is_sheet_calculation_enabled(
                        self.stores.storage.doc(),
                        self.stores.storage.sheets(),
                        sheet_id,
                    );
                    self.mirror.set_enable_calculation(sheet_id, enabled);
                }

                // Collect cells with legacy formula but no IdentityFormula.
                for cell_data in &sheet_snap.cells {
                    if cell_data.identity_formula.is_none()
                        && let Some(ref formula) = cell_data.formula
                        && let Ok(cell_id) = CellId::from_uuid_str(&cell_data.cell_id)
                    {
                        formulas_needing_identity.push((*sheet_id, cell_id, formula.clone()));
                    }
                }

                // Rebuild LayoutIndex for this sheet
                let li = construction::build_layout_index_for_sheet(
                    &self.stores.storage,
                    sheet_id,
                    sheet_snap.rows,
                    sheet_snap.cols,
                    self.stores.grid_indexes.get(sheet_id),
                );
                self.stores.layout_indexes.insert(*sheet_id, li);
            }
        }

        // 1b. Re-parse legacy formulas into IdentityFormulas so that
        //     regenerate_formula_strings (inside structure_change) works.
        for (sheet_id, cell_id, formula_a1) in &formulas_needing_identity {
            if let Ok(idf) =
                self.stores
                    .compute
                    .to_identity_formula(&mut self.mirror, sheet_id, formula_a1)
            {
                self.mirror.set_formula(cell_id, Some(idf));
            }
        }

        // 2. Process cell changes for NON-structural sheets via the normal path.
        let non_structural_cells: Vec<_> = doc_changes
            .cells
            .iter()
            .filter(|c| !structural_sheets.contains(&c.sheet_id))
            .cloned()
            .collect();
        let cell_recalc = if !non_structural_cells.is_empty() {
            services::mutation::apply_cell_changes(
                &mut self.stores,
                &mut self.mirror,
                &non_structural_cells,
            )?
        } else {
            RecalcResult::empty()
        };

        // 3. Clear the ProjectionRegistry before structure_change. The spatial index
        //    stores (origin_row, origin_col) tuples that are now stale after row/col
        //    shifts. full_recalc (inside structure_change) will re-evaluate all
        //    dynamic array formulas and re-register projections at correct positions.
        self.mirror.projection_registry.clear();

        // 4. Update ComputeCore's range extents and formula strings for the structural
        //    change. The CellId-keyed graph edges and ASTs are stable — only position-
        //    derived data (RangePos extents, A1 display strings) needs updating.
        //    The mirror and GridIndex were already rebuilt from yrs in step 1.
        let mut recalc = self
            .stores
            .compute
            .structure_change(&mut self.mirror, None)?;
        self.init_cf_caches();

        // Sync merge regions into the mirror for structural sheets.
        // The mirror was rebuilt from yrs (step 1), which does not carry merge
        // regions in the snapshot. Re-reading from yrs keeps the mirror's
        // merge_regions in sync so ProjectionRegistry::check_conflict works.
        for sheet_id in structural_sheets {
            services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        }

        // 5. Produce structural viewport patches for ALL viewport positions
        //    in affected sheets. The recalc only includes formula cells, but
        //    non-formula cells may have shifted positions and need refresh.
        for sheet_id in structural_sheets {
            let structural_patches = self.produce_structural_patches(sheet_id);
            services::structural::merge_viewport_patches_into_recalc(
                &mut recalc,
                structural_patches,
            );
        }

        // 6. Merge recalc results (non-structural cells + structural rebuild)
        recalc.changed_cells.extend(cell_recalc.changed_cells);
        recalc
            .projection_changes
            .extend(cell_recalc.projection_changes);
        recalc.errors.extend(cell_recalc.errors);

        Ok(recalc)
    }

    fn build_mutation_result_from_changes(
        &self,
        recalc: RecalcResult,
        changes: &DocumentChanges,
    ) -> MutationResult {
        services::mutation_handlers::build_mutation_result_from_changes(
            &self.stores,
            &self.mirror,
            &self.settings,
            recalc,
            changes,
            &|sheet_id, row, col| self.resolve_table_format_at_cell(sheet_id, row, col),
        )
    }

    /// Unified observer pipeline: drain changes, build viewport patches, build MutationResult.
    fn apply_observer_changes_with_patches(
        &mut self,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (mut recalc, doc_changes) = self.apply_all_observer_changes()?;

        // Build format viewport patches from property changes
        let format_patches = if !doc_changes.properties.is_empty() {
            self.produce_observer_format_patches(&doc_changes.properties)
        } else {
            vec![]
        };

        // Build value viewport patches from recalc
        self.prepare_recalc_for_flush(&mut recalc);
        let value_patches = self.flush_viewport_patches();

        // CF rule observer changes are sheet-wide visual mutations. Undo/redo
        // reaches this observer path rather than the direct CF CRUD methods,
        // so rebuild the affected sheet viewports here as the forward path does.
        let cf_patch_sets = if doc_changes.conditional_formats.is_empty() {
            vec![]
        } else {
            let mut sheets = std::collections::HashSet::new();
            for change in &doc_changes.conditional_formats {
                sheets.insert(change.sheet_id);
            }

            let mut patch_sets = Vec::with_capacity(sheets.len());
            for sheet_id in sheets {
                self.refresh_cf_cache(&sheet_id);
                patch_sets.push(self.produce_cf_viewport_patches(&sheet_id));
            }
            patch_sets
        };

        let sparkline_patch_sets = if doc_changes.sparklines.is_empty() {
            vec![]
        } else {
            let mut sheets = std::collections::HashSet::new();
            for change in &doc_changes.sparklines {
                sheets.insert(change.sheet_id);
            }

            sheets
                .into_iter()
                .map(|sheet_id| self.produce_full_viewport_patches(&sheet_id))
                .collect::<Vec<_>>()
        };

        // Merge value + format + CF + sparkline patches into a single binary payload.
        let mut combined_patches = viewport::service::ViewportService::merge_patch_binaries(
            &value_patches,
            &format_patches,
        );
        for cf_patches in cf_patch_sets {
            combined_patches = viewport::service::ViewportService::merge_patch_binaries(
                &combined_patches,
                &cf_patches,
            );
        }
        for sparkline_patches in sparkline_patch_sets {
            combined_patches = viewport::service::ViewportService::merge_patch_binaries(
                &combined_patches,
                &sparkline_patches,
            );
        }

        // Build complete MutationResult from recalc + document changes
        let result = self.build_mutation_result_from_changes(recalc, &doc_changes);

        Ok((combined_patches, result))
    }
}

impl YrsComputeEngine {
    /// Post-process recalc (CF refresh + display text + schema validation) and stash for flush.
    ///
    /// This is the central funnel for every mutation path that produces a
    /// `RecalcResult` — cell edits (`set_cell*`, `import_values`, `apply_changes`),
    /// structural changes, and every branch of `apply_mutation`. We mark the
    /// compute store dirty here so that a subsequent `recalculate_with_options`
    /// call cannot short-circuit past a mutation that actually changed state.
    fn prepare_recalc_for_flush(&mut self, recalc: &mut RecalcResult) {
        // A mutation reached this funnel: a subsequent full recalc must run.
        // This covers every Engine-level mutation entry point in one place:
        //   set_cell / set_cell_binary / set_cell_value_parsed /
        //   set_cell_value_as_text / set_cell_values_parsed / import_values /
        //   apply_changes / structure_change / apply_mutation's SetCells,
        //   ClearCells, SetCellsByPosition, ClearRangeByPosition, SortRange,
        //   RemoveDuplicates, ClearRange, ClearRangeAndReturnIds, DeleteSheet,
        //   CreateSubtotals, AutoFill, FlashFill, RelocateCells, CopyRange, …
        self.stores.compute.mark_dirty();

        self.refresh_cf_caches_after_recalc(recalc);
        self.enrich_display_text(recalc);

        // Run schema validation on all changed cells.
        if let Some(ref schemas) = self.stores.compute.schema_map {
            let dirty: Vec<CellId> = recalc
                .changed_cells
                .iter()
                .filter_map(|c| CellId::from_uuid_str(&c.cell_id).ok())
                .collect();
            recalc.validation_annotations =
                self.stores
                    .compute
                    .validate_dirty_cells(&self.mirror, &dirty, schemas);
        }

        // Run data-validation rules (the `dataValidations` Y.Array) on every
        // changed cell. This is independent of column schemas — a cell can
        // carry a data-validation rule (Excel-style "Data > Data Validation")
        // without being part of a typed column. We emit pass/fail annotations
        // for every covered cell so the TS bridge fires `validation:passed`
        // when an invalid cell becomes valid (clearing its validation circle)
        // and `validation:failed` when a valid cell becomes invalid.
        self.append_data_validation_annotations(recalc);

        self.mutation.pending_recalc = Some(recalc.clone());
    }

    /// Post-process an import-open recalc for the direct hydration return path.
    ///
    /// This needs the same observable enrichment as mutation flushes, but it
    /// must not leave compute dirty or seed a pending viewport recalc because
    /// the enriched payload is returned by `complete_deferred_hydration`
    /// itself.
    fn postprocess_import_open_recalc(&mut self, recalc: &mut RecalcResult) {
        self.prepare_recalc_for_flush(recalc);
        self.enrich_metadata_flags(recalc);
        self.stores.compute.clear_dirty();
        self.mutation.pending_recalc = None;
    }

    /// Append `RecalcValidationAnnotation` entries for every changed cell
    /// covered by a data-validation rule. Uses an `errors`-empty annotation
    /// for passes; the TS bridge interprets that as a `validation:passed`
    /// transition.
    fn append_data_validation_annotations(&self, recalc: &mut RecalcResult) {
        use crate::snapshot::{RecalcValidationAnnotation, RecalcValidationError};
        use crate::storage::sheet::schemas::DataValidationOutcome;
        use domain_types::domain::validation::{
            SchemaType, ValidationErrorCode, ValidationSeverity,
        };

        for change in &recalc.changed_cells {
            let Some(ref pos) = change.position else {
                continue;
            };
            let Ok(sheet_id) = SheetId::from_uuid_str(&change.sheet_id) else {
                continue;
            };
            let Ok(cell_id) = CellId::from_uuid_str(&change.cell_id) else {
                continue;
            };
            let row = pos.row;
            let col = pos.col;

            let outcome = services::formatting::validate_cell_against_data_validations(
                &self.stores,
                &self.mirror,
                &sheet_id,
                row,
                col,
                &change.value,
            );

            let errors = match outcome {
                DataValidationOutcome::NoRule => continue,
                DataValidationOutcome::Pass => Vec::new(),
                DataValidationOutcome::Fail { message } => vec![RecalcValidationError {
                    code: ValidationErrorCode::TypeMismatch,
                    message,
                    severity: ValidationSeverity::Error,
                }],
            };

            // Skip if a column-schema annotation already exists for this cell.
            // Column schemas take priority — re-emitting would either
            // overwrite metadata or duplicate events.
            let already_annotated = recalc
                .validation_annotations
                .iter()
                .any(|a| a.cell_id == change.cell_id);
            if already_annotated {
                continue;
            }

            recalc
                .validation_annotations
                .push(RecalcValidationAnnotation {
                    cell_id: cell_id.to_uuid_string(),
                    sheet_id: sheet_id.to_uuid_string(),
                    row,
                    column: col,
                    errors,
                    expected_type: SchemaType::Any,
                    actual_type: SchemaType::Any,
                });
        }
    }
}

impl YrsComputeEngine {
    fn attach_sheet_lifecycle_runtime_hint(
        result: &mut MutationResult,
        hint: SheetLifecycleRuntimeHint,
    ) {
        result.sheet_lifecycle_runtime_hint = Some(hint);
    }

    fn record_sheet_lifecycle_history_hint(
        &mut self,
        undo_depth_after: usize,
        hint: SheetLifecycleHistoryHint,
    ) {
        self.mutation
            .sheet_lifecycle_history
            .record_forward(undo_depth_after, hint);
    }

    fn with_undo_group_if<T>(
        &mut self,
        enabled: bool,
        f: impl FnOnce(&mut Self) -> Result<T, ComputeError>,
    ) -> Result<T, ComputeError> {
        if enabled {
            self.mutation.undo_manager.begin_undo_group();
        }
        let result = f(self);
        if enabled {
            self.mutation.undo_manager.end_undo_group();
        }
        result
    }

    /// Central dispatch for all mutations. Keeps all five stores in sync.
    pub(crate) fn apply_mutation(
        &mut self,
        mutation: EngineMutation,
    ) -> Result<MutationOutput, ComputeError> {
        validation::validate_mutation(&mutation, self)?;

        self.with_undo_group_if(mutation.should_auto_group_undo(), |engine| {
            engine.apply_mutation_inner(mutation)
        })
    }

    fn apply_mutation_inner(
        &mut self,
        mutation: EngineMutation,
    ) -> Result<MutationOutput, ComputeError> {
        let output = match mutation {
            EngineMutation::SetCell {
                sheet_id,
                cell_id,
                row,
                col,
                input,
            } => {
                let (_patches, mutation_result) =
                    self.set_cell(&sheet_id, cell_id, row, col, input)?;
                MutationOutput::Recalc(mutation_result)
            }

            EngineMutation::SetCells {
                edits,
                skip_cycle_check,
            } => {
                let formula_format_candidates: Vec<(SheetId, u32, u32)> = edits
                    .iter()
                    .filter_map(|(sid, _cid, row, col, input)| {
                        is_formula_parse_input(input).then_some((*sid, *row, *col))
                    })
                    .collect();
                let mut recalc = services::mutation_handlers::mutation_set_cells(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    edits,
                    skip_cycle_check,
                )?;
                let format_result =
                    self.apply_formula_inherited_number_formats(&formula_format_candidates)?;
                self.prepare_recalc_for_flush(&mut recalc);
                let mut result = MutationResult::from_recalc(recalc);
                result
                    .property_changes
                    .extend(format_result.property_changes);
                MutationOutput::Recalc(result)
            }

            EngineMutation::ClearCells { cell_ids } => {
                let mut recalc = services::mutation_handlers::mutation_clear_cells(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    cell_ids,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }

            EngineMutation::SetCellsByPosition {
                edits,
                skip_cycle_check,
            } => {
                // Snapshot Parse-text edits so we can run locale-aware date format
                // inference after the value writes land in the mirror. Doing this
                // here (rather than in TS) keeps the value write and the format
                // application atomic from the caller's perspective.
                let date_candidates: Vec<(SheetId, u32, u32, String)> = edits
                    .iter()
                    .filter_map(|(sid, row, col, input)| match input {
                        mutation::CellInput::Parse { text } => {
                            Some((*sid, *row, *col, text.clone()))
                        }
                        _ => None,
                    })
                    .collect();
                let formula_format_candidates: Vec<(SheetId, u32, u32)> = edits
                    .iter()
                    .filter_map(|(sid, row, col, input)| {
                        is_formula_parse_input(input).then_some((*sid, *row, *col))
                    })
                    .collect();

                let mut recalc = services::mutation_handlers::mutation_set_cells_by_position(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    edits,
                    skip_cycle_check,
                )?;
                let format_result =
                    self.apply_formula_inherited_number_formats(&formula_format_candidates)?;
                self.prepare_recalc_for_flush(&mut recalc);

                if !date_candidates.is_empty() {
                    self.apply_inferred_date_formats(&date_candidates)?;
                }

                let mut result = MutationResult::from_recalc(recalc);
                result
                    .property_changes
                    .extend(format_result.property_changes);
                MutationOutput::Recalc(result)
            }

            EngineMutation::ClearRangeByPosition {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                let mut recalc = services::mutation_handlers::mutation_clear_range_by_position(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }

            EngineMutation::CreateDataTable { input } => {
                let (region, data) =
                    crate::data_table::prepare_data_table_creation(&self.mirror, &input)?;
                crate::storage::workbook::data_tables::upsert_data_table_region(
                    self.stores.storage.doc(),
                    self.stores.storage.workbook_map(),
                    &region,
                );
                self.mirror.upsert_data_table_region(region);
                MutationOutput::Plain(MutationResult::empty().with_data(&data)?)
            }

            EngineMutation::ApplyScenario { scenario_id } => {
                let baseline_id =
                    cell_types::CellId::from_raw(self.stores.id_alloc.next_u128()).to_uuid_string();
                let plan = match crate::what_if::scenarios::prepare_apply(
                    &self.stores.storage,
                    &self.mirror,
                    &self.stores.compute,
                    &self.scenario_session,
                    &scenario_id,
                    baseline_id,
                ) {
                    Ok(plan) => plan,
                    Err(result) => {
                        return Ok(MutationOutput::Plain(
                            MutationResult::empty().with_data(&result)?,
                        ));
                    }
                };

                let mut recalc = services::mutation_handlers::mutation_set_cells_raw(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    plan.edits,
                    true,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);

                self.scenario_session.active = Some(crate::snapshot::ScenarioActiveState {
                    scenario_id: plan.result.scenario_id.clone(),
                    baseline_id: plan.baseline.baseline_id.clone(),
                    document_id: plan.baseline.document_id.clone(),
                    definition_status: Some("current".to_string()),
                    cell_mutation_status: Some("clean".to_string()),
                });
                self.scenario_session
                    .baselines
                    .insert(plan.baseline.baseline_id.clone(), plan.baseline);

                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&plan.result)?)
            }

            EngineMutation::RestoreScenario { baseline_id } => {
                let plan = match crate::what_if::scenarios::prepare_restore(
                    &self.mirror,
                    &self.stores.compute,
                    &self.scenario_session,
                    &baseline_id,
                ) {
                    Ok(plan) => plan,
                    Err(result) => {
                        return Ok(MutationOutput::Plain(
                            MutationResult::empty().with_data(&result)?,
                        ));
                    }
                };

                let mut recalc = services::mutation_handlers::mutation_set_cells_raw(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    plan.edits,
                    true,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);

                self.scenario_session.baselines.remove(&plan.baseline_id);
                if self
                    .scenario_session
                    .active
                    .as_ref()
                    .is_some_and(|active| active.baseline_id == plan.baseline_id)
                {
                    self.scenario_session.active = None;
                }

                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&plan.result)?)
            }

            EngineMutation::CreateSheet { name } => {
                let (hex, result) = services::mutation_handlers::mutation_create_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &name,
                )?;
                // R2.3 — new sheet added; any cached matrix that keyed
                // on a prior layout stays in the cache but is now
                // orphaned. Bump so workbook-scope lookups see the
                // fresh structure.
                self.security.bump_structure_version();
                // A new sheet can cause previously-#REF! cross-sheet
                // refs to resolve on next recalc — must not short-circuit.
                self.stores.compute.mark_dirty();
                let new_sheet_id =
                    SheetId::from_raw(compute_document::hex::hex_to_id(&hex).ok_or_else(|| {
                        ComputeError::Eval {
                            message: format!("Invalid created SheetId: {}", hex),
                        }
                    })?);
                self.record_sheet_lifecycle_history_hint(
                    self.mutation.undo_manager.undo_depth(),
                    SheetLifecycleHistoryHint {
                        undo: Some(SheetLifecycleRuntimeHint::reconcile()),
                        redo: Some(SheetLifecycleRuntimeHint::focus(new_sheet_id)),
                    },
                );
                MutationOutput::SheetId(hex, result)
            }

            EngineMutation::CreateDefaultSheet { name } => {
                // Same store-sync invariants as CreateSheet, but the underlying
                // Yrs transaction is tagged ORIGIN_BOOTSTRAP so it stays out of
                // the undo stack (a fresh workbook must report canUndo == false).
                let (hex, result) = services::mutation_handlers::mutation_create_default_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &name,
                )?;
                self.security.bump_structure_version();
                self.stores.compute.mark_dirty();
                MutationOutput::SheetId(hex, result)
            }

            EngineMutation::DeleteSheet { sheet_id } => {
                let (mut result, mut recalc) = services::mutation_handlers::mutation_delete_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                result.recalc = recalc;
                // R2.3 — sheet gone; every cached matrix for that
                // sheet id is now a lie. Let the LRU age them out.
                self.security.bump_structure_version();
                self.record_sheet_lifecycle_history_hint(
                    self.mutation.undo_manager.undo_depth(),
                    SheetLifecycleHistoryHint {
                        undo: Some(SheetLifecycleRuntimeHint::reconcile()),
                        redo: Some(SheetLifecycleRuntimeHint::reconcile()),
                    },
                );
                MutationOutput::Recalc(result)
            }

            EngineMutation::CopySheet {
                source_sheet_id,
                new_name,
            } => {
                let (hex, result) = services::mutation_handlers::mutation_copy_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &source_sheet_id,
                    &new_name,
                )?;
                // R2.3 — new sheet; same reasoning as CreateSheet.
                self.security.bump_structure_version();
                // Copied sheet adds new formula cells — next recalc has work.
                self.stores.compute.mark_dirty();
                let new_sheet_id =
                    SheetId::from_raw(compute_document::hex::hex_to_id(&hex).ok_or_else(|| {
                        ComputeError::Eval {
                            message: format!("Invalid copied SheetId: {}", hex),
                        }
                    })?);
                self.record_sheet_lifecycle_history_hint(
                    self.mutation.undo_manager.undo_depth(),
                    SheetLifecycleHistoryHint {
                        undo: Some(SheetLifecycleRuntimeHint::reconcile()),
                        redo: Some(SheetLifecycleRuntimeHint::focus(new_sheet_id)),
                    },
                );
                MutationOutput::SheetId(hex, result)
            }

            EngineMutation::RenameSheet { sheet_id, name } => {
                let result = services::mutation_handlers::mutation_rename_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &sheet_id,
                    &name,
                )?;
                // R2.3 — sheet identity is unchanged by rename (sheet
                // policies key on `SheetId`, not name), but rename is
                // structural in the bridge taxonomy and other layers
                // may key on name; bumping is cheap and keeps the
                // invariant "every structural op bumps" uniform.
                self.security.bump_structure_version();
                // Formula display strings key on sheet names — rename
                // can change A1 rendering; be safe and force next recalc.
                self.stores.compute.mark_dirty();
                MutationOutput::Plain(result)
            }

            EngineMutation::SortRange {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
                options,
            } => {
                let mut recalc = services::mutation_handlers::mutation_sort_range(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    &options,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                let rows_moved = recalc.changed_cells.len() as u32;
                let mut result = MutationResult::from_recalc(recalc);
                result.sorting_changes.push(SortingChange {
                    sheet_id: sheet_id.to_uuid_string(),
                    kind: ChangeKind::Set,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    rows_moved,
                });
                MutationOutput::Recalc(result)
            }

            EngineMutation::RemoveDuplicates {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
                columns,
                has_headers,
            } => {
                let (mut recalc, data) = services::mutation_handlers::mutation_remove_duplicates(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    &columns,
                    has_headers,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&data)?)
            }

            EngineMutation::ClearRange {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                let mut recalc = services::mutation_handlers::mutation_clear_range(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }

            EngineMutation::ClearRangeAndReturnIds {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                let cell_ids = services::mutation_handlers::collect_cell_ids_in_range(
                    &self.stores,
                    &sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                );
                let hex_ids: Vec<String> = cell_ids
                    .iter()
                    .map(|id| id_to_hex(id.as_u128()).into())
                    .collect();

                if cell_ids.is_empty() {
                    MutationOutput::Recalc(MutationResult::empty().with_data(&hex_ids)?)
                } else {
                    let mut recalc = services::mutation_handlers::mutation_clear_cells(
                        &mut self.stores,
                        &mut self.mirror,
                        &mut self.mutation,
                        cell_ids,
                    )?;
                    self.prepare_recalc_for_flush(&mut recalc);
                    MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&hex_ids)?)
                }
            }

            EngineMutation::CreateNamedRange { input } => {
                // Capture data needed for mirror sync before passing input to Yrs handler
                let nr_name = input.name.clone();
                let nr_refers_to = input.refers_to.clone();
                let nr_scope = input.scope.clone();
                let output =
                    services::mutation_handlers::mutation_named_range_create(&self.stores, input)?;
                // Sync the named range to the in-memory mirror/scheduler so the
                // formula evaluator can resolve it immediately.
                let scope = match nr_scope {
                    Some(ref s) => match SheetId::from_uuid_str(s) {
                        Ok(sid) => formula_types::Scope::Sheet(sid),
                        Err(_) => formula_types::Scope::Workbook,
                    },
                    None => formula_types::Scope::Workbook,
                };
                let def = formula_types::NamedRangeDef::from_expression(
                    nr_name.clone(),
                    scope,
                    nr_refers_to,
                );
                self.stores
                    .compute
                    .set_named_range(&mut self.mirror, nr_name, def);
                // Formulas that reference this name now resolve to a real
                // range — next recalc must re-evaluate them.
                self.stores.compute.mark_dirty();
                output
            }

            EngineMutation::UpdateNamedRange { id, mut updates } => {
                // Yrs storage contract (typed formula boundary): `DefinedName.refers_to`
                // must be `serde_json::to_string(&IdentityFormula)`. The
                // inbound `updates.refers_to` is an A1 expression — convert it
                // here so the storage layer writes the canonical format.
                // Without this, `get_all_named_ranges_wire` silently filters
                // the entry out (the wire reader's IdentityFormula JSON parse
                // fails) and dependents see the name disappear. Mirrors the
                // logic in `set_named_range` (delegations.rs).
                let original_refers_to_a1 = updates.refers_to.clone();
                let is_rename = updates.name.is_some();
                if let Some(a1_expr) = updates.refers_to.take() {
                    let a1 = if a1_expr.starts_with('=') {
                        a1_expr
                    } else {
                        format!("={}", a1_expr)
                    };
                    // Determine a context sheet for parsing: prefer the
                    // existing entry's scope; fall back to the first sheet.
                    let existing = crate::storage::workbook::named_ranges::get_named_range_by_id(
                        self.stores.storage.doc(),
                        self.stores.storage.workbook_map(),
                        &id,
                    );
                    let context_sheet = existing
                        .as_ref()
                        .and_then(|dn| dn.scope.as_deref())
                        .and_then(|s| SheetId::from_uuid_str(s).ok())
                        .or_else(|| self.mirror.sheet_ids().next().copied());

                    let identity = match context_sheet {
                        Some(ctx) => self
                            .stores
                            .compute
                            .to_identity_formula(&mut self.mirror, &ctx, &a1)
                            .unwrap_or_else(|_| formula_types::IdentityFormula {
                                template: a1.strip_prefix('=').unwrap_or(&a1).to_string(),
                                refs: vec![],
                                is_dynamic_array: false,
                                is_volatile: false,
                                is_aggregate: false,
                            }),
                        None => formula_types::IdentityFormula {
                            template: a1.strip_prefix('=').unwrap_or(&a1).to_string(),
                            refs: vec![],
                            is_dynamic_array: false,
                            is_volatile: false,
                            is_aggregate: false,
                        },
                    };

                    // Persist identity mappings so remote peers can resolve
                    // the IdentityFormula's CellIds back to (sheet, row, col).
                    services::cell_editing::persist_identity_formula_cell_identities(
                        &mut self.stores,
                        &self.mirror,
                        &identity,
                    );

                    let refers_to_json = serde_json::to_string(&identity)
                        .expect("IdentityFormula serialization should not fail");
                    updates.refers_to = Some(refers_to_json);
                }

                let output = services::mutation_handlers::mutation_named_range_update(
                    &self.stores,
                    &mut self.mirror,
                    id,
                    updates,
                )?;
                // Mirror sync uses the ORIGINAL A1 expression — `from_expression`
                // stores it as `raw_expression` for the evaluator to parse at
                // resolution time. Passing the JSON would break evaluation.
                let mut recalc_result: Option<RecalcResult> = None;
                if let Some(refers_to) = original_refers_to_a1
                    && let MutationOutput::Plain(ref result) = output
                    && let Some(ref data) = result.data
                    && let Ok(dn) =
                        serde_json::from_value::<domain_types::DefinedName>(data.clone())
                {
                    let scope = match dn.scope {
                        Some(ref s) => match SheetId::from_uuid_str(s) {
                            Ok(sid) => formula_types::Scope::Sheet(sid),
                            Err(_) => formula_types::Scope::Workbook,
                        },
                        None => formula_types::Scope::Workbook,
                    };
                    let scope_for_seed = scope.clone();
                    let key_for_seed = dn.name.to_ascii_lowercase();
                    let def = formula_types::NamedRangeDef::from_expression(
                        dn.name.clone(),
                        scope,
                        refers_to,
                    );
                    self.stores
                        .compute
                        .set_named_range(&mut self.mirror, dn.name, def);

                    // Excel parity: redefining a name immediately recomputes
                    // every formula that references it. Seed an incremental
                    // recalc from the variable's synthetic CellId — every
                    // dependent formula has a graph edge into it.
                    let seed_id = self
                        .mirror
                        .variables
                        .get_variable_cell_id(&scope_for_seed, &key_for_seed);
                    if let Some(cell_id) = seed_id
                        && let Ok(recalc) = self.stores.compute.recalc(&mut self.mirror, &[cell_id])
                    {
                        recalc_result = Some(recalc);
                    } else {
                        self.stores.compute.mark_dirty();
                    }
                }
                if is_rename {
                    // Mirror IdentityFormula.template strings just changed; the
                    // A1 display cache used by `get_formula` reads from those,
                    // so it needs regenerating.
                    self.stores.compute.regenerate_formula_strings(&self.mirror);
                }
                if let Some(mut recalc) = recalc_result {
                    self.prepare_recalc_for_flush(&mut recalc);
                    let mut merged = MutationResult::from_recalc(recalc);
                    if let MutationOutput::Plain(plain) = output {
                        merged.named_range_changes = plain.named_range_changes;
                        merged.data = plain.data;
                    }
                    MutationOutput::Recalc(merged)
                } else {
                    output
                }
            }

            EngineMutation::ImportNamedRanges { names } => {
                // Capture name data for mirror sync
                let name_data: Vec<_> = names
                    .iter()
                    .map(|n| (n.name.clone(), n.refers_to.clone(), n.scope.clone()))
                    .collect();
                let output =
                    services::mutation_handlers::mutation_named_ranges_import(&self.stores, names)?;
                // Sync each imported named range to the mirror
                for (name, refers_to, scope_str) in name_data {
                    let scope = match scope_str {
                        Some(ref s) => match SheetId::from_uuid_str(s) {
                            Ok(sid) => formula_types::Scope::Sheet(sid),
                            Err(_) => formula_types::Scope::Workbook,
                        },
                        None => formula_types::Scope::Workbook,
                    };
                    let def = formula_types::NamedRangeDef::from_expression(
                        name.clone(),
                        scope,
                        refers_to,
                    );
                    self.stores
                        .compute
                        .set_named_range(&mut self.mirror, name, def);
                }
                // Any imported name may enable new formula resolutions.
                self.stores.compute.mark_dirty();
                output
            }

            EngineMutation::CreateSubtotals {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
                options,
            } => {
                let (mut recalc, subtotal_result) = self.mutation_create_subtotals(
                    &sheet_id, start_row, start_col, end_row, end_col, options,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(
                    MutationResult::from_recalc(recalc).with_data(&subtotal_result)?,
                )
            }

            EngineMutation::AutoFill { sheet_id, request } => {
                let (mut recalc, summary) = services::mutation_handlers::mutation_auto_fill(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                    request,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&summary)?)
            }

            EngineMutation::FlashFill { sheet_id, request } => {
                let (mut recalc, summary) = services::mutation_handlers::mutation_flash_fill(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                    request,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&summary)?)
            }

            EngineMutation::RelocateCells {
                source_sheet_id,
                src_start_row,
                src_start_col,
                src_end_row,
                src_end_col,
                target_sheet_id,
                target_row,
                target_col,
            } => {
                let (mut recalc, relocate_result) =
                    services::mutation_handlers::mutation_relocate_cells(
                        &mut self.stores,
                        &mut self.mirror,
                        &mut self.mutation,
                        &source_sheet_id,
                        src_start_row,
                        src_start_col,
                        src_end_row,
                        src_end_col,
                        &target_sheet_id,
                        target_row,
                        target_col,
                    )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(
                    MutationResult::from_recalc(recalc).with_data(&relocate_result)?,
                )
            }

            EngineMutation::CopyRange {
                source_sheet_id,
                src_start_row,
                src_start_col,
                src_end_row,
                src_end_col,
                target_sheet_id,
                target_row,
                target_col,
                copy_type,
                skip_blanks,
                transpose,
            } => {
                let mut recalc = services::mutation_handlers::mutation_copy_range(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &source_sheet_id,
                    src_start_row,
                    src_start_col,
                    src_end_row,
                    src_end_col,
                    &target_sheet_id,
                    target_row,
                    target_col,
                    copy_type,
                    skip_blanks,
                    transpose,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }
        };

        Ok(output)
    }

    /// Populate `display_text` on each `CellChange` using the canonical format pipeline.
    fn enrich_display_text(&self, result: &mut RecalcResult) {
        services::mutation_handlers::enrich_display_text(
            &self.stores,
            &self.mirror,
            &self.settings,
            result,
            &|value, sheet_id, row, col| self.format_value_at_cell(value, sheet_id, row, col),
        );
    }

    /// Populate `extra_flags` on each `CellChange` with metadata flags.
    fn enrich_metadata_flags(&self, recalc: &mut RecalcResult) {
        services::mutation_handlers::enrich_metadata_flags(&self.stores, &self.mirror, recalc);
    }

    /// Create a new sheet (used by objects.rs for pivot table creation).
    fn mutation_create_sheet(
        &mut self,
        name: &str,
    ) -> Result<(String, MutationResult), ComputeError> {
        services::mutation_handlers::mutation_create_sheet(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            name,
        )
    }

    // -------------------------------------------------------------------
    // CreateSubtotals — insert rows + SUBTOTAL formulas with recalc
    // -------------------------------------------------------------------

    /// Create subtotal rows and groups with full store synchronization.
    /// The domain function writes to yrs; we then sync all cells in the
    /// affected range with compute for recalc.
    fn mutation_create_subtotals(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: super::sheet::grouping::SubtotalOptions,
    ) -> Result<(RecalcResult, super::sheet::grouping::SubtotalResult), ComputeError> {
        use super::sheet::grouping;

        let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);
        let doc = self.stores.storage.doc().clone();
        let sheets_map = doc.get_or_insert_map("sheets");

        // The Accessor struct needs &mut YrsComputeEngine because set_cell and
        // structure_change are engine methods that coordinate all five stores.
        struct Accessor<'a> {
            engine: &'a mut YrsComputeEngine,
        }
        impl<'a> grouping::SubtotalsCellAccessor for Accessor<'a> {
            fn get_cell_value(&self, sid: &SheetId, row: u32, col: u32) -> String {
                self.engine
                    .mirror
                    .get_cell_value_at(sid, SheetPos::new(row, col))
                    .map(|v| format!("{}", v))
                    .unwrap_or_default()
            }
            fn set_cell_value(&mut self, sid: &SheetId, row: u32, col: u32, value: &str) {
                if let Some(grid) = self.engine.stores.grid_indexes.get_mut(sid) {
                    let cell_id = grid.ensure_cell_id(row, col);
                    let _ = self.engine.set_cell(sid, cell_id, row, col, value.into());
                }
            }
            fn insert_rows(&mut self, sid: &SheetId, at_row: u32, count: u32) {
                let change = formula_types::StructureChange::InsertRows {
                    at: at_row,
                    count,
                    new_row_ids: Vec::new(),
                };
                let _ = self.engine.structure_change(sid, &change);
            }
            fn delete_rows(&mut self, sid: &SheetId, at_row: u32, count: u32) {
                let change = formula_types::StructureChange::DeleteRows {
                    at: at_row,
                    count,
                    deleted_cell_ids: Vec::new(),
                };
                let _ = self.engine.structure_change(sid, &change);
            }
            fn get_cell_raw_value(&self, sid: &SheetId, row: u32, col: u32) -> String {
                self.engine
                    .mirror
                    .get_cell_value_at(sid, SheetPos::new(row, col))
                    .map(|v| format!("{}", v))
                    .unwrap_or_default()
            }
        }

        self.mutation.observer.set_suppressed(true);
        let mut accessor = Accessor { engine: self };
        let subtotal_result = grouping::create_subtotals(
            &doc,
            &sheets_map,
            &mut accessor,
            sheet_id,
            &range,
            &options,
        );
        self.mutation.observer.set_suppressed(false);

        // Sync all cells in the expanded range with compute.
        let actual_end_row = end_row + subtotal_result.subtotal_rows_inserted;
        let recalc = services::cell_editing::sync_range_with_compute(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            start_row,
            start_col,
            actual_end_row,
            end_col,
        )?;
        Ok((recalc, subtotal_result))
    }

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    /// Perform a full recalculation of all formula cells using the existing
    /// dependency graph and AST caches. Does NOT rebuild the ComputeCore.
    ///
    /// Use this for `wb.calculate()` and other cases where the graph structure
    /// hasn't changed. Use `structure_change()` when row/col structure changed.
    /// Use `rebuild_compute_core()` ONLY for engine initialization paths.
    ///
    /// Short-circuits to an empty result when no mutation has occurred since
    /// the last successful full recalc — idempotent `wb.calculate()` is O(1).
    pub fn recalculate(&mut self) -> Result<crate::snapshot::RecalcResult, ComputeError> {
        // Audited 2026-04-22: no non-mutation invalidation sources for
        // init_cf_caches or materialize_all_pivots — safe to skip when
        // compute store is clean:
        //   - CF rule CRUD (add/update/delete/reorder rules, update ranges)
        //     calls refresh_cf_cache(sheet_id) directly at the mutation site;
        //     init_cf_caches in recalc is value-driven only, not rule-driven.
        //   - Pivot CRUD (pivot_create/update/delete) marks the store dirty
        //     explicitly so materialize_all_pivots still runs on next recalc.
        //   - set_culture marks dirty (locale affects date/number parsing).
        //   - Sheet CRUD and named-range CRUD mark dirty (may change resolution).
        if !self.stores.compute.is_dirty() {
            return Ok(crate::snapshot::RecalcResult::empty());
        }
        self.materialize_all_pivots();
        let result = self.stores.compute.full_recalc(&mut self.mirror)?;
        self.init_cf_caches();
        self.stores.compute.clear_dirty();
        Ok(result)
    }

    /// Recalculate with per-call iterative calculation overrides.
    ///
    /// `calculate()` is idempotent: after a successful recalc, a subsequent
    /// bare call with no intervening mutation returns an empty result in
    /// O(1). To drive convergence of a circular model, callers must opt in
    /// explicitly via `{ iterative: true, max_iterations, max_change }` —
    /// each explicit-override call runs a full recalc so repeated calls
    /// with the iterative option can step toward a fixed point.
    ///
    /// Short-circuits to an empty result when no mutation has occurred since
    /// the last successful full recalc AND the caller passed no iterative
    /// overrides.
    pub fn recalculate_with_options(
        &mut self,
        options: &snapshot_types::RecalcOptions,
    ) -> Result<crate::snapshot::RecalcResult, ComputeError> {
        // Audited 2026-04-22: no non-mutation invalidation sources for
        // init_cf_caches or materialize_all_pivots — safe to skip when
        // compute store is clean. Same audit as `recalculate()` above.
        let has_explicit_overrides = options.iterative.is_some()
            || options.max_iterations.is_some()
            || options.max_change.is_some();
        if !self.stores.compute.is_dirty()
            && !has_explicit_overrides
            && !self.stores.compute.has_volatile_cells()
        {
            return Ok(crate::snapshot::RecalcResult::empty());
        }
        self.materialize_all_pivots();
        let result = self
            .stores
            .compute
            .full_recalc_with_options(&mut self.mirror, options)?;
        self.init_cf_caches();
        self.stores.compute.clear_dirty();
        Ok(result)
    }

    /// Materialize all pivot tables across all sheets after recalc.
    fn materialize_all_pivots_for_import_open(stores: &mut EngineStores, mirror: &mut CellMirror) {
        use compute_pivot::{PivotEngineConfig, PivotTableDefExt};

        fn source_sheet_id(
            mirror: &CellMirror,
            config: &domain_types::domain::pivot::PivotTableConfig,
        ) -> Result<SheetId, ComputeError> {
            if let Some(source_sheet_id) = config.source_sheet_id.as_deref() {
                let source_id = SheetId::from_uuid_str(source_sheet_id).map_err(|e| {
                    ComputeError::InvalidInput {
                        message: format!("Invalid pivot sourceSheetId '{source_sheet_id}': {e}"),
                    }
                })?;
                if mirror.get_sheet(&source_id).is_some() {
                    return Ok(source_id);
                }
                return Err(ComputeError::SheetNotFound {
                    sheet_id: source_sheet_id.to_string(),
                });
            }

            mirror
                .sheet_by_name(&config.source_sheet_name)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: config.source_sheet_name.clone(),
                })
        }

        fn compute_from_source(
            stores: &EngineStores,
            mirror: &CellMirror,
            sheet_id: &SheetId,
            pivot_id: &str,
        ) -> Result<compute_pivot::PivotTableResult, ComputeError> {
            let config =
                services::objects::pivot_get(stores, sheet_id, pivot_id).ok_or_else(|| {
                    ComputeError::Eval {
                        message: format!("Pivot table '{pivot_id}' not found"),
                    }
                })?;

            let range = &config.source_range;
            let total_cells = (range.end_row() as u64 - range.start_row() as u64 + 1)
                * (range.end_col() as u64 - range.start_col() as u64 + 1);
            if total_cells > 10_000_000 {
                return Err(ComputeError::Eval {
                    message: "Pivot source range exceeds 10M cells".to_string(),
                });
            }

            let source_sid = source_sheet_id(mirror, &config)?;
            let mut data = Vec::with_capacity((range.end_row() - range.start_row() + 1) as usize);
            for row in range.start_row()..=range.end_row() {
                let mut row_values =
                    Vec::with_capacity((range.end_col() - range.start_col() + 1) as usize);
                for col in range.start_col()..=range.end_col() {
                    let value = crate::storage::cells::values::get_effective_value(
                        mirror,
                        &source_sid,
                        row,
                        col,
                    )
                    .unwrap_or_default();
                    row_values.push(value);
                }
                data.push(row_values);
            }

            if data.is_empty() {
                return Err(ComputeError::Eval {
                    message: "Pivot source range is empty".to_string(),
                });
            }

            let mut config = config;
            if config.fields.is_empty() && !config.placements.is_empty() {
                let mut detected = compute_pivot::detect_fields(&data);
                for field in &mut detected {
                    field.id = compute_pivot::FieldId::new(field.name.clone());
                }
                config.fields = detected;
            }

            let engine_config =
                compute_pivot::PivotEngineConfig::try_from(config).map_err(|e| {
                    ComputeError::Eval {
                        message: format!("Pivot config conversion error: {e}"),
                    }
                })?;
            let resolved = compute_pivot::validate_and_resolve(&engine_config).map_err(|e| {
                ComputeError::Eval {
                    message: format!("Pivot validation error: {e}"),
                }
            })?;

            Ok(compute_pivot::compute_with_show_values_as_resolved(
                &resolved, &data, None,
            ))
        }

        let sheet_ids: Vec<SheetId> = mirror.sheet_ids().copied().collect();
        let mut pivot_pairs: Vec<(
            SheetId,
            String,
            domain_types::domain::pivot::PivotTableConfig,
        )> = Vec::new();
        for sid in &sheet_ids {
            for cfg in services::objects::pivot_get_all(stores, sid) {
                let id = cfg.id.clone();
                pivot_pairs.push((*sid, id, cfg));
            }
        }

        for (sheet_id, pivot_id, config) in &pivot_pairs {
            let output_sheet_id = match mirror.sheet_by_name(&config.output_sheet_name) {
                Some(id) => id,
                None => continue,
            };

            let output_sheet_uuid = output_sheet_id.to_uuid_string();
            let old_def = mirror
                .find_pivot_table_def(pivot_id, &config.name, &output_sheet_uuid)
                .cloned();
            if let Some(def) = old_def {
                let old_rows = def.rendered_row_count();
                let old_cols = def.rendered_col_count();
                if old_rows > 0 && old_cols > 0 {
                    mirror.clear_pivot_region(
                        &output_sheet_id,
                        def.start_row,
                        def.start_col,
                        old_rows,
                        old_cols,
                    );
                }
            }

            match compute_from_source(stores, mirror, sheet_id, pivot_id) {
                Ok(result) => {
                    let engine_config = match PivotEngineConfig::try_from(config.clone()) {
                        Ok(config) => config,
                        Err(e) => {
                            tracing::warn!(
                                pivot_id = %pivot_id,
                                error = %e,
                                "Pivot materialization failed to convert config; skipping"
                            );
                            continue;
                        }
                    };
                    let row_field_names: Vec<String> = engine_config
                        .row_placements()
                        .iter()
                        .map(|p| {
                            p.display_name()
                                .map(String::from)
                                .or_else(|| {
                                    engine_config
                                        .fields
                                        .iter()
                                        .find(|f| f.id == *p.field_id())
                                        .map(|f| f.name.clone())
                                })
                                .unwrap_or_else(|| p.field_id().to_string())
                        })
                        .collect();
                    mirror.materialize_pivot(
                        &output_sheet_id,
                        config.output_location.row,
                        config.output_location.col,
                        &result,
                        &row_field_names,
                    );
                    let def =
                        engine_config.to_pivot_table_def(&result.rendered_bounds, &output_sheet_id);
                    mirror.upsert_pivot_table_def(def);
                }
                Err(e) => {
                    tracing::warn!(
                        pivot_id = %pivot_id,
                        error = %e,
                        "Pivot materialization failed during import-open recalc; skipping"
                    );
                }
            }
        }
    }

    /// Materialize all pivot tables across all sheets after recalc.
    fn materialize_all_pivots(&mut self) {
        use compute_pivot::{PivotEngineConfig, PivotTableDefExt};
        let sheet_ids: Vec<SheetId> = self.mirror.sheet_ids().copied().collect();
        let mut pivot_pairs: Vec<(
            SheetId,
            String,
            domain_types::domain::pivot::PivotTableConfig,
        )> = Vec::new();
        for sid in &sheet_ids {
            let configs = services::objects::pivot_get_all(&self.stores, sid);
            for cfg in configs {
                let id = cfg.id.clone();
                pivot_pairs.push((*sid, id, cfg));
            }
        }
        for (sheet_id, pivot_id, config) in &pivot_pairs {
            // Resolve output sheet
            let output_sheet_id = match self.mirror.sheet_by_name(&config.output_sheet_name) {
                Some(id) => id,
                None => continue,
            };

            // Clear old cells if previously materialized
            {
                let output_sheet_uuid = output_sheet_id.to_uuid_string();
                let old_def = self
                    .mirror
                    .find_pivot_table_def(pivot_id, &config.name, &output_sheet_uuid)
                    .cloned();
                if let Some(def) = old_def {
                    let old_rows = def.rendered_row_count();
                    let old_cols = def.rendered_col_count();
                    if old_rows > 0 && old_cols > 0 {
                        self.mirror.clear_pivot_region(
                            &output_sheet_id,
                            def.start_row,
                            def.start_col,
                            old_rows,
                            old_cols,
                        );
                    }
                }
            }

            // Compute
            match self.pivot_compute_from_source(sheet_id, pivot_id, None) {
                Ok(result) => {
                    let engine_config = match PivotEngineConfig::try_from(config.clone()) {
                        Ok(config) => config,
                        Err(e) => {
                            tracing::warn!(
                                pivot_id = %pivot_id,
                                error = %e,
                                "Pivot materialization failed to convert config; skipping"
                            );
                            continue;
                        }
                    };
                    let row_field_names: Vec<String> = engine_config
                        .row_placements()
                        .iter()
                        .map(|p| {
                            p.display_name()
                                .map(String::from)
                                .or_else(|| {
                                    engine_config
                                        .fields
                                        .iter()
                                        .find(|f| f.id == *p.field_id())
                                        .map(|f| f.name.clone())
                                })
                                .unwrap_or_else(|| p.field_id().to_string())
                        })
                        .collect();
                    self.mirror.materialize_pivot(
                        &output_sheet_id,
                        config.output_location.row,
                        config.output_location.col,
                        &result,
                        &row_field_names,
                    );
                    let def =
                        engine_config.to_pivot_table_def(&result.rendered_bounds, &output_sheet_id);
                    self.mirror.upsert_pivot_table_def(def);
                }
                Err(e) => {
                    tracing::warn!(
                        pivot_id = %pivot_id,
                        error = %e,
                        "Pivot materialization failed during recalc; skipping"
                    );
                }
            }
        }
    }

    /// Rebuild the `ComputeCore` from the engine's own internal state.
    pub fn rebuild_compute_core(&mut self) -> Result<crate::snapshot::RecalcResult, ComputeError> {
        let snapshot = construction::build_workbook_snapshot(&self.stores, &self.mirror);
        self.stores.compute = ComputeCore::new();
        let recalc = self
            .stores
            .compute
            .init_from_snapshot(&mut self.mirror, snapshot)?;
        self.stores
            .compute
            .set_id_alloc(self.stores.grid_id_alloc.clone());
        self.init_cf_caches();
        // `init_from_snapshot` already cleared the dirty bit after its
        // internal full recalc. Belt-and-braces — rebuild leaves the
        // workbook in a "just recalculated" state.
        self.stores.compute.clear_dirty();
        Ok(recalc)
    }

    /// For each user-typed string that landed as a Number value, run
    /// locale-aware date detection. If the input parses as a date AND the
    /// cell does not already have a date format applied, write the
    /// suggested format code (e.g. `"M/d/yyyy"`, `"yyyy-mm-dd"`) into the
    /// per-cell number_format. This is the Rust-side replacement for the
    /// previous `cell-operations.ts` post-set `parseDateInput` shim — the
    /// kernel just calls `setCellsByPosition` and Rust handles the
    /// value/format pairing atomically.
    ///
    /// Skips entries where:
    /// - the parse did not produce a numeric value (e.g. plain text, formula);
    /// - the resulting value is not a date (parse_date_input returns None);
    /// - the cell already has any explicit non-General format from any layer
    ///   of the cascade (column/row/table/cell) — Excel parity: an
    ///   explicitly-formatted cell never silently changes format on input.
    ///   Only General cells are eligible for auto date-inference.
    fn apply_inferred_date_formats(
        &mut self,
        candidates: &[(SheetId, u32, u32, String)],
    ) -> Result<(), ComputeError> {
        use compute_document::hex::id_to_hex;
        use domain_types::CellFormat;

        let locale = self.settings.locale.clone();
        let mut to_apply: Vec<(SheetId, u32, u32, String)> = Vec::new();

        for (sheet_id, row, col, text) in candidates {
            // 1. Skip formulas and apostrophe-prefixed literal text — those
            //    never round-trip through date detection.
            let trimmed = text.trim();
            if trimmed.is_empty() || trimmed.starts_with('=') || trimmed.starts_with('\'') {
                continue;
            }

            // 2. Cell must exist and currently hold a numeric value (the
            //    parse landed as a date serial). If the parser fell through
            //    to text or boolean, skip.
            let cell_value = self
                .mirror
                .get_cell_value_at(sheet_id, cell_types::SheetPos::new(*row, *col));
            if !matches!(cell_value, Some(value_types::CellValue::Number(_))) {
                continue;
            }

            // 3. Locale-aware date detection. Rust's internal parse_input_value
            //    is stricter than parse_date_input (no D/M/Y, no month-name
            //    fallbacks), so only act when *both* parsers agree — this
            //    avoids "looks like a date in the locale" applying to plain
            //    numbers that happen to be the same magnitude as a serial.
            let parsed = match compute_formats::parse_date_input(trimmed, &locale) {
                Some(p) => p,
                None => continue,
            };

            // 4. Skip if the cell already has a date format applied.
            let cell_id =
                match services::cell_editing::find_cell_id_at(&self.stores, sheet_id, *row, *col) {
                    Some(id) => id,
                    None => continue,
                };
            let cell_hex = id_to_hex(cell_id.as_u128());
            let table_fmt =
                services::tables::resolve_table_format_at_cell(&self.mirror, sheet_id, *row, *col);
            let effective = crate::storage::properties::get_effective_format(
                &self.stores.storage,
                sheet_id,
                &cell_hex,
                *row,
                *col,
                table_fmt.as_ref(),
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            );
            // Auto date-inference only fires on cells whose effective format is
            // General. Any explicit format the user set — Number, Currency,
            // Date, Fraction, Percentage, Scientific, Custom, Text, Special,
            // Time, Accounting — is sticky and beats inference. (Excel
            // parity: an explicitly-formatted cell never silently changes
            // format on input.) Use `detect_format_type` for canonical
            // classification, matching the route taken in
            // `services::cell_editing::write_cell_value` when computing the
            // parser hint.
            let has_explicit_format = effective
                .number_format
                .as_deref()
                .map(compute_formats::detect_format_type)
                .is_some_and(|ft| ft != compute_formats::FormatType::General);
            if has_explicit_format {
                continue;
            }

            to_apply.push((*sheet_id, *row, *col, parsed.suggested_format));
        }

        if to_apply.is_empty() {
            return Ok(());
        }

        // Suppress observer rebroadcast for the format writes — these are
        // structural follow-ups to the value mutation that already fired its
        // own observer notification.
        let _guard = self.mutation.suppress_guard();
        for (sheet_id, row, col, fmt) in to_apply {
            let format = CellFormat {
                number_format: Some(fmt),
                ..Default::default()
            };
            services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                &sheet_id,
                &[(row, col, row, col)],
                &format,
            )?;
        }
        Ok(())
    }

    /// Excel applies formula-reference number format inheritance at edit time:
    /// the formula cell receives its own copied number_format, and later display
    /// reads use that stored format without walking references.
    fn apply_formula_inherited_number_formats(
        &mut self,
        candidates: &[(SheetId, u32, u32)],
    ) -> Result<MutationResult, ComputeError> {
        if candidates.is_empty() {
            return Ok(MutationResult::empty());
        }

        let mut to_apply: Vec<(SheetId, u32, u32, String)> = Vec::new();

        for (sheet_id, row, col) in candidates {
            let Some(cell_id) = self
                .mirror
                .resolve_cell_id(sheet_id, SheetPos::new(*row, *col))
            else {
                continue;
            };

            if self.formula_cell_has_non_general_number_format(&cell_id, sheet_id, *row, *col) {
                continue;
            }

            let mut visited = HashSet::new();
            visited.insert(cell_id);
            let Some(number_format) =
                self.inherited_formula_number_format(&cell_id, &mut visited, 8)
            else {
                continue;
            };

            to_apply.push((*sheet_id, *row, *col, number_format));
        }

        if to_apply.is_empty() {
            return Ok(MutationResult::empty());
        }

        let _guard = self.mutation.suppress_guard();
        let mut result = MutationResult::empty();
        for (sheet_id, row, col, number_format) in to_apply {
            let format = CellFormat {
                number_format: Some(number_format),
                ..Default::default()
            };
            let (_affected, format_result) = services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                &sheet_id,
                &[(row, col, row, col)],
                &format,
            )?;
            result
                .property_changes
                .extend(format_result.property_changes);
        }

        Ok(result)
    }

    fn formula_cell_has_non_general_number_format(
        &self,
        cell_id: &CellId,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> bool {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let table_fmt =
            services::tables::resolve_table_format_at_cell(&self.mirror, sheet_id, row, col);
        let effective = crate::storage::properties::get_effective_format(
            &self.stores.storage,
            sheet_id,
            &cell_hex,
            row,
            col,
            table_fmt.as_ref(),
            self.stores.grid_indexes.get(sheet_id),
            self.mirror.get_sheet(sheet_id),
        );

        effective
            .number_format
            .as_deref()
            .is_some_and(is_non_general_number_format)
    }

    fn effective_number_format_for_cell(&self, cell_id: &CellId) -> Option<String> {
        let sheet_id = self.mirror.sheet_for_cell(cell_id)?;
        let pos = self.mirror.resolve_position(cell_id)?;
        let cell_hex = id_to_hex(cell_id.as_u128());
        let table_fmt = services::tables::resolve_table_format_at_cell(
            &self.mirror,
            &sheet_id,
            pos.row(),
            pos.col(),
        );
        let effective = crate::storage::properties::get_effective_format(
            &self.stores.storage,
            &sheet_id,
            &cell_hex,
            pos.row(),
            pos.col(),
            table_fmt.as_ref(),
            self.stores.grid_indexes.get(&sheet_id),
            self.mirror.get_sheet(&sheet_id),
        );

        effective
            .number_format
            .filter(|fmt| is_non_general_number_format(fmt))
    }

    fn inherited_formula_number_format(
        &self,
        formula_cell_id: &CellId,
        visited: &mut HashSet<CellId>,
        depth: u8,
    ) -> Option<String> {
        if depth == 0 {
            return None;
        }

        let formula = self.mirror.get_formula(formula_cell_id)?;
        let mut inherited: Option<String> = None;

        for reference in &formula.refs {
            let IdentityFormulaRef::Cell(cell_ref) = reference else {
                continue;
            };

            let source_format = if let Some(format) =
                self.effective_number_format_for_cell(&cell_ref.id)
            {
                Some(format)
            } else if visited.insert(cell_ref.id) {
                let nested = self.inherited_formula_number_format(&cell_ref.id, visited, depth - 1);
                visited.remove(&cell_ref.id);
                nested
            } else {
                None
            };

            let Some(source_format) = source_format else {
                continue;
            };

            match &inherited {
                Some(existing) if existing != &source_format => return None,
                Some(_) => {}
                None => inherited = Some(source_format),
            }
        }

        inherited
    }
}

fn is_non_general_number_format(format: &str) -> bool {
    compute_formats::detect_format_type(format) != compute_formats::FormatType::General
}

fn is_formula_parse_input(input: &mutation::CellInput) -> bool {
    matches!(input, mutation::CellInput::Parse { text } if text.trim().starts_with('='))
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
