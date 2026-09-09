use bridge_core as bridge;

use super::{ComputeEngine, CsvImportOptions, construction, services};
use crate::snapshot::{ChangeKind, MutationResult, RecalcResult, WorkbookSnapshot};
use value_types::ComputeError;

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "core",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    // -------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------

    /// Create a `ComputeEngine` from a workbook snapshot.
    #[tracing::instrument(name = "engine_from_snapshot", skip_all)]
    #[bridge::lifecycle(create)]
    #[bridge::skip(wasm, tauri, napi, pyo3)]
    pub fn from_snapshot(snapshot: WorkbookSnapshot) -> Result<(Self, RecalcResult), ComputeError> {
        construction::from_snapshot(snapshot)
    }

    pub fn from_snapshot_with_layout_metrics(
        snapshot: WorkbookSnapshot,
        layout_metrics: domain_types::units::LayoutMetrics,
    ) -> Result<(Self, RecalcResult), ComputeError> {
        construction::from_snapshot_with_layout_metrics(snapshot, layout_metrics)
    }

    /// Assemble an export-capable native engine from an already-initialized
    /// formula-eval compute state without running another full recalculation.
    #[cfg(feature = "__internal")]
    #[doc(hidden)]
    pub fn from_evaluated_snapshot_for_export(
        snapshot: WorkbookSnapshot,
        cell_store: crate::cells::CellStore,
        compute: crate::scheduler::ComputeCore,
    ) -> Result<Self, ComputeError> {
        let storage = crate::storage::WorkbookStorage::from_snapshot(snapshot.clone())?;
        construction::assemble_engine(storage, cell_store, compute, &snapshot)
    }

    // -------------------------------------------------------------------
    // Import (XLSX → Rust hydration, bypassing TypeScript pipeline)
    // -------------------------------------------------------------------

    /// Import directly from raw XLSX file bytes (with recalculation).
    ///
    /// Returns recalculated cells and hydrated metadata in a [`MutationResult`].
    /// Pixel consumers can request explicit viewport snapshots after import.
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_import_from_xlsx_bytes", skip_all)]
    pub fn import_from_xlsx_bytes(
        &mut self,
        xlsx_data: &[u8],
        do_recalc: bool,
    ) -> Result<MutationResult, ComputeError> {
        let result = self.without_history(|engine| {
            let recalc = {
                let _span = tracing::info_span!("import_construction").entered();
                construction::import_from_xlsx_bytes(engine, xlsx_data, do_recalc)?
            };
            let result = {
                let _span = tracing::info_span!("import_mutation_result").entered();
                services::mutation_handlers::build_mutation_result_for_hydration(
                    &engine.stores,
                    &engine.cell_store,
                    recalc,
                )
            };
            Ok(result)
        });
        if result.is_ok() {
            self.clear_history();
        }
        result
    }

    /// Construct a `ComputeEngine` directly from raw XLSX bytes (no recalc).
    pub fn from_xlsx_bytes(xlsx_data: &[u8]) -> Result<(Self, RecalcResult), ComputeError> {
        construction::from_xlsx_bytes(xlsx_data)
    }

    /// Import from XLSX bytes without running formula recalculation.
    pub fn import_from_xlsx_bytes_no_recalc(
        &mut self,
        xlsx_data: &[u8],
    ) -> Result<RecalcResult, ComputeError> {
        let result = self.without_history(|engine| {
            construction::import_from_xlsx_bytes(engine, xlsx_data, false)
        });
        if result.is_ok() {
            self.clear_history();
        }
        result
    }

    /// Load the active worksheet into native storage for first display.
    /// `complete_deferred_hydration()` loads the remaining worksheets.
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_import_from_xlsx_bytes_deferred", skip_all)]
    pub fn import_from_xlsx_bytes_deferred(
        &mut self,
        xlsx_data: &[u8],
    ) -> Result<MutationResult, ComputeError> {
        let result = self.without_history(|engine| {
            construction::import_from_xlsx_bytes_deferred(engine, xlsx_data)?;
            let result = services::mutation_handlers::build_mutation_result_for_hydration(
                &engine.stores,
                &engine.cell_store,
                RecalcResult::empty(),
            );
            Ok(result)
        });
        if result.is_ok() {
            self.clear_history();
        }
        result
    }

    /// Load the remaining worksheet payloads and complete the formula graph.
    /// Retains the active sheet already installed by the initial load.
    #[bridge::write(scope = "workbook")]
    #[tracing::instrument(name = "engine_complete_deferred_hydration", skip_all)]
    pub fn complete_deferred_hydration(&mut self) -> Result<MutationResult, ComputeError> {
        self.without_history(|engine| {
            let deferred_filter_created_keys = if engine.deferred_hydration.is_some() {
                collect_deferred_filter_created_keys(engine)
            } else {
                Default::default()
            };
            let Some(mut completion) = construction::stage_deferred_hydration(engine)? else {
                let result = services::mutation_handlers::build_mutation_result_for_hydration(
                    &engine.stores,
                    &engine.cell_store,
                    RecalcResult::empty(),
                );
                return Ok(result);
            };

            let mut recalc = if completion.calculation.full_calc_on_load
                || completion.calculation.force_full_calc
            {
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
                    &mut completion.cell_store,
                );
                let result = completion
                    .stores
                    .compute
                    .full_recalc_with_options(&mut completion.cell_store, &options)?;
                completion.stores.compute.clear_dirty();
                result
            } else {
                RecalcResult::empty()
            };

            construction::commit_deferred_hydration(engine, completion);
            engine.postprocess_import_open_recalc(&mut recalc);
            let mut result = services::mutation_handlers::build_mutation_result_for_hydration(
                &engine.stores,
                &engine.cell_store,
                recalc,
            );
            suppress_deferred_duplicate_filter_created_changes(
                &mut result,
                &deferred_filter_created_keys,
            );
            Ok(result)
        })
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
    /// Introduces the current native workbook to bridge consumers after loading
    /// or attaching to an existing engine.
    ///
    /// Idempotent for snapshot-replace variants (sheet/workbook settings,
    /// frozen panes, scroll position, ...): calling on top of an
    /// already-settled cell_store is safe and produces no observable change.
    /// Non-snapshot variants (charts, tables, comments, sparklines, CF
    /// rules, named ranges, pivots, grouping) are upserts on the TS side,
    /// so a redundant settle on a doc whose cell_store was already populated
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
    #[tracing::instrument(name = "engine_settle_for_store", skip_all)]
    pub fn settle_for_store(&mut self) -> Result<MutationResult, ComputeError> {
        self.without_history(|engine| {
            let result = services::mutation_handlers::build_mutation_result_for_hydration(
                &engine.stores,
                &engine.cell_store,
                RecalcResult::empty(),
            );
            Ok(result)
        })
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
    ) -> Result<MutationResult, ComputeError> {
        let result = self.without_history(|engine| {
            let recalc = construction::import_from_csv_bytes(engine, csv_data, &options, true)?;
            let result = services::mutation_handlers::build_mutation_result_for_hydration(
                &engine.stores,
                &engine.cell_store,
                recalc,
            );
            Ok(result)
        });
        if result.is_ok() {
            self.clear_history();
        }
        result
    }

    /// Construct a `ComputeEngine` directly from raw CSV bytes (no recalc).
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
        let result = self.without_history(|engine| {
            construction::import_from_csv_bytes(engine, csv_data, &options, false)
        });
        if result.is_ok() {
            self.clear_history();
        }
        result
    }

    /// Import specific sheets from an XLSX byte buffer into the existing document.
    ///
    /// Parses the XLSX, filters by `sheet_names` (case-insensitive), merges the
    /// style palette, hydrates each matched sheet into native storage, synchronizes
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
        self.with_history(|engine| {
            construction::import_sheets_from_xlsx(engine, xlsx_data, &sheet_names, insert_position)
        })
    }
}

fn collect_deferred_filter_created_keys(
    engine: &ComputeEngine,
) -> std::collections::HashSet<(String, String)> {
    engine
        .stores
        .grid_indexes
        .keys()
        .flat_map(|sheet_id| {
            let sheet_id_str = sheet_id.to_uuid_string();
            crate::storage::sheet::filters::get_filters_in_sheet(&engine.stores.storage, sheet_id)
                .into_iter()
                .map(move |filter| (sheet_id_str.clone(), filter.id))
        })
        .collect()
}

fn suppress_deferred_duplicate_filter_created_changes(
    result: &mut MutationResult,
    deferred_filter_created_keys: &std::collections::HashSet<(String, String)>,
) {
    if deferred_filter_created_keys.is_empty() {
        return;
    }

    result.filter_changes.retain(|change| {
        let duplicate_created = change.kind == ChangeKind::Set
            && change.action.as_deref() == Some("created")
            && deferred_filter_created_keys
                .contains(&(change.sheet_id.clone(), change.filter_id.clone()));
        !duplicate_created
    });
}
