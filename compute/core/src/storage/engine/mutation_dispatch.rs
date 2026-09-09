use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use snapshot_types::DataTableRegionDef;
use value_types::{CellValue, ComputeError};

use crate::snapshot::{ChangeKind, MutationResult, RecalcResult, SortingChange};

use super::format_inference::is_formula_parse_input;
use super::mutation::{self, EngineMutation, MutationOutput};
use super::stores::EngineStores;
use super::{ComputeEngine, services, validation};

type RawCellEdit = (SheetId, CellId, u32, u32, CellValue, Option<String>);

fn materialize_data_table_body_edits(
    stores: &mut EngineStores,
    mirror: &mut crate::mirror::CellMirror,
    sheet_id: &SheetId,
    region: &DataTableRegionDef,
) -> Result<Vec<RawCellEdit>, ComputeError> {
    let formula = super::data_table_formula::formula_for_region(mirror, sheet_id, region)
        .ok_or_else(|| ComputeError::InvalidInput {
            message: "create_data_table could not synthesize TABLE formula text".to_string(),
        })?;
    let mut edits = Vec::new();
    for row in region.start_row..=region.end_row {
        for col in region.start_col..=region.end_col {
            let cell_id =
                services::cell_editing::ensure_cell_id_mirrored(stores, mirror, sheet_id, row, col)
                    .ok_or_else(|| ComputeError::SheetNotFound {
                        sheet_id: sheet_id.to_uuid_string(),
                    })?;
            edits.push((
                *sheet_id,
                cell_id,
                row,
                col,
                CellValue::Null,
                Some(formula.clone()),
            ));
        }
    }
    Ok(edits)
}

impl ComputeEngine {
    /// Central dispatch for all mutations. Keeps all five stores in sync.
    pub(crate) fn apply_mutation(
        &mut self,
        mutation: EngineMutation,
    ) -> Result<MutationOutput, ComputeError> {
        validation::validate_mutation(&mutation, self)?;

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
                    cell_ids,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }

            EngineMutation::SetCellsByPosition {
                edits,
                skip_cycle_check,
            } => {
                self.admit_version_runtime_operation(
                    "compute_batch_set_cells_by_position",
                    super::versioning::VersionRuntimeAdmissionLocation::from_position_edits(
                        edits
                            .iter()
                            .map(|(sheet_id, row, col, _)| (*sheet_id, *row, *col)),
                    ),
                )?;

                // Snapshot Parse-text edits so we can run locale-aware date format
                // inference after the value writes land in the mirror. Doing this
                // here (rather than in TS) keeps the value write and the format
                // application atomic from the caller's perspective.
                let inferred_format_candidates: Vec<(SheetId, u32, u32, String)> = edits
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
                    edits,
                    skip_cycle_check,
                )?;
                let format_result =
                    self.apply_formula_inherited_number_formats(&formula_format_candidates)?;
                self.prepare_recalc_for_flush(&mut recalc);

                if !inferred_format_candidates.is_empty() {
                    self.apply_inferred_date_formats(&inferred_format_candidates)?;
                    self.apply_inferred_time_formats(&inferred_format_candidates)?;
                    self.apply_inferred_currency_formats(&inferred_format_candidates)?;
                    self.apply_inferred_percent_formats(&inferred_format_candidates)?;
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
                let edits = materialize_data_table_body_edits(
                    &mut self.stores,
                    &mut self.mirror,
                    &input.sheet_id,
                    &region,
                )?;
                self.mirror.upsert_data_table_region(region.clone());
                let mut recalc = services::mutation_handlers::mutation_set_cells_raw_with_trust(
                    &mut self.stores,
                    &mut self.mirror,
                    edits,
                    true,
                    crate::scheduler::WriteTrust::TrustedReplay,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&data)?)
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

            EngineMutation::CreateSheet {
                name,
                default_col_width_px,
            } => {
                let (hex, result) = services::mutation_handlers::mutation_create_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &name,
                    default_col_width_px,
                )?;
                // R2.3 — new sheet added; any cached matrix that keyed
                // on a prior layout stays in the cache but is now
                // orphaned. Bump so workbook-scope lookups see the
                // fresh structure.
                self.security.bump_structure_version();
                // A new sheet can cause previously-#REF! cross-sheet
                // refs to resolve on next recalc — must not short-circuit.
                self.stores.compute.mark_dirty();

