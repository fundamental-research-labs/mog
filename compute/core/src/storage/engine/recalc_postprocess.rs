use cell_types::{CellId, SheetId};
use snapshot_types::RecalcResult;

use super::{YrsComputeEngine, services};

impl YrsComputeEngine {
    /// Post-process recalc (CF refresh + display text + schema validation) and stash for flush.
    ///
    /// This is the central funnel for every mutation path that produces a
    /// `RecalcResult` — cell edits (`set_cell*`, `import_values`, `apply_changes`),
    /// structural changes, and every branch of `apply_mutation`. We mark the
    /// compute store dirty here so that a subsequent `recalculate_with_options`
    /// call cannot short-circuit past a mutation that actually changed state.
    pub(in crate::storage::engine) fn prepare_recalc_for_flush(
        &mut self,
        recalc: &mut RecalcResult,
    ) {
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
    pub(in crate::storage::engine) fn postprocess_import_open_recalc(
        &mut self,
        recalc: &mut RecalcResult,
    ) {
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

    /// Populate `display_text` on each `CellChange` using the canonical format pipeline.
    pub(in crate::storage::engine) fn enrich_display_text(&self, result: &mut RecalcResult) {
        services::mutation_handlers::enrich_display_text(
            &self.stores,
            &self.mirror,
            &self.settings,
            result,
            &|value, sheet_id, row, col| self.format_value_at_cell(value, sheet_id, row, col),
        );
    }

    /// Populate `extra_flags` on each `CellChange` with metadata flags.
    pub(in crate::storage::engine) fn enrich_metadata_flags(&self, recalc: &mut RecalcResult) {
        services::mutation_handlers::enrich_metadata_flags(&self.stores, &self.mirror, recalc);
    }
}
