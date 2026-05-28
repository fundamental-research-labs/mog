use bridge_core as bridge;

use super::{CsvImportOptions, YrsComputeEngine, construction, services};
use crate::snapshot::{MutationResult, RecalcResult, WorkbookSnapshot};
use value_types::ComputeError;

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
}
