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
mod atomics;
mod cell_semantics;
pub use cell_semantics::CellInfo;
mod cf_cache;
mod data_table_formula;
mod delegations;
mod export;
mod features;
mod format_inference;
mod formatting;
mod grid_indexing;
mod layout;
mod merge_index;
pub(crate) mod mutation;
mod objects;
mod queries;
mod query_serialization;
mod recalc_postprocess;
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

use std::collections::HashMap;

use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::scheduler::ComputeCore;
use crate::snapshot::{MutationResult, RecalcResult, UndoState, WorkbookSnapshot};
#[cfg(test)]
use cell_types::SheetPos;
use cell_types::{CellId, SheetId};
use compute_layout_index::LayoutIndex;
use value_types::{CellValue, ComputeError};

use super::YrsStorage;
use compute_collab as sync;
#[cfg(test)]
use compute_document::hex::id_to_hex;
use compute_document::observe::DocumentObserver;
use compute_document::undo::UndoRedoManager;
#[cfg(test)]
use mutation::{EngineMutation, MutationOutput};

use format_inference::is_formula_parse_input;
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