                MutationOutput::SheetId(hex, result)
            }

            EngineMutation::CreateDefaultSheet {
                name,
                default_col_width_px,
            } => {
                // Default creation returns complete initial workbook state.
                let (hex, result) = services::mutation_handlers::mutation_create_default_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &name,
                    default_col_width_px,
                )?;
                self.security.bump_structure_version();
                self.stores.compute.mark_dirty();
                MutationOutput::SheetId(hex, result)
            }

            EngineMutation::DeleteSheet { sheet_id } => {
                let (mut result, mut recalc) = services::mutation_handlers::mutation_delete_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &sheet_id,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                result.recalc = recalc;
                // R2.3 — sheet gone; every cached matrix for that
                // sheet id is now a lie. Let the LRU age them out.
                self.security.bump_structure_version();

                MutationOutput::Recalc(result)
            }

            EngineMutation::CopySheet {
                source_sheet_id,
                new_name,
            } => {
                let (hex, result) = services::mutation_handlers::mutation_copy_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &source_sheet_id,
                    &new_name,
                )?;
                // R2.3 — new sheet; same reasoning as CreateSheet.
                self.security.bump_structure_version();
                // Copied sheet adds new formula cells — next recalc has work.
                self.stores.compute.mark_dirty();

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
                    &self.settings,
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
                        cell_ids,
                    )?;
                    self.prepare_recalc_for_flush(&mut recalc);
                    MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&hex_ids)?)
                }
            }

            EngineMutation::CreateNamedRange { input } => {
                services::mutation_handlers::mutation_named_range_create(
                    &mut self.stores,
                    &mut self.mirror,
                    input,
                )?
            }
            EngineMutation::UpdateNamedRange { id, updates } => {
                let mut output = services::mutation_handlers::mutation_named_range_update(
                    &mut self.stores,
                    &mut self.mirror,
                    id,
                    updates,
                )?;
                if let MutationOutput::Recalc(result) = &mut output {
                    self.prepare_recalc_for_flush(&mut result.recalc);
                }
                output
            }
            EngineMutation::ImportNamedRanges { names } => {
                services::mutation_handlers::mutation_named_ranges_import(
                    &mut self.stores,
                    &mut self.mirror,
                    names,
                )?
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
                let (mut recalc, relocate_result, table_changes, pivot_changes) =
                    services::mutation_handlers::mutation_relocate_cells(
                        &mut self.stores,
                        &mut self.mirror,
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
                let mut result = MutationResult::from_recalc(recalc).with_data(&relocate_result)?;
                result.table_changes.extend(table_changes);
                result.pivot_changes.extend(pivot_changes);
                MutationOutput::Recalc(result)
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

    /// Create a new sheet (used by objects.rs for pivot table creation).
    pub(in crate::storage::engine) fn mutation_create_sheet(
        &mut self,
        name: &str,
    ) -> Result<(String, MutationResult), ComputeError> {
        services::mutation_handlers::mutation_create_sheet(
            &mut self.stores,
            &mut self.mirror,
            name,
            None,
        )
    }

    // -------------------------------------------------------------------
    // CreateSubtotals — insert rows + SUBTOTAL formulas with recalc
    // -------------------------------------------------------------------

    /// Create subtotal rows and groups with full store synchronization.
    /// Recalculate the affected cells after updating native rows and groups.
    fn mutation_create_subtotals(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: crate::storage::sheet::grouping::SubtotalOptions,
    ) -> Result<
        (
            RecalcResult,
            crate::storage::sheet::grouping::SubtotalResult,
        ),
        ComputeError,
    > {
        use crate::storage::sheet::grouping;

        let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);

        // The Accessor struct needs &mut ComputeEngine because set_cell and
        // structure_change are engine methods that coordinate all five stores.
        struct Accessor<'a> {
            engine: &'a mut ComputeEngine,
        }
        impl<'a> grouping::SubtotalsCellAccessor for Accessor<'a> {
            fn group_rows(
                &mut self,
                sheet_id: &SheetId,
                start: u32,
                end: u32,
            ) -> Result<grouping::GroupDefinition, String> {
                grouping::group_rows(&mut self.engine.stores.storage, sheet_id, start, end)
            }
            fn clear_row_grouping(&mut self, sheet_id: &SheetId, start: u32, end: u32) {
                grouping::clear_row_grouping(&mut self.engine.stores.storage, sheet_id, start, end);
            }
            fn get_row_groups(&self, sheet_id: &SheetId) -> Vec<grouping::GroupDefinition> {
                grouping::get_groups(
                    &self.engine.stores.storage,
                    sheet_id,
                    grouping::GroupAxis::Row,
                )
            }

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
                if let Some(grid) = self.engine.grid_index(sid)
                    && let Some(cell_id) = grid.cell_id_at(row, col)
                    && let Some(formula) = self.engine.compute().get_formula(&cell_id)
                {
                    return formula.to_string();
                }
                self.engine
                    .mirror
                    .get_cell_value_at(sid, SheetPos::new(row, col))
                    .map(|v| format!("{}", v))
                    .unwrap_or_default()
            }
        }

        let mut accessor = Accessor { engine: self };
        let subtotal_result = grouping::create_subtotals(&mut accessor, sheet_id, &range, &options);

        // Sync all cells in the expanded range with compute.
        let affected = subtotal_result.affected_range;
        let recalc = services::cell_editing::sync_range_with_compute(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            affected.start_row(),
            affected.start_col(),
            affected.end_row(),
            affected.end_col(),
        )?;
        Ok((recalc, subtotal_result))
    }
}
